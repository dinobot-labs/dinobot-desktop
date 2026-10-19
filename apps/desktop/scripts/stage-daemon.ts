// Stages the dinobot daemon that ships inside the desktop app: a pinned Bun runtime plus the pinned `dinobot` npm
// package (with the native addon for the target platform), in vendor/daemon/<os>-<arch>/ where electron-builder's
// extraResources picks it up as resources/daemon. The pins live in package.json "dinobotDaemon".
//
//   bun scripts/stage-daemon.ts                       host platform
//   bun scripts/stage-daemon.ts --os mac --arch arm64 --arch x64
//   bun scripts/stage-daemon.ts --dinobot-tarball /path/dinobot.tgz --sha256 <64 hex digits>
//
// Layout of each target: bun(.exe), node_modules/dinobot/main.js, node_modules/{@oh-my-pi,patchright,...}, daemon.json.
// The Bun download is checked against the release's SHASUMS256.txt. A target whose daemon.json already matches the
// pins is left as is.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSharedBrowserHost } from "./browser-protocol.ts";

type Os = "win" | "mac" | "linux";
type Arch = "x64" | "arm64";
export type DaemonPins = { readonly dinobot: string; readonly bun: string };
export type LocalArtifact = { readonly tarball: string; readonly sha256: string };
export type StagedDaemon = DaemonPins & { readonly os: Os; readonly arch: Arch; readonly dinobotSha256?: string };

const DESKTOP = join(import.meta.dir, "..");
const VENDOR = join(DESKTOP, "vendor");
const CACHE = join(VENDOR, "cache");

const NPM_OS: Record<Os, string> = { win: "win32", mac: "darwin", linux: "linux" };
/** Bun release asset per target. x64 uses the baseline build so CPUs without AVX2 still run it. */
export function bunAsset(os: Os, arch: Arch): string {
	const platform = os === "win" ? "windows" : os === "mac" ? "darwin" : "linux";
	return `bun-${platform}-${arch === "arm64" ? "aarch64" : "x64-baseline"}`;
}
export const bunExecutable = (os: Os) => (os === "win" ? "bun.exe" : "bun");
export const stageDir = (os: Os, arch: Arch) => join(VENDOR, "daemon", `${os}-${arch}`);

function hostOs(): Os {
	if (process.platform === "win32") return "win";
	if (process.platform === "darwin") return "mac";
	return "linux";
}

const tarExecutable = () => process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

function run(cmd: string[], cwd: string, input?: Uint8Array): string {
	const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", ...(input ? { stdin: input } : {}) });
	if (proc.exitCode !== 0) throw new Error(`failed (${proc.exitCode}): ${cmd.join(" ")}\n${proc.stderr.toString()}${proc.stdout.toString()}`);
	return proc.stdout.toString();
}

async function download(url: string, path: string): Promise<void> {
	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
	const temporary = `${path}.${process.pid}.part`;
	await writeFile(temporary, new Uint8Array(await response.arrayBuffer()));
	await rename(temporary, path);
}

async function bunZip(version: string, asset: string): Promise<string> {
	await mkdir(CACHE, { recursive: true });
	const base = `https://github.com/oven-sh/bun/releases/download/bun-v${version}`;
	const sums = join(CACHE, `bun-v${version}-SHASUMS256.txt`);
	if (!existsSync(sums)) await download(`${base}/SHASUMS256.txt`, sums);
	const line = (await readFile(sums, "utf8")).split(/\r?\n/).find((l) => l.trim().endsWith(` ${asset}.zip`));
	const expected = line?.trim().split(/\s+/)[0]?.toLowerCase();
	if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Error(`no checksum for ${asset}.zip in bun v${version} SHASUMS256.txt`);
	const zip = join(CACHE, `bun-v${version}-${asset}.zip`);
	for (let attempt = 0; attempt < 2; attempt++) {
		if (!existsSync(zip)) await download(`${base}/${asset}.zip`, zip);
		const actual = createHash("sha256").update(await readFile(zip)).digest("hex");
		if (actual === expected) return zip;
		await rm(zip, { force: true });
	}
	throw new Error(`${asset}.zip does not match its published SHA-256`);
}

