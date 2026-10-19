import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, cp, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import type { DaemonConfig, DaemonStartResult } from "./bridge-types.ts";

const DEFAULT_PORT = 8786;
const START_TIMEOUT_MS = 15_000;

/** Manifest lookup for a GUI app: $DINOBOT_CONFIG, then ~/.config/dinobot/dinobot.yaml (the TUI also checks ./dinobot.yaml, which has no meaning for a desktop app). */
export function manifestPath(): string | null {
	const env = process.env.DINOBOT_CONFIG;
	if (env && existsSync(env)) return resolve(env);
	const home = join(homedir(), ".config", "dinobot", "dinobot.yaml");
	return existsSync(home) ? home : null;
}

function expandHome(path: string): string {
	return path === "~" || path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(1)) : path;
}

/**
 * The daemon shipped inside the app (scripts/stage-daemon.ts): <dir>/bun(.exe), <dir>/node_modules/dinobot/main.js and
 * <dir>/daemon.json. main.ts points this at resources/daemon (packaged) or vendor/daemon/<os>-<arch> (development).
 */
let bundledDir: string | null = null;
export function setBundledDaemonDir(dir: string | null): void {
	bundledDir = dir;
	commandLookup = undefined;
}

export type BundledDaemon = { readonly dir: string; readonly main: string; readonly bun: string; readonly dinobot: string; readonly runtime: string };
const bunName = () => (process.platform === "win32" ? "bun.exe" : "bun");

/** The bundled daemon in `dir`, or null unless all of its parts are there. */
export function bundledDaemonAt(dir: string): BundledDaemon | null {
	const main = join(dir, "node_modules", "dinobot", "main.js");
	const bun = join(dir, bunName());
	if (!existsSync(main) || !existsSync(bun)) return null;
	try {
		const info = JSON.parse(readFileSync(join(dir, "daemon.json"), "utf8")) as { dinobot?: unknown; bun?: unknown; arch?: unknown };
		if (typeof info.dinobot !== "string" || typeof info.bun !== "string") return null;
		return { dir, main, bun, dinobot: info.dinobot, runtime: `${info.dinobot}-bun${info.bun}-${typeof info.arch === "string" ? info.arch : process.arch}` };
	} catch {
		return null;
	}
}

/** The bundled daemon's main.js when `command` is it (the bun runtime sits three levels up). */
function bundledFor(command: string): BundledDaemon | null {
	if (!/[\\/]node_modules[\\/]dinobot[\\/]main\.js$/i.test(command)) return null;
	return bundledDaemonAt(dirname(dirname(dirname(command))));
}

let commandLookup: Promise<string | null> | undefined;
/**
 * The dinobot executable: $DINOBOT_BIN, the daemon bundled with the app (its main.js), then PATH and the bun global
 * bin (development builds without a staged daemon). Looked up once, without blocking the main process.
 */
export function dinobotCommand(): Promise<string | null> {
	commandLookup ??= new Promise((resolve) => {
		const env = process.env.DINOBOT_BIN;
		if (env && existsSync(env)) return resolve(env);
		const bundled = bundledDir === null ? null : bundledDaemonAt(bundledDir);
		if (bundled) return resolve(bundled.main);
		void findOnPath("dinobot", process.platform === "win32" ? [".exe", ".cmd"] : [""]).then((found) => (found ? resolve(found) : finderLookup(resolve)));
	});
	return commandLookup;
}

/**
 * `name` in the PATH directories, read from the environment (UTF-16 safe). where.exe prints in the console code page,
 * which garbles non-ASCII user folders, so it is only the fallback.
 */
export async function findOnPath(name: string, extensions: readonly string[]): Promise<string | null> {
	const dirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").filter((dir) => dir.trim() !== "");
	for (const dir of dirs) {
		for (const extension of extensions) {
			const candidate = join(dir.trim().replace(/^"|"$/g, ""), name + extension);
			if (await access(candidate).then(() => true, () => false)) return candidate;
		}
	}
	return null;
}

function finderLookup(resolve: (value: string | null) => void): void {
	const finder = process.platform === "win32" ? "where.exe" : "which";
	execFile(finder, ["dinobot"], { encoding: "utf8", windowsHide: true, timeout: 5000 }, (error, stdout) => {
		const first = error ? undefined : stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l && (process.platform !== "win32" || /\.(exe|cmd)$/i.test(l)));
		if (first && existsSync(first)) return resolve(first);
		const bun = join(homedir(), ".bun", "bin", process.platform === "win32" ? "dinobot.exe" : "dinobot");
		resolve(existsSync(bun) ? bun : null);
	});
}

