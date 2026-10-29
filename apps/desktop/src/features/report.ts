/**
 * "Report a problem": the main process runs the dinobot CLI (`dinobot report consent|agree|send --json`), which works
 * whether or not the daemon is running (it posts to the daemon when one answers, otherwise collects and uploads by
 * itself). The desktop adds its own context in a private temporary JSON file passed with `--context-file`.
 *
 * Invariants:
 *   R1  the CLI is the same executable the daemon is started with (DINOBOT_BIN, the bundled bun + main.js, PATH) and
 *       gets the app's manifest with `--config`, so it reads the same data directory and api.port as the daemon.
 *   R2  the context file is created exclusively with mode 0600 and removed on every exit path (success, failure, timeout).
 *   R3  every call ends within its timeout (send: 120 s): the child is killed and the call answers `failed`.
 *   R4  at most one send runs at a time; a second request while one runs joins it.
 *   R5  nothing secret is put in the context by the app; the CLI redacts the context again before upload.
 *   R6  a thread from the renderer reaches the CLI only as one validated `--thread <channel>:<key>` value: the channel
 *       matches CHANNEL_PATTERN and the key is 1..THREAD_KEY_MAX characters without control characters; anything else
 *       is dropped and the report is sent without a conversation.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplyOutcome, DaemonConfig, DaemonStartResult, ReportAgreeResult, ReportConsentResult, ReportSendRequest, ReportSendResult, ReportThread, ReportTrigger } from "../bridge-types.ts";
import { daemonLaunch, dinobotCommand, logTail, readDaemonConfig } from "../daemon.ts";

export const SEND_TIMEOUT_MS = 120_000;
export const QUERY_TIMEOUT_MS = 30_000;
const ERROR_RING = 50;
const MESSAGE_CAP = 2_000;
const OUTPUT_CAP = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------------
// What the app remembers for a report (in memory only)

export type RecordedError = { readonly at: string; readonly source: "main" | "renderer"; readonly message: string };

type Recorded = {
	setupApply?: { at: string; status: string; level: string; text: string; logPath: string | null };
	daemonStart?: { at: string; ok: boolean; error?: string; timedOut?: boolean; port?: number; movedFrom?: number; logTail?: string };
	daemonStartFailure?: { at: string; error?: string; timedOut?: boolean; logTail?: string };
	errors: RecordedError[];
};

const recorded: Recorded = { errors: [] };

const cap = (text: string, limit = MESSAGE_CAP) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

export function recordError(source: RecordedError["source"], error: unknown): void {
	const message = error instanceof Error ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}` : String(error);
	recorded.errors.push({ at: new Date().toISOString(), source, message: cap(message) });
	if (recorded.errors.length > ERROR_RING) recorded.errors.splice(0, recorded.errors.length - ERROR_RING);
}

export function recordSetupApply(outcome: ApplyOutcome): void {
	recorded.setupApply = { at: new Date().toISOString(), status: outcome.status, level: outcome.level, text: cap(outcome.text, 8_000), logPath: outcome.logPath };
}

export function recordDaemonStart(result: DaemonStartResult): DaemonStartResult {
	const at = new Date().toISOString();
	recorded.daemonStart = {
		at,
		ok: result.ok,
		...(result.error !== undefined ? { error: result.error } : {}),
		...(result.timedOut ? { timedOut: true } : {}),
		...(result.port !== undefined ? { port: result.port } : {}),
		...(result.movedFrom !== undefined ? { movedFrom: result.movedFrom } : {}),
	};
	if (!result.ok) recorded.daemonStartFailure = { at, ...(result.error !== undefined ? { error: result.error } : {}), ...(result.timedOut ? { timedOut: true } : {}), ...(result.logTail ? { logTail: cap(result.logTail, 16_000) } : {}) };
	return result;
}

/** For tests. */
export function resetRecorded(): void {
	recorded.errors = [];
	delete recorded.setupApply;
	delete recorded.daemonStart;
	delete recorded.daemonStartFailure;
}

