"use strict";
// V8 bytecode pipeline for the packaged Electron main process.
//
//   electron-builder afterExtract  compiles dist/main-bundle.cjs into dist/main.jsc with the
//                                   exact target Electron binary and architecture (before the
//                                   app files are copied into app.asar).
//   electron-builder afterPack      audits app.asar (loader stub + main.jsc in, plain bundle
//                                   and preload comments out) and load-verifies the archived
//                                   bytecode with the packaged binary.
//
// CLI (CI verify steps):
//   bun scripts/bytecode.cjs verify-packaged --asar <app.asar> --electron <binary> --arch <x64|arm64> [--platform win32|darwin|linux]
//
// The loader stub itself is scripts/main-loader.cjs (shipped as dist/main.cjs). Preload stays
// plain (minified) JavaScript: the renderer sandbox has no node:vm/node:fs to load bytecode.
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const CODE_CACHE_MAGIC = 0xc0de06cf;

/** builder-util's Arch enum value or name -> "x64" | "arm64". */
function normalizeArch(arch) {
	const byNumber = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };
	const name = typeof arch === "number" ? byNumber[arch] : String(arch);
	if (name !== "x64" && name !== "arm64") throw new Error(`unsupported architecture for bytecode: ${name}`);
	return name;
}

/** The Electron binary inside a freshly extracted (afterExtract) or renamed (afterPack) appOutDir. */
function extractedElectronBinary(appOutDir, platformName, productName) {
	const candidates = platformName === "win32"
		? ["electron.exe", `${productName}.exe`]
		: platformName === "darwin"
			? [path.join("Electron.app", "Contents", "MacOS", "Electron"), path.join(`${productName}.app`, "Contents", "MacOS", productName)]
			: ["electron", productName];
	for (const candidate of candidates) {
		const binary = path.join(appOutDir, candidate);
		if (existsSync(binary)) return binary;
	}
	throw new Error(`no Electron binary found in ${appOutDir} (looked for: ${candidates.join(", ")})`);
}

/** Run an Electron binary as plain Node. On darwin always select the slice for `arch` (/usr/bin/arch, Rosetta for x64). */
function runElectronAsNode(electronPath, args, { arch, platformName, timeout }) {
	let command = electronPath;
	let finalArgs = args;
	if (platformName === "darwin") {
		command = "/usr/bin/arch";
		finalArgs = [arch === "x64" ? "-x86_64" : "-arm64", electronPath, ...args];
	}
	return spawnSync(command, finalArgs, {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
		encoding: "utf8",
		timeout: timeout ?? 180_000,
		maxBuffer: 256 * 1024 * 1024,
	});
}

// Child script: compile the CommonJS bundle into a V8 code cache.
// argv: [bundlePath, jscPath, expectedArch]
const COMPILE_CHILD = `
const fs = require("node:fs");
const vm = require("node:vm");
const Module = require("node:module");
const v8 = require("node:v8");
v8.setFlagsFromString("--no-lazy");
v8.setFlagsFromString("--no-flush-bytecode");
const bundlePath = process.argv[1], outPath = process.argv[2], expectedArch = process.argv[3];
if (process.arch !== expectedArch) {
	console.error("COMPILE-ARCH-MISMATCH running=" + process.arch + " expected=" + expectedArch);
	process.exit(1);
}
let code = fs.readFileSync(bundlePath, "utf8");
if (code.startsWith("#!")) code = code.slice(code.indexOf("\\n") + 1);
const wrapped = Module.wrap(code);
const script = new vm.Script(wrapped);
const data = script.createCachedData();
fs.writeFileSync(outPath, data);
console.log("COMPILED bytes=" + data.length + " sourceLen=" + wrapped.length);
`;

// Child script: load a compiled code cache the way the runtime stub does and require V8 to accept it.
// argv: [jscPath]
const VERIFY_CHILD = `
const fs = require("node:fs");
const vm = require("node:vm");
const v8 = require("node:v8");
v8.setFlagsFromString("--no-lazy");
v8.setFlagsFromString("--no-flush-bytecode");
const bytecode = Buffer.from(fs.readFileSync(process.argv[1]));
new vm.Script("0").createCachedData().copy(bytecode, 12, 12, 16);
const script = new vm.Script(" ".repeat(bytecode.readUInt32LE(8)), { cachedData: bytecode });
if (script.cachedDataRejected) {
	console.error("VERIFY-REJECTED versionHash=0x" + bytecode.readUInt32LE(4).toString(16));
	process.exit(1);
}
console.log("VERIFY-OK bytes=" + bytecode.length + " sourceLen=" + bytecode.readUInt32LE(8));
`;

