import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonLaunch } from "../src/daemon.ts";

const dir = mkdtempSync(join(tmpdir(), "dinobot-launch-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const hasBun = (() => {
	try {
		execFileSync(process.platform === "win32" ? "where.exe" : "which", ["bun"], { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
})();

test.if(process.platform === "win32" && hasBun)("a Windows bun launcher resolves to the interpreter and script, so the child pid is the daemon pid", async () => {
	mkdirSync(join(dir, "bin"));
	mkdirSync(join(dir, "install", "global", "node_modules", "pkg"), { recursive: true });
	writeFileSync(join(dir, "install", "global", "node_modules", "pkg", "main.js"), "");
	writeFileSync(join(dir, "bin", "pkg.exe"), "");
	writeFileSync(join(dir, "bin", "pkg.bunx"), Buffer.concat([Buffer.from('install\\global\\node_modules\\pkg\\main.js"\0bun V\0', "utf16le"), Buffer.from([8, 0, 0x35, 0xab])]));
	const launch = await daemonLaunch(join(dir, "bin", "pkg.exe"));
	expect(launch.file.toLowerCase().endsWith("bun.exe")).toBe(true);
	expect(launch.prefix).toEqual([join(dir, "install", "global", "node_modules", "pkg", "main.js")]);
});

test.if(hasBun)("a source checkout's src/main.ts (DINOBOT_BIN) runs with bun", async () => {
	const script = join(dir, "dinobot", "src", "main.ts");
	mkdirSync(join(dir, "dinobot", "src"), { recursive: true });
	writeFileSync(script, "");
	const launch = await daemonLaunch(script);
	expect(launch.file).toMatch(/bun(\.exe)?$/i);
	expect(launch.prefix).toEqual([script]);
});

test("anything else runs as is", async () => {
	writeFileSync(join(dir, "plain.exe"), "");
	expect(await daemonLaunch(join(dir, "plain.exe"))).toEqual({ file: join(dir, "plain.exe"), prefix: [] });
	expect(await daemonLaunch("/usr/local/bin/dinobot")).toEqual({ file: "/usr/local/bin/dinobot", prefix: [] });
});