export type AppFacts = {
	readonly name: string;
	readonly version: string;
	readonly packaged: boolean;
	readonly locale: string;
	readonly versions: Readonly<Record<string, string | undefined>>;
};

/** The JSON passed with `--context-file`. */
export function buildContext(app: AppFacts, trigger: ReportTrigger, config: DaemonConfig | undefined, daemonLog: string): Record<string, unknown> {
	return {
		client: "desktop",
		trigger,
		collectedAt: new Date().toISOString(),
		app: { name: app.name, version: app.version, packaged: app.packaged, locale: app.locale },
		versions: { electron: app.versions.electron, chrome: app.versions.chrome, node: app.versions.node, v8: app.versions.v8 },
		platform: process.platform,
		arch: process.arch,
		osRelease: release(),
		daemonConfig: config === undefined ? null : { manifestPath: config.manifestPath, port: config.port, dataDir: config.dataDir, command: config.command, bundled: config.bundled ?? false, ...(config.problem ? { problem: config.problem } : {}) },
		lastSetupApply: recorded.setupApply ?? null,
		lastDaemonStart: recorded.daemonStart ?? null,
		lastDaemonStartFailure: recorded.daemonStartFailure ?? null,
		recentErrors: [...recorded.errors],
		// The desktop app keeps no log file of its own; the daemon log tail it would show is included instead.
		desktopLog: null,
		daemonLogTail: daemonLog,
	};
}

// ---------------------------------------------------------------------------------------------------------------------
// Running the CLI

/** The subset of a spawned child the runner needs (tests pass a fake). */
export type ChildLike = {
	readonly stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
	readonly stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
	on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	kill(signal?: NodeJS.Signals): boolean;
};

export type SpawnLike = (file: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; windowsHide: boolean; stdio: ["ignore", "pipe", "pipe"] }) => ChildLike;

export type CliRun = { readonly code: number | null; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean; readonly spawnError?: string };

export type ReportPorts = {
	spawn: SpawnLike;
	/** The dinobot executable (R1); null when there is none. */
	command(): Promise<string | null>;
	launch(command: string): Promise<{ readonly file: string; readonly prefix: readonly string[] }>;
	config(): Promise<DaemonConfig | undefined>;
	app(): AppFacts;
	daemonLogTail(dataDir: string | null): Promise<string>;
	tmpdir(): string;
	env(): NodeJS.ProcessEnv;
};

export function runCli(ports: Pick<ReportPorts, "spawn">, file: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number, killGraceMs = 3_000): Promise<CliRun> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let done = false;
		let child: ChildLike;
		const finish = (run: CliRun) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			clearTimeout(killTimer);
			resolve(run);
		};
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill("SIGTERM");
			} catch {}
			killTimer = setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {}
				finish({ code: null, stdout, stderr, timedOut: true });
			}, killGraceMs);
		}, timeoutMs);
		try {
			child = ports.spawn(file, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		} catch (error) {
			finish({ code: null, stdout, stderr, timedOut: false, spawnError: error instanceof Error ? error.message : String(error) });
			return;
		}
		child.stdout?.on("data", (chunk) => {
			if (stdout.length < OUTPUT_CAP) stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			if (stderr.length < OUTPUT_CAP) stderr += String(chunk);
		});
		child.on("error", (error) => finish({ code: null, stdout, stderr, timedOut, spawnError: error.message }));
		child.on("close", (code) => finish({ code, stdout, stderr, timedOut }));
	});
}

/** The whole stdout as JSON, else the last line that is a JSON object. */
export function parseJsonOutput(stdout: string): Record<string, unknown> | undefined {
	const asObject = (text: string) => {
		try {
			const value: unknown = JSON.parse(text);
			return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
		} catch {
			return undefined;
		}
	};
	const whole = asObject(stdout.trim());
	if (whole) return whole;
	const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("{"));
	for (let i = lines.length - 1; i >= 0; i--) {
		const value = asObject(lines[i]!);
		if (value) return value;
	}
	return undefined;
}