function fail(message) {
	throw new Error(`bytecode: ${message}`);
}

/** Compile the main bundle to dist/main.jsc with the target Electron. Returns { bytes, sourceLength }. */
function compileMainBytecode({ electronPath, arch, platformName, bundlePath, jscPath }) {
	if (!existsSync(bundlePath)) fail(`main bundle not built: ${bundlePath} (run bun run build)`);
	mkdirSync(path.dirname(jscPath), { recursive: true });
	const result = runElectronAsNode(electronPath, ["-e", COMPILE_CHILD, bundlePath, jscPath, arch], { arch, platformName });
	if (result.error) {
		const hint = platformName === "darwin" && arch === "x64" && process.platform === "darwin"
			? " (Apple Silicon running the x64 Electron needs Rosetta 2: softwareupdate --install-rosetta)"
			: "";
		fail(`cannot run ${electronPath} for ${arch}: ${result.error.message}${hint}`);
	}
	if (result.status !== 0) fail(`compiling main bytecode failed (exit ${result.status})\n${result.stdout}${result.stderr}`);
	if (!existsSync(jscPath)) fail(`the compiler wrote no bytecode: ${jscPath}`);
	const data = readFileSync(jscPath);
	if (data.readUInt32LE(0) !== CODE_CACHE_MAGIC) fail(`not a V8 code cache file: ${jscPath}`);
	return { bytes: data.length, sourceLength: data.readUInt32LE(8) };
}

/** Have the target Electron accept the compiled cache (the stub's exact load path). Returns { bytes, sourceLength }. */
function verifyMainBytecode({ electronPath, arch, platformName, jscPath }) {
	const result = runElectronAsNode(electronPath, ["-e", VERIFY_CHILD, jscPath], { arch, platformName });
	if (result.error) fail(`cannot run ${electronPath} for ${arch}: ${result.error.message}`);
	if (result.status !== 0) fail(`bytecode rejected by ${electronPath} (exit ${result.status})\n${result.stdout}${result.stderr}`);
	const data = readFileSync(jscPath);
	return { bytes: data.length, sourceLength: data.readUInt32LE(8) };
}

/** Minimal app.asar reader: header pickle + file table, payloads by offset. */
function parseAsar(asarPath) {
	const buf = readFileSync(asarPath);
	const headerSize = buf.readUInt32LE(12);
	const header = JSON.parse(buf.subarray(16, 16 + headerSize).toString("utf8"));
	const dataOffset = 8 + buf.readUInt32LE(4);
	const entry = (name) => {
		let node = { files: header.files };
		for (const part of name.split("/")) {
			if (!node || !node.files) return undefined;
			node = node.files[part];
			if (!node) return undefined;
		}
		return node;
	};
	const read = (node) => buf.subarray(dataOffset + Number(node.offset), dataOffset + Number(node.offset) + node.size);
	return { entry, read };
}

