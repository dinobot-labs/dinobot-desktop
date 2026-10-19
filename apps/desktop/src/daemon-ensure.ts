import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isScalar, parseDocument } from "yaml";
import type { DaemonConfig, DaemonStartResult } from "./bridge-types.ts";
import { logTail, readDaemonConfig, type SpawnedDaemon, spawnDaemonProcess, startDaemon } from "./daemon.ts";
import { ManifestConflictError, readManifestSnapshot, replaceManifest } from "./features/setup-apply.ts";

/**
 * Makes sure the dinobot daemon for this app's manifest is up and that the app talks to that daemon, not to whatever
 * else answers on the port.
 *
 * Who is on api.port (classify):
 *   ours     GET /v1/daemon names our manifest (same file after realpath), or an older daemon without /v1/daemon
 *            answers /healthz with exactly "ok": reuse it, never start a second one.
 *   foreign  anything else that holds the port: another program, or a dinobot daemon of a different manifest, or a
 *            port the OS will not let us bind (Windows reserved ranges). It is never touched.
 *   free     nothing listens and 127.0.0.1:port can be bound.
 *
 * ensure:
 *   ours    -> done.
 *   free    -> spawn the daemon, then wait until the port is ours (not merely "something answers /healthz").
 *   foreign -> pick a free loopback port, write it to api.port with a compare-and-swap edit of the manifest (only that
 *              value changes, comments stay; a concurrent edit makes the swap fail and the loop re-reads), then start
 *              there. The TUI and other clients read the same manifest, so they follow.
 * A spawned daemon that exits early is classified again: the port was taken in the meantime (foreign: move on), or
 * another client started our daemon first (the dataDir lock refused ours: wait for it to answer), or a real failure
 * (report it with the log tail). Attempts are bounded.
 */

export type DaemonInfoLite = { readonly manifestPath: string; readonly pid: number };
export type Classification = { readonly kind: "ours"; readonly pid?: number } | { readonly kind: "foreign"; readonly why: string } | { readonly kind: "free" };

export type EnsurePorts = {
	/** Fresh config (also refreshes the cache the protocol proxy reads). */
	config(): Promise<DaemonConfig>;
	/** Writes the first-run manifest if none exists. */
	createDefaultManifest(): Promise<void>;
	/** api.port as written in the manifest, or null when it has no api section. */
	manifestPort(path: string): Promise<number | null>;
	/** Sets api.port (adding the api section if needed) iff the manifest is unchanged since read; false on a conflict. */
	setPort(path: string, port: number): Promise<boolean>;
	/** GET /v1/daemon: the info, "legacy" for an old dinobot (no /v1/daemon, /healthz says "ok"), null when nothing usable answers. */
	info(port: number): Promise<DaemonInfoLite | "legacy" | null>;
	/** Something accepts TCP connections on 127.0.0.1:port. */
	listening(port: number): Promise<boolean>;
	/** 127.0.0.1:port can be bound right now. */
	bindable(port: number): Promise<boolean>;
	realpath(path: string): Promise<string>;
	spawn(config: DaemonConfig): Promise<SpawnedDaemon>;
	logTail(dataDir: string | null): Promise<string>;
	sleep(ms: number): Promise<void>;
	now(): number;
};

export type EnsureLimits = { readonly startMs: number; readonly pollMs: number; readonly graceMs: number; readonly attempts: number };
export const DEFAULT_ENSURE_LIMITS: EnsureLimits = { startMs: 20_000, pollMs: 150, graceMs: 2_000, attempts: 4 };

const DEFAULT_PORT = 8786;
const samePath = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const LOCKED = /another dinobot daemon is already running/i;
const IN_USE = /EADDRINUSE|address already in use|port \d+ in use|Failed to start server/i;

export async function classify(port: number, manifestPath: string, ports: EnsurePorts, limits: EnsureLimits): Promise<Classification> {
	const ours = await ports.realpath(manifestPath).catch(() => manifestPath);
	const judge = async (info: DaemonInfoLite | "legacy"): Promise<Classification> => {
		if (info === "legacy") return { kind: "ours" };
		const theirs = await ports.realpath(info.manifestPath).catch(() => info.manifestPath);
		return samePath(theirs, ours) ? { kind: "ours", pid: info.pid } : { kind: "foreign", why: `another dinobot daemon (${info.manifestPath})` };
	};
	const first = await ports.info(port);
	if (first !== null) return judge(first);
	const listening = await ports.listening(port);
	if (!listening) return (await ports.bindable(port)) ? { kind: "free" } : { kind: "foreign", why: "the port cannot be bound" };
	// Something accepts connections but does not answer as dinobot (yet): give a starting daemon a moment.
	const deadline = ports.now() + limits.graceMs;
	while (ports.now() < deadline) {
		await ports.sleep(limits.pollMs);
		const info = await ports.info(port);
		if (info !== null) return judge(info);
	}
	return { kind: "foreign", why: "another program is listening" };
}