/** argv for `dinobot <args>`: the daemon's launch resolution (bundled bun + main.js, a bun launcher, a source checkout's src/main.ts). */
export async function cliArgv(ports: Pick<ReportPorts, "command" | "launch">, args: readonly string[]): Promise<{ file: string; argv: string[] } | { error: string }> {
	const command = await ports.command();
	if (command === null) return { error: "the dinobot command was not found (the daemon that ships with the app is missing; reinstall the app or set DINOBOT_BIN)" };
	const launch = await ports.launch(command);
	return { file: launch.file, argv: [...launch.prefix, ...args] };
}

function lastLines(text: string, lines = 5): string {
	return text.trim().split(/\r?\n/).slice(-lines).join("\n");
}

function failure(run: CliRun, what: string, timeoutMs: number): string {
	if (run.spawnError) return `could not run dinobot: ${run.spawnError}`;
	if (run.timedOut) return `dinobot ${what} did not finish within ${Math.round(timeoutMs / 1000)} s`;
	const tail = lastLines(run.stderr) || lastLines(run.stdout);
	return `dinobot ${what} exited with code ${run.code ?? "?"}${tail ? `: ${tail}` : ""}`;
}

async function invoke(ports: ReportPorts, sub: readonly string[], timeoutMs: number, config?: DaemonConfig): Promise<{ run: CliRun; json?: Record<string, unknown> } | { error: string }> {
	const cfg = config ?? (await ports.config().catch(() => undefined));
	const args = ["report", ...sub, "--json", ...(cfg?.manifestPath ? ["--config", cfg.manifestPath] : [])];
	const target = await cliArgv(ports, args);
	if ("error" in target) return target;
	const run = await runCli(ports, target.file, target.argv, ports.env(), timeoutMs);
	const json = parseJsonOutput(run.stdout);
	return json === undefined ? { run } : { run, json };
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export async function reportConsent(ports: ReportPorts): Promise<ReportConsentResult> {
	const result = await invoke(ports, ["consent"], QUERY_TIMEOUT_MS);
	if ("error" in result) return { ok: false, error: result.error };
	const json = result.json;
	if (result.run.code !== 0 || json === undefined || typeof json.version !== "string" || typeof json.text !== "string") return { ok: false, error: failure(result.run, "report consent", QUERY_TIMEOUT_MS) };
	return {
		ok: true,
		version: json.version,
		text: json.text,
		...(typeof json.textSha256 === "string" ? { textSha256: json.textSha256 } : {}),
		consented: json.consented === true,
		auto: json.auto === true,
	};
}

export async function reportAgree(ports: ReportPorts, version: string, auto: boolean): Promise<ReportAgreeResult> {
	if (version === "" || version.startsWith("-")) return { ok: false, error: "invalid consent version" };
	const result = await invoke(ports, ["agree", version, ...(auto ? ["--auto"] : [])], QUERY_TIMEOUT_MS);
	if ("error" in result) return { ok: false, error: result.error };
	if (result.run.code === 0) return { ok: true };
	if (result.run.code === 2 || result.json?.error === "version") return { ok: false, error: "version", versionMismatch: true };
	return { ok: false, error: str(result.json?.error) ?? failure(result.run, "report agree", QUERY_TIMEOUT_MS) };
}

const STATUSES = new Set(["sent", "pending", "failed"]);

/** Writes the context file exclusively with mode 0600 (R2). */
async function writeContextFile(directory: string, context: unknown): Promise<string> {
	const path = join(directory, `dinobot-report-context-${randomUUID()}.json`);
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.chmod(0o600).catch(() => {});
		await handle.writeFile(JSON.stringify(context));
	} finally {
		await handle.close();
	}
	return path;
}