/** Audit app.asar: loader stub + bytecode in, plain main bundle and preload comments out. */
function auditPackagedAsar({ asarPath, stubPath }) {
	const must = (condition, message) => {
		if (!condition) fail(`asar audit failed: ${message}`);
	};
	const asar = parseAsar(asarPath);
	const stub = readFileSync(stubPath);
	const mainNode = asar.entry("dist/main.cjs");
	must(mainNode, "dist/main.cjs is missing from app.asar");
	const mainBytes = asar.read(mainNode);
	must(Buffer.compare(mainBytes, stub) === 0, "dist/main.cjs in app.asar is not the loader stub (run bun run build:main)");
	const jscNode = asar.entry("dist/main.jsc");
	must(jscNode, "dist/main.jsc is missing from app.asar");
	const jscBytes = asar.read(jscNode);
	must(jscBytes.readUInt32LE(0) === CODE_CACHE_MAGIC, "dist/main.jsc in app.asar is not a V8 code cache");
	must(asar.entry("dist/main-bundle.cjs") === undefined, "dist/main-bundle.cjs leaked into app.asar");
	const preloadNode = asar.entry("dist/preload.cjs");
	must(preloadNode, "dist/preload.cjs is missing from app.asar");
	const preloadText = asar.read(preloadNode).toString("utf8");
	must(!preloadText.includes("sourceMappingURL"), "dist/preload.cjs references a source map");
	must(!/^\/\//m.test(preloadText), "dist/preload.cjs contains a comment line (not minified)");
	return {
		stubBytes: mainBytes.length,
		jscBytes: jscBytes.length,
		sourceLength: jscBytes.readUInt32LE(8),
		preloadBytes: Buffer.byteLength(preloadText),
	};
}

/** Extract dist/main.jsc from app.asar and have the packaged Electron accept it. */
function verifyAsarBytecode({ asarPath, electronPath, arch, platformName }) {
	const node = parseAsar(asarPath).entry("dist/main.jsc");
	if (!node) fail(`dist/main.jsc is missing from app.asar: ${asarPath}`);
	const extracted = `${asarPath}.main.jsc`;
	writeFileSync(extracted, parseAsar(asarPath).read(node));
	try {
		return verifyMainBytecode({ electronPath, arch, platformName, jscPath: extracted });
	} finally {
		rmSync(extracted, { force: true });
	}
}

function hookContext(context) {
	const arch = normalizeArch(context.arch);
	const platformName = context.electronPlatformName;
	const appDir = context.packager.info.appDir;
	const productName = context.packager.appInfo.productFilename;
	const jobs = Number(context.packager.config.concurrency) || 1;
	if (jobs > 1) fail("the bytecode hooks need one architecture packed at a time (concurrency/jobs > 1 would race dist/main.jsc)");
	return { arch, platformName, appDir, productName };
}

/** electron-builder afterExtract: compile dist/main.jsc with the just-extracted target Electron. */
async function afterExtract(context) {
	const { arch, platformName, appDir, productName } = hookContext(context);
	const electronPath = extractedElectronBinary(context.appOutDir, platformName, productName);
	const bundlePath = path.join(appDir, "dist", "main-bundle.cjs");
	const jscPath = path.join(appDir, "dist", "main.jsc");
	const compiled = compileMainBytecode({ electronPath, arch, platformName, bundlePath, jscPath });
	console.log(`[bytecode] afterExtract ${platformName}-${arch}: ${compiled.bytes} bytes (source ${compiled.sourceLength}) via ${electronPath}`);
}

/** electron-builder afterPack: audit app.asar and load-verify its bytecode with the packaged binary. */
async function afterPack(context) {
	const { arch, platformName, appDir, productName } = hookContext(context);
	const asarPath = path.join(context.packager.getResourcesDir(context.appOutDir), "app.asar");
	const stubPath = path.join(appDir, "dist", "main.cjs");
	const audit = auditPackagedAsar({ asarPath, stubPath });
	const electronPath = extractedElectronBinary(context.appOutDir, platformName, productName);
	verifyAsarBytecode({ asarPath, electronPath, arch, platformName });
	console.log(`[bytecode] afterPack ${platformName}-${arch}: app.asar ok (stub ${audit.stubBytes} B, main.jsc ${audit.jscBytes} B, preload ${audit.preloadBytes} B)`);
}

module.exports = {
	afterExtract,
	afterPack,
	normalizeArch,
	extractedElectronBinary,
	compileMainBytecode,
	verifyMainBytecode,
	parseAsar,
	auditPackagedAsar,
	verifyAsarBytecode,
};

if (require.main === module) {
	(async () => {
		const args = process.argv.slice(2);
		const flag = (name) => {
			const index = args.indexOf(`--${name}`);
			return index >= 0 ? args[index + 1] : undefined;
		};
		if (args[0] !== "verify-packaged") {
			console.error("usage: bun scripts/bytecode.cjs verify-packaged --asar <app.asar> --electron <binary> --arch <x64|arm64> [--platform win32|darwin|linux]");
			process.exit(1);
		}
		const asarPath = flag("asar");
		const electronPath = flag("electron");
		const arch = flag("arch");
		if (!asarPath || !electronPath || !arch) {
			console.error("bytecode: --asar, --electron and --arch are required");
			process.exit(1);
		}
		const platformName = flag("platform") ?? (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux");
		const stubPath = path.join(__dirname, "..", "dist", "main.cjs");
		const audit = auditPackagedAsar({ asarPath, stubPath });
		verifyAsarBytecode({ asarPath, electronPath, arch: normalizeArch(arch), platformName });
		console.log(`bytecode: ${asarPath} ok (stub ${audit.stubBytes} B, main.jsc ${audit.jscBytes} B, source ${audit.sourceLength}, preload ${audit.preloadBytes} B)`);
	})().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
