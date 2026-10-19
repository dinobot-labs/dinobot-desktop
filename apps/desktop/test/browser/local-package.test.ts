import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { localArtifactOptions, readLocalArtifact, readPins, sameDaemon, stageDaemon, validatePins, type StagedDaemon } from "../../scripts/stage-daemon.ts";

const roots: string[] = [];
const version = "0.7.15-local.browser.1";
const pins = { dinobot: version, bun: "1.4.3" };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(manifest: object = { name: "dinobot", version }, content = "fixture") {
 const root = mkdtempSync(join(import.meta.dir, ".local-package-")); roots.push(root);
 mkdirSync(join(root, "package"));
 writeFileSync(join(root, "package/package.json"), JSON.stringify(manifest));
 writeFileSync(join(root, "package/main.js"), content);
 const tar = process.platform === "win32" ? join(process.env.SystemRoot!, "System32", "tar.exe") : "tar";
 const result = Bun.spawnSync([tar, "-czf", "artifact.tgz", "package/package.json", "package/main.js"], { cwd: root, stderr: "pipe" });
 expect(result.exitCode).toBe(0);
 const tarball = join(root, "artifact.tgz");
 const bytes = readFileSync(tarball);
 return { tarball, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}

test("exact daemon prereleases and stable Bun pins are accepted, without ranges or unsafe versions", async () => {
 expect(await readPins()).toEqual(pins);
 for (const dinobot of ["1.2.3", version, "1.2.3-rc.0+build.9", "1.2.3-01a"]) expect(validatePins({ ...pins, dinobot }).dinobot).toBe(dinobot);
 for (const dinobot of ["latest", "^1.2.3", "1.2.3 || 9.0.0", "01.2.3", "1.2.3-01", "1.2.3-rc..1", "1x2x3", "1.2.3/evil", "1.2.3\n", "1.2.3+", "1.2.3+a..b"]) expect(() => validatePins({ ...pins, dinobot })).toThrow("exact");
 for (const bun of ["1.4.3-local.1", "^1.4.3", "01.4.3", "1.4.3\n", "1.4.3+build"]) expect(() => validatePins({ ...pins, bun })).toThrow("stable Bun");
});

test("registry path remains default; local tarball requires exactly one explicit hash", () => {
 expect(localArtifactOptions([])).toBeUndefined();
 expect(localArtifactOptions(["--os", "mac", "--arch", "x64", "--arch", "arm64"])).toBeUndefined();
 const hash = "AB".repeat(32);
 expect(localArtifactOptions(["--dinobot-tarball", "with spaces/artifact.tgz", "--sha256", hash])).toEqual({ tarball: "with spaces/artifact.tgz", sha256: hash.toLowerCase() });
 for (const args of [["--dinobot-tarball", "a.tgz"], ["--sha256", hash], ["--dinobot-tarball", "a", "--sha256", "bad"], ["--dinobot-tarball"], ["--sha256", hash, "--sha256", hash], ["--typo", "bad"]]) expect(() => localArtifactOptions(args)).toThrow();
});

test("local archive verifies actual hash and manifest version/name before staging", async () => {
 const artifact = fixture();
 expect(await readLocalArtifact({ ...artifact, sha256: artifact.sha256.toUpperCase() }, version)).toEqual({ bytes: artifact.bytes, sha256: artifact.sha256 });
 await expect(readLocalArtifact({ ...artifact, sha256: "" }, version)).rejects.toThrow("SHA-256");
 await expect(stageDaemon("win", "x64", pins, { ...artifact, sha256: "0".repeat(64) })).rejects.toThrow("SHA-256 mismatch");
 for (const manifest of [{ name: "other", version }, { name: "dinobot", version: "0.7.14" }]) await expect(stageDaemon("win", "x64", pins, fixture(manifest))).rejects.toThrow("local tarball must contain");
 writeFileSync(artifact.tarball, "different bytes at the same path");
 await expect(readLocalArtifact(artifact, version)).rejects.toThrow("SHA-256 mismatch");
});

test("same-version different archive bytes and registry/local sources never share cache identity", async () => {
 const first = fixture(undefined, "first");
 const second = fixture(undefined, "second");
 expect(first.sha256).not.toBe(second.sha256);
 const marker: StagedDaemon = { ...pins, os: "win", arch: "x64", dinobotSha256: first.sha256 };
 expect(sameDaemon(marker, { ...marker })).toBe(true);
 expect(sameDaemon(marker, { ...marker, dinobotSha256: second.sha256 })).toBe(false);
 const registry: StagedDaemon = { ...pins, os: "win", arch: "x64" };
 expect(sameDaemon(marker, registry)).toBe(false);
 expect(sameDaemon(registry, marker)).toBe(false);
 expect(sameDaemon(registry, { ...registry })).toBe(true);
 for (const change of [{ bun: "1.4.4" }, { dinobot: "0.7.14" }, { os: "mac" as const }, { arch: "arm64" as const }]) expect(sameDaemon(marker, { ...marker, ...change })).toBe(false);
});

test("cached local bundle validates source digest before reuse and rejects an obsolete host", async () => {
 const artifact = fixture();
 const root = mkdtempSync(join(import.meta.dir, ".local-package-")); roots.push(root);
 const scripts = join(root, "scripts"); mkdirSync(scripts);
 for (const file of ["stage-daemon.ts", "browser-protocol.ts"]) copyFileSync(join(import.meta.dir, "../../scripts", file), join(scripts, file));
 const isolated = await import(pathToFileURL(join(scripts, "stage-daemon.ts")).href) as typeof import("../../scripts/stage-daemon.ts");
 const directory = isolated.stageDir("win", "x64");
 const pkg = join(directory, "node_modules/dinobot"); mkdirSync(pkg, { recursive: true });
 writeFileSync(join(directory, "bun.exe"), "unused cache-hit fixture");
 writeFileSync(join(pkg, "main.js"), "unused cache-hit fixture");
 writeFileSync(join(directory, "daemon.json"), JSON.stringify({ ...pins, os: "win", arch: "x64", dinobotSha256: artifact.sha256 }));
 writeFileSync(join(pkg, "browser-host.js"), 'const request=JSON.parse(await Bun.stdin.text()); console.log(JSON.stringify({id:request.id,ok:true,result:{ui:{ok:true,state:{connected:false,mode:"dedicated"}}}}));');
 expect(await isolated.stageDaemon("win", "x64", pins, artifact)).toBe(directory);
 await expect(isolated.stageDaemon("win", "x64", pins, { ...artifact, sha256: "0".repeat(64) })).rejects.toThrow("SHA-256 mismatch");
 writeFileSync(join(pkg, "browser-host.js"), 'console.log(JSON.stringify({id:1,ok:false,error:"InvalidArguments: unknown action ui_state"}));');
 await expect(isolated.stageDaemon("win", "x64", pins, artifact)).rejects.toThrow("Release the updated browser host");
});