export async function reportSendWith(ports: ReportPorts, request: ReportSendRequest): Promise<ReportSendResult> {
	const config = await ports.config().catch(() => undefined);
	const context = buildContext(ports.app(), request.trigger, config, await ports.daemonLogTail(config?.dataDir ?? null).catch(() => ""));
	let contextPath: string;
	try {
		contextPath = await writeContextFile(ports.tmpdir(), context);
	} catch (error) {
		return { status: "failed", error: `could not write the report context: ${error instanceof Error ? error.message : String(error)}` };
	}
	try {
		const note = request.note?.trim();
		const thread = request.thread === undefined ? undefined : parseReportThread(request.thread);
		const sub = ["send", "--client", "desktop", "--trigger", request.trigger, "--context-file", contextPath, ...(note ? ["--note", note] : []), ...(thread ? ["--thread", `${thread.channel}:${thread.key}`] : [])];
		const result = await invoke(ports, sub, SEND_TIMEOUT_MS, config);
		if ("error" in result) return { status: "failed", error: result.error };
		const json = result.json;
		if (result.run.code === 3 || json?.error === "consent_required" || json?.status === "consent_required") return { status: "consent_required" };
		const status = str(json?.status);
		if (json !== undefined && status !== undefined && STATUSES.has(status)) {
			const id = str(json.id);
			const shortId = str(json.shortId) ?? (id ? id.slice(0, 8) : undefined);
			const error = str(json.error) ?? (status === "failed" && result.run.code !== 0 ? failure(result.run, "report send", SEND_TIMEOUT_MS) : undefined);
			return {
				status: status as "sent" | "pending" | "failed",
				...(id ? { id } : {}),
				...(shortId ? { shortId } : {}),
				...(error ? { error } : {}),
				...(typeof json.mode === "string" ? { mode: json.mode } : {}),
			};
		}
		return { status: "failed", error: str(json?.error) ?? failure(result.run, "report send", SEND_TIMEOUT_MS) };
	} finally {
		await rm(contextPath, { force: true }).catch(() => {});
	}
}

let sending: Promise<ReportSendResult> | undefined;

/** One send at a time (R4). */
export function reportSend(ports: ReportPorts, request: ReportSendRequest): Promise<ReportSendResult> {
	sending ??= reportSendWith(ports, request)
		.catch((error: unknown) => ({ status: "failed" as const, error: error instanceof Error ? error.message : String(error) }))
		.finally(() => {
			sending = undefined;
		});
	return sending;
}

export const TRIGGERS: readonly ReportTrigger[] = ["button", "setup-failed", "daemon-down"];
export const isTrigger = (value: unknown): value is ReportTrigger => typeof value === "string" && (TRIGGERS as readonly string[]).includes(value);

export const CHANNEL_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export const THREAD_KEY_MAX = 512;
export const NOTE_MAX = 4_000;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A thread from the renderer, or undefined when it is not a valid `channel` + `key` pair (R6). */
export function parseReportThread(value: unknown): ReportThread | undefined {
	const v = value as { channel?: unknown; key?: unknown } | null;
	if (v === null || typeof v !== "object") return undefined;
	const { channel, key } = v;
	if (typeof channel !== "string" || !CHANNEL_PATTERN.test(channel)) return undefined;
	if (typeof key !== "string" || key.length === 0 || key.length > THREAD_KEY_MAX || CONTROL.test(key)) return undefined;
	return { channel, key };
}

/** The `report:send` IPC payload: an unknown trigger is "button", the note is capped, an invalid thread is dropped. */
export function parseSendRequest(value: unknown): ReportSendRequest {
	const r = value as { trigger?: unknown; note?: unknown; thread?: unknown } | null;
	const trigger = isTrigger(r?.trigger) ? r.trigger : "button";
	const note = typeof r?.note === "string" ? r.note.slice(0, NOTE_MAX) : undefined;
	const thread = parseReportThread(r?.thread);
	return { trigger, ...(note ? { note } : {}), ...(thread ? { thread } : {}) };
}

export function realReportPorts(app: () => AppFacts): ReportPorts {
	return {
		spawn: (file, args, options) => nodeSpawn(file, [...args], options),
		command: dinobotCommand,
		launch: daemonLaunch,
		config: () => readDaemonConfig(),
		app,
		daemonLogTail: (dataDir) => logTail(dataDir, 200),
		tmpdir: () => tmpdir(),
		env: () => ({ ...process.env }),
	};
}
