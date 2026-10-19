import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The hooks and helpers are plain CommonJS: electron-builder loads them with its own Node.
const require = createRequire(import.meta.url);
const bytecode = require("../scripts/bytecode.cjs") as {
	normalizeArch(arch: number | string): string;
	compileMainBytecode(options: { electronPath: string; arch: string; platformName: string; bundlePath: string; jscPath: string }): { bytes: number; sourceLength: number };
	verifyMainBytecode(options: { electronPath: string; arch: string; platformName: string; jscPath: string }): { bytes: number; sourceLength: number };
	parseAsar(asarPath: string): { entry(name: string): { size: number; offset: string } | undefined; read(node: { size: number; offset: string }): Buffer };
	auditPackagedAsar(options: { asarPath: string; stubPath: string }): { stubBytes: number; jscBytes: number; sourceLength: number; preloadBytes: number };
	verifyAsarBytecode(options: { asarPath: string; electronPath: string; arch: string; platformName: string }): { bytes: number; sourceLength: number };
};

const appDir = join(import.meta.dir, "..");
const stubPath = join(appDir, "scripts", "main-loader.cjs");
const electronBinary = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const hasElectron = existsSync(electronBinary);
// RUN_AS_NODE spawns never open a window; GUI-mode launches need a display.
const hasDisplay = process.platform !== "linux" || Boolean(process.env.DISPLAY);
const platformName = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";

describe("normalizeArch", () => {
	test("maps builder-util's Arch enum values and names", () => {
		expect(bytecode.normalizeArch(1)).toBe("x64");
		expect(bytecode.normalizeArch(3)).toBe("arm64");
		expect(bytecode.normalizeArch("x64")).toBe("x64");
		expect(bytecode.normalizeArch("arm64")).toBe("arm64");
		expect(() => bytecode.normalizeArch(0)).toThrow(/ia32/);
		expect(() => bytecode.normalizeArch("universal")).toThrow(/universal/);
	});
});

/** A synthetic app.asar with the same pickle layout the real packer writes. */
function makeAsar(dir: string, name: string, files: Array<[string, Buffer]>): string {
	type Leaf = { size: number; offset: string };
	type Dir = { files: Record<string, Dir | Leaf> };
	const tree: Dir = { files: {} };
	const blobs: Buffer[] = [];
	let offset = 0;
	for (const [member, buf] of files) {
		const parts = member.split("/");
		let node: Dir = tree;
		for (const part of parts.slice(0, -1)) {
			const existing = node.files[part];
			if (!existing || !("files" in existing)) node.files[part] = { files: {} };
			node = node.files[part] as Dir;
		}
		node.files[parts[parts.length - 1]!] = { size: buf.length, offset: String(offset) };
		blobs.push(buf);
		offset += buf.length;
	}
	const header = Buffer.from(JSON.stringify(tree), "utf8");
	const dataStart = 16 + Math.ceil(header.length / 4) * 4;
	const out = Buffer.alloc(dataStart + offset);
	out.writeUInt32LE(dataStart - 8, 4);
	out.writeUInt32LE(header.length, 12);
	header.copy(out, 16);
	let at = dataStart;
	for (const buf of blobs) {
		buf.copy(out, at);
		at += buf.length;
	}
	const asarPath = join(dir, name);
	writeFileSync(asarPath, out);
	return asarPath;
}

/** Code-cache-shaped bytes (magic + source length) without compiling anything. */
function fakeJsc(sourceLength: number): Buffer {
	const buf = Buffer.alloc(Math.max(64, sourceLength));
	buf.writeUInt32LE(0xc0de06cf, 0);
	buf.writeUInt32LE(sourceLength, 8);
	return buf;
}