/** A port near `from` (from+1 .. from+20) that is free now, else any OS-assigned free loopback port. */
export async function pickFreePort(from: number, ports: Pick<EnsurePorts, "listening" | "bindable" | "info">, avoid: ReadonlySet<number>): Promise<number> {
	for (let port = from + 1; port <= Math.min(from + 20, 65535); port++) {
		if (avoid.has(port)) continue;
		if ((await ports.bindable(port)) && !(await ports.listening(port))) return port;
	}
	for (let i = 0; i < 10; i++) {
		const port = await osFreePort();
		if (!avoid.has(port) && !(await ports.listening(port))) return port;
	}
	throw new Error("no free loopback port");
}

export async function ensureDaemonWith(ports: EnsurePorts, limits: EnsureLimits = DEFAULT_ENSURE_LIMITS): Promise<DaemonStartResult> {
	let config = await ports.config();
	if (!config.manifestPath) {
		await ports.createDefaultManifest();
		config = await ports.config();
	}
	const manifestPath = config.manifestPath;
	if (!manifestPath) return { ok: false, error: config.problem ?? "no manifest" };
	if (!config.dataDir) return { ok: false, error: config.problem ?? "the manifest has no bot.dataDir" };
	if (!config.command) return { ok: false, error: "the dinobot daemon that ships with the app is missing; reinstall the app" };
	if ((await ports.manifestPort(manifestPath)) === null) {
		// No api section: the app cannot reach a daemon without it. Add the default (or a free) port.
		const port = (await classify(DEFAULT_PORT, manifestPath, ports, limits)).kind === "foreign" ? await pickFreePort(DEFAULT_PORT, ports, new Set()) : DEFAULT_PORT;
		if (!(await ports.setPort(manifestPath, port))) return { ok: false, error: `${manifestPath} changed while adding the api section; try again` };
		config = await ports.config();
	}

	const moved: number[] = [];
	const tried = new Set<number>();
	let lastLog = "";
	for (let attempt = 0; attempt < limits.attempts; attempt++) {
		const port = config.port;
		tried.add(port);
		const state = await classify(port, manifestPath, ports, limits);
		if (state.kind === "ours") return done({ ok: true, ...(state.pid ? { pid: state.pid } : {}) }, moved, port);
		if (state.kind === "foreign") {
			const next = await pickFreePort(port, ports, tried);
			if (!(await ports.setPort(manifestPath, next))) {
				config = await ports.config(); // someone else edited the manifest: start over from what it says now
				continue;
			}
			moved.push(port);
			config = await ports.config();
			continue;
		}
		// free: start it, then wait until the port is ours.
		let child: SpawnedDaemon;
		try {
			child = await ports.spawn(config);
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
		const deadline = ports.now() + limits.startMs;
		let lockedOut = false;
		let outcome: "ours" | "foreign" | "exited" | "timeout" = "timeout";
		while (ports.now() < deadline) {
			const info = await ports.info(port);
			if (info !== null) {
				const judged = await classify(port, manifestPath, ports, { ...limits, graceMs: 0 });
				outcome = judged.kind === "ours" ? "ours" : "foreign";
				break;
			}
			if (child.exited() && !lockedOut) {
				lastLog = await ports.logTail(config.dataDir);
				const tail = lastLog.split(/\r?\n/).slice(-8).join("\n");
				// Another client (the TUI) is starting our daemon: our copy lost the dataDir lock. Wait for theirs.
				if (LOCKED.test(tail)) lockedOut = true;
				else {
					outcome = "exited";
					break;
				}
			}
			await ports.sleep(limits.pollMs);
		}
		if (outcome === "ours") return done({ ok: true, ...(lockedOut ? {} : { pid: child.pid }) }, moved, port);
		if (outcome === "exited" || outcome === "foreign") {
			// Taken between our check and the daemon's bind? Then move on to another port; anything else is a real failure.
			const now = await classify(port, manifestPath, ports, limits);
			if (now.kind === "ours") return done({ ok: true }, moved, port);
			if (now.kind === "foreign" || IN_USE.test(lastLog.split(/\r?\n/).slice(-8).join("\n"))) continue;
			return { ok: false, error: `the dinobot daemon exited while starting (127.0.0.1:${port})`, logTail: lastLog || (await ports.logTail(config.dataDir)) };
		}
		return { ok: false, error: `dinobot daemon did not come up on 127.0.0.1:${port}`, logTail: await ports.logTail(config.dataDir) };
	}
	return { ok: false, error: `could not find a port for the dinobot daemon (tried ${[...tried].join(", ")})`, ...(lastLog ? { logTail: lastLog } : {}) };
}

function done(result: DaemonStartResult, moved: readonly number[], port: number): DaemonStartResult {
	return moved.length > 0 ? { ...result, port, movedFrom: moved[0] } : { ...result, port };
}

// ---------------------------------------------------------------------------------------------------------------------
// Real ports

/** The manifest a first dinobot run writes (dinobot src/cli/default-manifest.ts), so the app works before the TUI ever ran. */
export function defaultManifest(home: string): string {
	return [
		"# Created by the first dinobot run. Edit freely; see `dinobot --help` for the lookup order.",
		"bot:",
		"  enabled: true",
		`  dataDir: ${JSON.stringify(join(home, ".local", "share", "dinobot"))}`,
		"  model:",
		"    provider: anthropic",
		"    modelId: claude-sonnet-4-6",
		"  toolMode: codemode-only",
		"api:                # loopback client API for `dinobot tui`",
		`  port: ${DEFAULT_PORT}`,
		"channels: {}",
		"plugins: {}         # web search is on by default; `web: false` turns it off",
		"",
	].join("\n");
}

export async function createDefaultManifest(home: string = homedir()): Promise<void> {
	const path = join(home, ".config", "dinobot", "dinobot.yaml");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, defaultManifest(home), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "EEXIST") throw error; // a concurrent first run won
	});
}