/**
 * Windows briefly locks a folder whose freshly written executables are being scanned (Defender) or whose smoke-test
 * process is still exiting, and rename fails with EPERM/EBUSY/EACCES. Retry for a few seconds before giving up.
 */
async function renameRetrying(from: string, to: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await rename(from, to);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (attempt >= 20 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) throw error;
			await Bun.sleep(500);
		}
	}
}

// Exact SemVer only: no ranges, tags, whitespace, shell syntax or leading-zero numeric identifiers.
const NUMBER = "(?:0|[1-9][0-9]*)";
const STABLE = NUMBER + "\\." + NUMBER + "\\." + NUMBER;
const IDENTIFIER = "(?:" + NUMBER + "|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const EXACT = new RegExp("^" + STABLE + "(?:-" + IDENTIFIER + "(?:\\." + IDENTIFIER + ")*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$");
const STABLE_ONLY = new RegExp("^" + STABLE + "$");

export function validatePins(value: Partial<DaemonPins>): DaemonPins {
	const { dinobot, bun } = value;
	if (typeof dinobot !== "string" || dinobot.length > 128 || EXACT.exec(dinobot)?.[0] !== dinobot
		|| typeof bun !== "string" || STABLE_ONLY.exec(bun)?.[0] !== bun) {
		throw new Error("dinobotDaemon needs an exact dinobot SemVer and exact stable Bun version");
	}
	return { dinobot, bun };
}

export async function readPins(): Promise<DaemonPins> {
	const pkg = JSON.parse(await readFile(join(DESKTOP, "package.json"), "utf8")) as { dinobotDaemon?: Partial<DaemonPins> };
	return validatePins(pkg.dinobotDaemon ?? {});
}

export function localArtifactOptions(args: string[]): LocalArtifact | undefined {
	const values = new Map<string, string>();
	for (let i = 0; i < args.length; i += 2) {
		const key = args[i]!;
		const value = args[i + 1];
		if (!["--os", "--arch", "--dinobot-tarball", "--sha256"].includes(key) || !value || value.startsWith("--")) throw new Error("invalid or missing option value: " + key);
		if (key !== "--arch" && values.has(key)) throw new Error("duplicate option: " + key);
		values.set(key, value);
	}
	const tarball = values.get("--dinobot-tarball");
	const sha256 = values.get("--sha256");
	if (tarball === undefined && sha256 === undefined) return undefined;
	if (!tarball || !sha256 || !/^[0-9a-fA-F]{64}$/.test(sha256)) throw new Error("--dinobot-tarball requires --sha256 with exactly 64 hex digits (and vice versa)");
	return { tarball, sha256: sha256.toLowerCase() };
}

/** Validate immutable archive bytes before any install or cache hit; never read the source path again. */
export async function readLocalArtifact(artifact: LocalArtifact, version: string): Promise<{ bytes: Buffer; sha256: string }> {
	if (!/^[0-9a-fA-F]{64}$/.test(artifact.sha256)) throw new Error("local artifact requires a SHA-256 digest");
	const bytes = await readFile(artifact.tarball);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	if (sha256 !== artifact.sha256.toLowerCase()) throw new Error("local dinobot tarball SHA-256 mismatch");
	const manifest = JSON.parse(run([tarExecutable(), "-xzOf", "-", "package/package.json"], DESKTOP, bytes)) as { name?: string; version?: string };
	if (manifest.name !== "dinobot" || manifest.version !== version) throw new Error("local tarball must contain dinobot@" + version);
	return { bytes, sha256 };
}

export function sameDaemon(have: Partial<StagedDaemon>, want: StagedDaemon): boolean {
	return have.dinobot === want.dinobot && have.bun === want.bun && have.os === want.os && have.arch === want.arch && have.dinobotSha256 === want.dinobotSha256;
}

export async function stageDaemon(os: Os, arch: Arch, pins: DaemonPins, artifact?: LocalArtifact): Promise<string> {
	validatePins(pins);
	const local = artifact ? await readLocalArtifact(artifact, pins.dinobot) : undefined;
	const out = stageDir(os, arch);
	const want: StagedDaemon = { ...pins, os, arch, ...(local ? { dinobotSha256: local.sha256 } : {}) };
	const marker = join(out, "daemon.json");
	if (existsSync(marker) && existsSync(join(out, bunExecutable(os))) && existsSync(join(out, "node_modules", "dinobot", "main.js"))) {
		const have = JSON.parse(await readFile(marker, "utf8")) as Partial<StagedDaemon>;
		if (sameDaemon(have, want)) {
			assertSharedBrowserHost(out);
			console.log(`daemon ${os}-${arch}: up to date (dinobot ${pins.dinobot}, bun ${pins.bun})`);
			return out;
		}
	}
	const work = `${out}.${process.pid}.tmp`;
	await rm(work, { recursive: true, force: true });
	await mkdir(work, { recursive: true });
	try {
		// Bun runtime.
		const asset = bunAsset(os, arch);
		const zip = await bunZip(pins.bun, asset);
		const unpack = join(work, ".unpack");
		await mkdir(unpack);
		// Windows: the system bsdtar reads zip files (a Git-for-Windows GNU tar earlier on PATH does not).
		const tar = tarExecutable();
		run([tar, "-xf", zip, "-C", unpack], work);
		const bun = join(unpack, asset, bunExecutable(os));
		if (!existsSync(bun)) throw new Error(`${asset}.zip has no ${asset}/${bunExecutable(os)}`);
		await copyFile(bun, join(work, bunExecutable(os)));
		await chmod(join(work, bunExecutable(os)), 0o755);
		await rm(unpack, { recursive: true, force: true });

		// dinobot and its two external dependencies (the per-platform native addon and patchright), for the target.
		let source = `dinobot@${pins.dinobot}`;
		if (local) {
			// Content-addressed cache: the same version with different bytes cannot alias.
			source = join(CACHE, `dinobot-${pins.dinobot}-${local.sha256}.tgz`);
			await writeFile(source, local.bytes);
		}
		const npm = process.platform === "win32" ? "npm.cmd" : "npm";
		run([npm, "install", "--prefix", work, "--no-save", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", `--os=${NPM_OS[os]}`, `--cpu=${arch}`, source], work);
		const main = join(work, "node_modules", "dinobot", "main.js");
		if (!existsSync(main)) throw new Error("npm did not install node_modules/dinobot/main.js");
		const installed = (JSON.parse(await readFile(join(work, "node_modules", "dinobot", "package.json"), "utf8")) as { version: string }).version;
		if (installed !== pins.dinobot) throw new Error(`npm installed dinobot ${installed}, expected ${pins.dinobot}`);
		const scoped = await readdir(join(work, "node_modules", "@oh-my-pi")).catch(() => [] as string[]);
		if (!scoped.includes(`pi-natives-${NPM_OS[os]}-${arch}`)) throw new Error(`native addon @oh-my-pi/pi-natives-${NPM_OS[os]}-${arch} was not installed`);
		await rm(join(work, "package.json"), { force: true });
		await rm(join(work, "package-lock.json"), { force: true });

		// Smoke test when the target runs here.
		if (os === hostOs() && arch === process.arch) {
			const version = run([join(work, bunExecutable(os)), main, "--version"], work).trim();
			if (version !== pins.dinobot) throw new Error(`staged daemon reports version ${version}, expected ${pins.dinobot}`);
		}
		assertSharedBrowserHost(work);
		await writeFile(join(work, "daemon.json"), `${JSON.stringify(want, null, "\t")}\n`);
		await rm(out, { recursive: true, force: true });
		await mkdir(join(VENDOR, "daemon"), { recursive: true });
		await renameRetrying(work, out);
	} catch (error) {
		await rm(work, { recursive: true, force: true });
		throw error;
	}
	console.log(`daemon ${os}-${arch}: staged dinobot ${pins.dinobot} on bun ${pins.bun}`);
	return out;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1] as string] : []));
	const os = (values("--os")[0] ?? hostOs()) as Os;
	const arches = (values("--arch").length ? values("--arch") : [process.arch]) as Arch[];
	if (!["win", "mac", "linux"].includes(os)) throw new Error(`--os must be win, mac or linux`);
	for (const arch of arches) if (arch !== "x64" && arch !== "arm64") throw new Error(`--arch must be x64 or arm64`);
	const artifact = localArtifactOptions(args);
	const pins = await readPins();
	for (const arch of arches) await stageDaemon(os, arch, pins, artifact);
}