describe("parseAsar and auditPackagedAsar", () => {
	const dir = mkdtempSync(join(tmpdir(), "dinobot-asar-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const wellFormed = () => makeAsar(dir, "ok.asar", [
		["package.json", Buffer.from('{"name":"probe","main":"dist/main.cjs"}')],
		["dist/main.cjs", readFileSync(stubPath)],
		["dist/main.jsc", fakeJsc(328158)],
		["dist/preload.cjs", Buffer.from("var e=require('electron');")],
	]);

	test("reads nested members and payloads", () => {
		const asar = bytecode.parseAsar(wellFormed());
		const node = asar.entry("dist/main.cjs");
		expect(node).toBeDefined();
		expect(asar.read(node!).equals(readFileSync(stubPath))).toBe(true);
		expect(asar.entry("dist/main-bundle.cjs")).toBeUndefined();
	});

	test("accepts a well-formed archive", () => {
		const audit = bytecode.auditPackagedAsar({ asarPath: wellFormed(), stubPath });
		expect(audit.stubBytes).toBe(readFileSync(stubPath).length);
		expect(audit.jscBytes).toBe(fakeJsc(328158).length);
		expect(audit.sourceLength).toBe(328158);
	});

	test("rejects a main.cjs that is not the loader stub", () => {
		const asarPath = makeAsar(dir, "tampered.asar", [
			["dist/main.cjs", Buffer.from("module.exports = require('./main-bundle.cjs');")],
			["dist/main.jsc", fakeJsc(100)],
			["dist/preload.cjs", Buffer.from("var e=1;")],
		]);
		expect(() => bytecode.auditPackagedAsar({ asarPath, stubPath })).toThrow(/loader stub/);
	});

	test("rejects a leaked plain main bundle", () => {
		const asarPath = makeAsar(dir, "leak.asar", [
			["dist/main.cjs", readFileSync(stubPath)],
			["dist/main-bundle.cjs", Buffer.from("var plain = 'source';")],
			["dist/main.jsc", fakeJsc(100)],
			["dist/preload.cjs", Buffer.from("var e=1;")],
		]);
		expect(() => bytecode.auditPackagedAsar({ asarPath, stubPath })).toThrow(/main-bundle\.cjs leaked/);
	});

	test("rejects a missing bytecode file", () => {
		const asarPath = makeAsar(dir, "nojsc.asar", [
			["dist/main.cjs", readFileSync(stubPath)],
			["dist/preload.cjs", Buffer.from("var e=1;")],
		]);
		expect(() => bytecode.auditPackagedAsar({ asarPath, stubPath })).toThrow(/main\.jsc is missing/);
	});

	test("rejects a preload that is not minified (comments, source maps)", () => {
		const commented = makeAsar(dir, "comment.asar", [
			["dist/main.cjs", readFileSync(stubPath)],
			["dist/main.jsc", fakeJsc(100)],
			["dist/preload.cjs", Buffer.from("// src/preload.ts\nvar e=1;")],
		]);
		expect(() => bytecode.auditPackagedAsar({ asarPath: commented, stubPath })).toThrow(/comment/);
		const mapped = makeAsar(dir, "mapped.asar", [
			["dist/main.cjs", readFileSync(stubPath)],
			["dist/main.jsc", fakeJsc(100)],
			["dist/preload.cjs", Buffer.from("var e=1;\n//# sourceMappingURL=preload.cjs.map")],
		]);
		expect(() => bytecode.auditPackagedAsar({ asarPath: mapped, stubPath })).toThrow(/source map/);
	});
});

