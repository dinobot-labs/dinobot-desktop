import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyDaemonCommand, daemonRuntime, processCommandLine, shouldCheckDaemonUpdate } from "../src/features/daemon-process.ts";

describe("which daemon answers decides the dinobot update check", () => {
	const bundledMain = "/Applications/dinobot.app/Contents/Resources/daemon/node_modules/dinobot/main.js";

	test("a CLI-installed daemon is external even though the app would start its bundled one", () => {
		// Synthetic case: the app ships a daemon, but a globally installed daemon holds the port.
		const runtime = classifyDaemonCommand(
			"/Users/example/.bun/bin/bun /Users/example/.bun/install/global/node_modules/dinobot/main.js serve --config /Users/example/.config/dinobot/dinobot.yaml",
			bundledMain,
			"darwin",
		);
		expect(runtime).toBe("external");
		expect(shouldCheckDaemonUpdate(runtime, true)).toBe(true);
	});

	test("the bundled daemon is skipped: it updates with the app", () => {
		const runtime = classifyDaemonCommand(`/Applications/dinobot.app/Contents/Resources/daemon/bun ${bundledMain} serve --config /x.yaml`, bundledMain, "darwin");
		expect(runtime).toBe("bundled");
		expect(shouldCheckDaemonUpdate(runtime, true)).toBe(false);
	});

	test("Windows paths compare without case or slash differences", () => {
		const main = "C:\\Users\\a\\AppData\\Local\\Programs\\dinobot\\resources\\daemon\\node_modules\\dinobot\\main.js";
		expect(classifyDaemonCommand(`"C:\\Users\\a\\AppData\\Local\\Programs\\dinobot\\resources\\daemon\\bun.exe" c:/users/a/appdata/local/programs/dinobot/resources/daemon/node_modules/dinobot/main.js serve`, main, "win32")).toBe("bundled");
		expect(classifyDaemonCommand("C:\\Users\\a\\.bun\\bin\\dinobot.exe serve", main, "win32")).toBe("external");
	});

	test("no bundled daemon means any readable daemon is external; unreadable falls back to what the app starts", () => {
		expect(classifyDaemonCommand("dinobot serve", null)).toBe("external");
		expect(classifyDaemonCommand(null, bundledMain)).toBe("unknown");
		expect(shouldCheckDaemonUpdate("unknown", true)).toBe(false);
		expect(shouldCheckDaemonUpdate("unknown", false)).toBe(true);
	});
});

describe.skipIf(process.platform === "win32")("real process command lines", () => {
	let dir: string;
	let bundled: ChildProcess;
	let external: ChildProcess;
	let bundledMain: string;

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "daemon-process-"));
		const make = (root: string) => {
			const pkg = join(root, "node_modules", "dinobot");
			mkdirSync(pkg, { recursive: true });
			const main = join(pkg, "main.js");
			writeFileSync(main, "setInterval(() => {}, 1000);\n");
			return main;
		};
		bundledMain = make(join(dir, "app", "daemon"));
		const externalMain = make(join(dir, "global"));
		bundled = spawn(process.execPath, [bundledMain, "serve"], { stdio: "ignore" });
		external = spawn(process.execPath, [externalMain, "serve"], { stdio: "ignore" });
	});
	afterAll(() => {
		bundled?.kill();
		external?.kill();
		rmSync(dir, { recursive: true, force: true });
	});

	test("classifies running daemons by their pid", async () => {
		expect(await daemonRuntime(bundled.pid!, bundledMain)).toBe("bundled");
		expect(await daemonRuntime(external.pid!, bundledMain)).toBe("external");
	});

	test("a pid that does not exist cannot be read", async () => {
		expect(await processCommandLine(2_147_483_000)).toBeNull();
		expect(await processCommandLine(-1)).toBeNull();
	});
});