let cached: DaemonConfig | undefined;
/** Last config read; the protocol proxy uses it so no request ever touches the disk. */
export const cachedConfig = (): DaemonConfig | undefined => cached;

export async function readDaemonConfig(): Promise<DaemonConfig> {
	cached = await readConfigUncached();
	return cached;
}

async function readConfigUncached(): Promise<DaemonConfig> {
	const path = manifestPath();
	const command = await dinobotCommand();
	const homeDir = homedir();
	const bundled = command !== null && bundledFor(command) !== null;
	if (!path) return { manifestPath: null, port: DEFAULT_PORT, dataDir: null, workspaceRoot: null, homeDir, command, bundled, problem: "no manifest; run dinobot once to create ~/.config/dinobot/dinobot.yaml" };
	try {
		const raw = parse(await readFile(path, "utf8")) as { bot?: { dataDir?: unknown; workspaceRoot?: unknown }; api?: { port?: unknown } } | null;
		const override = Number(process.env.DINOBOT_API_PORT);
		const port = Number.isInteger(override) && override > 0 ? override : typeof raw?.api?.port === "number" ? raw.api.port : DEFAULT_PORT;
		const dataDir = typeof raw?.bot?.dataDir === "string" ? resolve(expandHome(raw.bot.dataDir)) : null;
		const problem = raw?.api === undefined ? `${path} has no api section; add \`api: { port: 8786 }\`` : undefined;
		const workspaceRoot = typeof raw?.bot?.workspaceRoot === "string" ? resolve(expandHome(raw.bot.workspaceRoot)) : null;
		return { manifestPath: path, port, dataDir, workspaceRoot, homeDir, command, bundled, ...(problem ? { problem } : {}) };
	} catch (error) {
		return { manifestPath: path, port: DEFAULT_PORT, dataDir: null, workspaceRoot: null, homeDir, command, bundled, problem: `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export const daemonLogPath = (dataDir: string) => join(dataDir, "dinobot.log");

export async function healthy(port: number): Promise<boolean> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500) });
		return res.ok;
	} catch {
		return false;
	}
}

export async function logTail(dataDir: string | null, lines = 15): Promise<string> {
	if (!dataDir) return "";
	try {
		return (await readFile(daemonLogPath(dataDir), "utf8")).split(/\r?\n/).slice(-lines).join("\n").trim();
	} catch {
		return "";
	}
}

type Launch = { readonly file: string; readonly prefix: readonly string[] };
const launches = new Map<string, Promise<Launch>>();

/**
 * What to execute for `command`. A Windows global install made by bun is an `.exe` launcher next to a `.bunx` file naming
 * the script and its interpreter; the launcher stays alive as the parent of the real process, so its pid is not the
 * daemon's. Running the interpreter with the script directly gives a child whose pid is the daemon pid that
 * GET /v1/daemon reports, which the setup apply transaction relies on.
 */
export function daemonLaunch(command: string): Promise<Launch> {
	let launch = launches.get(command);
	if (launch === undefined) {
		launch = resolveLaunch(command).catch(() => ({ file: command, prefix: [] }));
		launches.set(command, launch);
	}
	return launch;
}

async function resolveLaunch(command: string): Promise<Launch> {
	const plain = { file: command, prefix: [] };
	const bundled = bundledFor(command);
	if (bundled) return bundledLaunch(bundled);
	if (process.platform !== "win32" || !/\.exe$/i.test(command)) return plain;
	const text = (await readFile(command.replace(/\.exe$/i, ".bunx")).catch(() => undefined))?.toString("utf16le");
	const match = text === undefined ? null : /^([^"\0]+)"\0([A-Za-z0-9_.-]+)/.exec(text);
	if (!match) return plain;
	const script = join(dirname(dirname(command)), match[1]!);
	const program = match[2]!;
	if (program !== "bun" && program !== "node") return plain;
	if (!(await access(script).then(() => true, () => false))) return plain;
	const bunHome = join(process.env.BUN_INSTALL || join(homedir(), ".bun"), "bin", "bun.exe");
	const interpreter = (await findOnPath(program, [".exe"])) ?? (program === "bun" && (await access(bunHome).then(() => true, () => false)) ? bunHome : null);
	return interpreter === null ? plain : { file: interpreter, prefix: [script] };
}

/**
 * How to run the bundled daemon. macOS and Linux run it in place. On Windows a running bun.exe and its native addon are
 * locked, so running from the install folder would make the next app update fail to replace them while the (detached)
 * daemon lives on; it runs from a per-version copy in %LOCALAPPDATA%\dinobot-desktop\daemon instead.
 */
async function bundledLaunch(bundled: BundledDaemon): Promise<Launch> {
	const inPlace = { file: bundled.bun, prefix: [bundled.main] };
	if (process.platform !== "win32") return inPlace;
	const base = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "dinobot-desktop", "daemon");
	try {
		const copy = await installRuntimeCopy(bundled, base);
		return { file: join(copy, bunName()), prefix: [join(copy, "node_modules", "dinobot", "main.js")] };
	} catch {
		return inPlace;
	}
}

/**
 * Copy `bundled.dir` to `<base>/<runtime>` unless a complete copy is there (daemon.json is written by the copy and is
 * the completeness mark: it is the last file renamed into place as part of the directory). Older runtimes are removed
 * only when their directory can be renamed, which Windows refuses while any file in it is open (a running daemon).
 */
export async function installRuntimeCopy(bundled: BundledDaemon, base: string): Promise<string> {
	const target = join(base, bundled.runtime);
	if (bundledDaemonAt(target)?.runtime !== bundled.runtime) {
		await mkdir(base, { recursive: true });
		const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
		try {
			await cp(bundled.dir, temporary, { recursive: true, force: true });
			await rm(target, { recursive: true, force: true });
			await rename(temporary, target);
		} finally {
			await rm(temporary, { recursive: true, force: true }).catch(() => {});
		}
		if (bundledDaemonAt(target)?.runtime !== bundled.runtime) throw new Error(`incomplete daemon copy at ${target}`);
	}
	for (const name of await readdir(base).catch(() => [] as string[])) {
		if (name === bundled.runtime || name.endsWith(".tmp") || name.includes(".trash-")) continue;
		const old = join(base, name);
		const trash = `${old}.trash-${process.pid}`;
		if (await rename(old, trash).then(() => true, () => false)) await rm(trash, { recursive: true, force: true }).catch(() => {});
	}
	return target;
}

export type SpawnedDaemon = { readonly pid: number; exited(): boolean };

/**
 * Start `dinobot serve --config <manifest>` detached like the TUI does: output appended to <dataDir>/dinobot.log and
 * DINOBOT_DAEMON_OWNER=tui so a local client may later restart it. Does not wait for it to answer.
 */
export async function spawnDaemonProcess(command: string, manifestPath: string, dataDir: string): Promise<SpawnedDaemon> {
	const launch = await daemonLaunch(command);
	await mkdir(dataDir, { recursive: true });
	const log = await open(daemonLogPath(dataDir), "a");
	let child: ReturnType<typeof spawn>;
	try {
		child = spawn(launch.file, [...launch.prefix, "serve", "--config", resolve(manifestPath)], {
			detached: true,
			stdio: ["ignore", log.fd, log.fd],
			windowsHide: true,
			env: { ...process.env, DINOBOT_DAEMON_OWNER: "tui" },
		});
		child.unref();
	} finally {
		await log.close(); // the child holds its own copy
	}
	let exited = false;
	child.once("exit", () => {
		exited = true;
	});
	child.once("error", () => {
		exited = true;
	});
	if (child.pid === undefined) throw new Error(`could not start ${launch.file}`);
	return { pid: child.pid, exited: () => exited };
}

/** Spawns the daemon (see {@link spawnDaemonProcess}) unless one already answers, and waits up to 15 s for /healthz. */
export async function startDaemon(): Promise<DaemonStartResult> {
	const config = await readDaemonConfig();
	if (await healthy(config.port)) return { ok: true };
	if (!config.manifestPath) return { ok: false, error: config.problem ?? "no manifest" };
	if (!config.command) return { ok: false, error: "the dinobot daemon that ships with the app is missing; reinstall the app" };
	if (!config.dataDir) return { ok: false, error: config.problem ?? "manifest has no bot.dataDir" };
	let child: SpawnedDaemon;
	try {
		child = await spawnDaemonProcess(config.command, config.manifestPath, config.dataDir);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline && !child.exited()) {
		if (await healthy(config.port)) return { ok: true, pid: child.pid };
		await new Promise((r) => setTimeout(r, 150));
	}
	return { ok: false, error: `dinobot daemon did not come up on 127.0.0.1:${config.port}`, logTail: await logTail(config.dataDir) };
}