describe("compile and verify with the host Electron", () => {
	test.skipIf(!hasElectron)("a compiled cache is accepted by the same Electron", () => {
		const work = mkdtempSync(join(tmpdir(), "dinobot-bytecode-"));
		try {
			const bundlePath = join(work, "main-bundle.cjs");
			writeFileSync(bundlePath, 'const marker = "probe";\nmodule.exports = { value: () => marker + "-ok" };\n');
			const jscPath = join(work, "main.jsc");
			const compiled = bytecode.compileMainBytecode({ electronPath: electronBinary, arch: process.arch, platformName, bundlePath, jscPath });
			expect(compiled.bytes).toBeGreaterThan(100);
			const verified = bytecode.verifyMainBytecode({ electronPath: electronBinary, arch: process.arch, platformName, jscPath });
			expect(verified.bytes).toBe(compiled.bytes);
			expect(verified.sourceLength).toBe(compiled.sourceLength);
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	});

	test.skipIf(!hasElectron)("compilation refuses an architecture the binary does not run", () => {
		const work = mkdtempSync(join(tmpdir(), "dinobot-bytecode-arch-"));
		try {
			const bundlePath = join(work, "main-bundle.cjs");
			writeFileSync(bundlePath, "module.exports = {};");
			const wrong = process.arch === "x64" ? "arm64" : "x64";
			expect(() => bytecode.compileMainBytecode({ electronPath: electronBinary, arch: wrong, platformName, bundlePath, jscPath: join(work, "main.jsc") })).toThrow();
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	});

	test.skipIf(!hasElectron)("the real main bundle compiles and verifies", () => {
		const build = spawnSync(process.execPath, [join(appDir, "scripts", "build-main.ts")], { cwd: appDir, encoding: "utf8" });
		expect(build.status).toBe(0);
		const work = mkdtempSync(join(tmpdir(), "dinobot-bytecode-real-"));
		try {
			const jscPath = join(work, "main.jsc");
			const compiled = bytecode.compileMainBytecode({ electronPath: electronBinary, arch: process.arch, platformName, bundlePath: join(appDir, "dist", "main-bundle.cjs"), jscPath });
			expect(compiled.sourceLength).toBeGreaterThan(100_000);
			bytecode.verifyMainBytecode({ electronPath: electronBinary, arch: process.arch, platformName, jscPath });
			// And the archived copy verifies through the asar reader too.
			const asarPath = makeAsar(work, "real.asar", [
				["dist/main.cjs", readFileSync(stubPath)],
				["dist/main.jsc", readFileSync(jscPath)],
				["dist/preload.cjs", readFileSync(join(appDir, "dist", "preload.cjs"))],
			]);
			const verified = bytecode.verifyAsarBytecode({ asarPath, electronPath: electronBinary, arch: process.arch, platformName });
			expect(verified.bytes).toBe(compiled.bytes);
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	});
});

describe("the shipped loader stub (GUI main process)", () => {
	test.skipIf(!hasElectron || !hasDisplay)("runs the bytecode branch when packaged-style bytecode is present", () => {
		const work = mkdtempSync(join(tmpdir(), "dinobot-stub-bytecode-"));
		try {
			const probeApp = join(work, "app");
			mkdirSync(probeApp);
			writeFileSync(join(probeApp, "package.json"), JSON.stringify({ name: "probe", version: "1.0.0", main: "main.cjs", private: true }, null, 2));
			copyFileSync(stubPath, join(probeApp, "main.cjs"));
			const marker = join(work, "ok.txt");
			// The dev branch must not run: it would write its own marker instead.
			writeFileSync(join(probeApp, "main-bundle.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "dev-branch");\n`);
			const source = join(work, "probe-src.cjs");
			writeFileSync(source, [
				'const fs = require("node:fs");',
				'const electron = require("electron");',
				`fs.writeFileSync(${JSON.stringify(marker)}, "bytecode-branch arch=" + process.arch + " app=" + typeof electron.app);`,
				"setTimeout(() => electron.app.quit(), 200);",
				"module.exports = { ran: true };",
			].join("\n"));
			bytecode.compileMainBytecode({ electronPath: electronBinary, arch: process.arch, platformName, bundlePath: source, jscPath: join(probeApp, "main.jsc") });
			const run = spawnSync(electronBinary, [probeApp], {
				env: { ...process.env, DINOBOT_TEST_BYTECODE: "1" },
				encoding: "utf8",
				timeout: 60_000,
			});
			expect(run.status).toBe(0);
			const text = readFileSync(marker, "utf8");
			expect(text.startsWith("bytecode-branch")).toBe(true);
			expect(text).toContain("app=object");
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	});

	test.skipIf(!hasElectron || !hasDisplay)("runs the plain bundle in the dev tree", () => {
		const work = mkdtempSync(join(tmpdir(), "dinobot-stub-dev-"));
		try {
			const probeApp = join(work, "app");
			mkdirSync(probeApp);
			writeFileSync(join(probeApp, "package.json"), JSON.stringify({ name: "probe", version: "1.0.0", main: "main.cjs", private: true }, null, 2));
			copyFileSync(stubPath, join(probeApp, "main.cjs"));
			const marker = join(work, "ok.txt");
			writeFileSync(join(probeApp, "main-bundle.cjs"), [
				'const fs = require("node:fs");',
				'const electron = require("electron");',
				`fs.writeFileSync(${JSON.stringify(marker)}, "dev-branch isPackaged=" + electron.app.isPackaged);`,
				"setTimeout(() => electron.app.quit(), 200);",
			].join("\n"));
			const run = spawnSync(electronBinary, [probeApp], { encoding: "utf8", timeout: 60_000 });
			expect(run.status).toBe(0);
			expect(readFileSync(marker, "utf8").startsWith("dev-branch")).toBe(true);
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	});
});