export async function manifestPort(path: string): Promise<number | null> {
	const value = parseDocument(await readFile(path, "utf8")).getIn(["api", "port"]);
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** The manifest with api.port = port and nothing else changed; throws when the text is not a YAML mapping. */
export function withPort(text: string, port: number): string {
	const document = parseDocument(text);
	if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? "invalid YAML");
	const node = document.getIn(["api", "port"], true);
	let out: string;
	if (isScalar(node) && node.range && typeof node.value === "number") {
		// Replace just the number in the source, so formatting and comments stay byte for byte.
		out = text.slice(0, node.range[0]) + String(port) + text.slice(node.range[1]);
	} else {
		const api = document.get("api", true);
		if (api === undefined || api === null || (isScalar(api) && api.value === null)) document.set("api", document.createNode({ port }));
		else document.setIn(["api", "port"], port);
		out = document.toString();
	}
	if (parseDocument(out).getIn(["api", "port"]) !== port) throw new Error("could not set api.port");
	return out;
}

export async function setManifestPort(path: string, port: number): Promise<boolean> {
	const snapshot = await readManifestSnapshot(path);
	try {
		await replaceManifest(path, withPort(snapshot.text, port), snapshot.sha256, false);
		return true;
	} catch (error) {
		if (error instanceof ManifestConflictError) return false;
		throw error;
	}
}

export async function daemonInfo(port: number): Promise<DaemonInfoLite | "legacy" | null> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/v1/daemon`, { signal: AbortSignal.timeout(1500) });
		if (response.ok) {
			const body = (await response.json().catch(() => null)) as { manifestPath?: unknown; pid?: unknown } | null;
			if (body && typeof body.manifestPath === "string" && typeof body.pid === "number") return { manifestPath: body.manifestPath, pid: body.pid };
			return null;
		}
		await response.body?.cancel();
		if (response.status !== 404) return null;
		const health = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500) });
		return health.ok && (await health.text()) === "ok" ? "legacy" : null;
	} catch {
		return null;
	}
}

export function listening(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		const finish = (value: boolean) => {
			socket.destroy();
			resolve(value);
		};
		socket.setTimeout(1000, () => finish(false));
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

export function bindable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => resolve(true)));
	});
}

function osFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => (port > 0 ? resolve(port) : reject(new Error("no port assigned"))));
		});
	});
}

export function realEnsurePorts(): EnsurePorts {
	return {
		config: () => readDaemonConfig(),
		createDefaultManifest: () => createDefaultManifest(),
		manifestPort,
		setPort: setManifestPort,
		info: daemonInfo,
		listening,
		bindable,
		realpath: (path) => realpath(path),
		spawn: (config) => {
			if (!config.command || !config.manifestPath || !config.dataDir) throw new Error("incomplete daemon config");
			return spawnDaemonProcess(config.command, config.manifestPath, config.dataDir);
		},
		logTail: (dataDir) => logTail(dataDir, 30),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		now: () => Date.now(),
	};
}

let inFlight: Promise<DaemonStartResult> | undefined;
/** {@link ensureDaemonWith} on the real system; concurrent callers (app start, the renderer, a retry) share one run. */
export function ensureDaemon(): Promise<DaemonStartResult> {
	inFlight ??= (async () => {
		try {
			// A port pinned in the environment (development) is not ours to move.
			if (Number(process.env.DINOBOT_API_PORT) > 0) return await startDaemon();
			return await ensureDaemonWith(realEnsurePorts());
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		} finally {
			inFlight = undefined;
		}
	})();
	return inFlight;
}

