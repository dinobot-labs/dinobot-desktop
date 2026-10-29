/**
 * Applying a setup change: the client-side transaction that writes the manifest and restarts a client-owned daemon,
 * the same contract the TUI implements.
 *
 * State: the manifest file M (base B or candidate C), the old daemon D (pid p, booted from B) and at most one new daemon.
 * Invariants:
 *   I1  at most one daemon process runs for the data directory: a new one is spawned only after the previous pid is gone
 *       (and the daemon's own `daemon.lock` refuses a second one regardless).
 *   I2  nothing is written unless C validates, the file still hashes to B, D is reachable, booted from this very file,
 *       is client-owned and idle; C never moves `bot.dataDir` or `api.port`.
 *   I3  every exit leaves M equal to what the running daemon booted from, or reports the exact exception:
 *       applied (M=C, daemon on C), rolled_back (M=B, daemon on B), stuck (M=B, D still stopping, nothing spawned),
 *       failed (M=B, no daemon running), saved_external (M=C, an external owner must restart its service).
 *   I4  a journal `<manifest>.setup-journal.json` exists exactly while M may disagree with the running daemon; the app
 *       reconciles a leftover one at start before connecting ({@link recoverInterruptedApply}).
 *
 * Every file and network access is asynchronous: this runs in the Electron main process.
 */
import { createHash, randomUUID } from "node:crypto";
import { type FileHandle, mkdir, open, readFile, realpath, rename, rm, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parse, parseDocument } from "yaml";
import type { ApplyOutcome, ApplyStatus, ManifestApplyRequest } from "../bridge-types.ts";
import { daemonLogPath, dinobotCommand, logTail, spawnDaemonProcess } from "../daemon.ts";

export type DaemonOwner = "tui" | "external";

/** GET /v1/daemon */
export type DaemonInfo = {
	readonly pid: number;
	readonly version: string;
	readonly manifestPath: string;
	readonly manifestSha256: string;
	readonly owner: DaemonOwner;
	readonly startedAt: string;
	readonly busy: readonly string[];
};

export type ShutdownResult =
	| { readonly status: "stopping" }
	| { readonly status: "refused"; readonly error: "external" | "pid" | "busy"; readonly busy?: readonly string[] };

export type ManifestSnapshot = { readonly text: string; readonly sha256: string };

export class ManifestConflictError extends Error {
	override readonly name = "ManifestConflictError";
}

export type ApplyJournal = { readonly baseSha256: string; readonly candidateSha256: string; readonly pid: number; readonly startedAt: string };

export type Validation = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

/** Everything the transaction touches: the app binds the real file system, daemon API and processes; tests bind fakes. */
export type ApplyPorts = {
	read(path: string): Promise<ManifestSnapshot>;
	/** Compare-and-swap replace; rejects with ManifestConflictError when the file no longer hashes to `expectedSha256`. */
	replace(path: string, text: string, expectedSha256: string, backup: boolean): Promise<ManifestSnapshot>;
	validate(text: string): Promise<Validation>;
	realpath(path: string): Promise<string>;
	/** Undefined when the daemon predates `/v1/daemon`; rejects when nothing answers. */
	info(): Promise<DaemonInfo | undefined>;
	shutdown(pid: number): Promise<ShutdownResult>;
	alive(pid: number): boolean;
	spawn(manifestPath: string): Promise<{ readonly pid: number; exited(): boolean }>;
	kill(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
	logTail(): Promise<string>;
	journal: {
		write(path: string, entry: ApplyJournal): Promise<void>;
		read(path: string): Promise<ApplyJournal | undefined>;
		clear(path: string): Promise<void>;
	};
	sleep(ms: number): Promise<void>;
	now(): number;
};

export type ApplyLimits = { readonly stopMs: number; readonly startMs: number; readonly pollMs: number };

export const DEFAULT_APPLY_LIMITS: ApplyLimits = { stopMs: 20_000, startMs: 90_000, pollMs: 100 };

export const backupPath = (manifestPath: string) => `${manifestPath}.bak`;
export const journalPath = (manifestPath: string) => `${manifestPath}.setup-journal.json`;

export function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

const sha256Bytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------------------------------------------------
// The transaction

export async function applyManifestChange(request: ManifestApplyRequest, ports: ApplyPorts, limits: ApplyLimits = DEFAULT_APPLY_LIMITS): Promise<ApplyStatus> {
	const path = request.manifestPath;
	const base = await ports.read(path);
	if (base.sha256 !== request.baseSha256) return { status: "conflict" };
	const candidateSha256 = sha256Hex(request.candidate);
	if (candidateSha256 === base.sha256) return { status: "applied" };
	const validation = await ports.validate(request.candidate);
	if (!validation.ok) return { status: "invalid", problems: [...validation.problems] };
	if (!sameLocation(base.text, request.candidate)) return { status: "unsafe_change" };

	let info: DaemonInfo | undefined;
	try {
		info = await ports.info();
	} catch {
		return { status: "unreachable" };
	}
	if (info === undefined) return { status: "older_daemon" };
	if (!samePath(await ports.realpath(path), info.manifestPath)) return { status: "other_manifest", path: info.manifestPath };
	if (info.owner !== "tui") {
		// Not ours to restart: save (with a backup) and let its owner restart it.
		try {
			await ports.replace(path, request.candidate, base.sha256, true);
		} catch (error) {
			if (error instanceof ManifestConflictError) return { status: "conflict" };
			throw error;
		}
		return { status: "saved_external" };
	}
	if (info.busy.length > 0) return { status: "busy", threads: [...info.busy] };

	const pid = info.pid;
	await ports.journal.write(path, { baseSha256: base.sha256, candidateSha256, pid, startedAt: new Date(ports.now()).toISOString() });
	try {
		await ports.replace(path, request.candidate, base.sha256, true);
	} catch (error) {
		await ports.journal.clear(path);
		if (error instanceof ManifestConflictError) return { status: "conflict" };
		throw error;
	}
	const restore = () => ports.replace(path, base.text, candidateSha256, false);

	let refused: ShutdownResult | undefined;
	try {
		const result = await ports.shutdown(pid);
		if (result.status === "refused") refused = result;
	} catch {
		// The answer may be lost while the server stops; whether it stops is decided by watching the pid below.
	}
	if (refused !== undefined && refused.status === "refused") {
		await restore();
		await ports.journal.clear(path);
		if (refused.error === "busy") return { status: "busy", threads: [...(refused.busy ?? [])] };
		return { status: "unreachable" };
	}
	if (!(await waitGone(ports, pid, limits))) {
		await restore();
		await ports.journal.clear(path);
		return { status: "stuck", pid };
	}

	const started = await startDaemon(ports, path, candidateSha256, limits);
	if (started.ok) {
		await ports.journal.clear(path);
		return { status: "applied" };
	}
	const log = await ports.logTail().catch(() => "");
	if (started.child !== undefined && !(await stopProcess(ports, started.child, limits))) {
		await restore();
		await ports.journal.clear(path);
		return { status: "failed", reason: `${started.reason}; the new daemon (pid ${started.child}) did not stop`, log };
	}
	try {
		await restore();
	} catch (error) {
		await ports.journal.clear(path);
		return { status: "failed", reason: `${started.reason}; ${error instanceof Error ? error.message : String(error)}`, log };
	}
	await ports.journal.clear(path);
	if (started.foreign) return { status: "failed", reason: started.reason, log };
	const again = await startDaemon(ports, path, base.sha256, limits);
	if (again.ok) return { status: "rolled_back", reason: started.reason, log };
	if (again.child !== undefined) await stopProcess(ports, again.child, limits);
	return { status: "failed", reason: `${started.reason}; the previous settings did not start either (${again.reason})`, log: await ports.logTail().catch(() => log) };
}

/**
 * Reconciles a journal left by a client that died mid-apply, before connecting. The running daemon decides: if it booted
 * from the candidate the apply finished; otherwise the base is restored on disk from `.bak` (when the file still holds the
 * candidate) so the next daemon boots from what was running before.
 */
export async function recoverInterruptedApply(manifestPath: string, ports: Pick<ApplyPorts, "read" | "replace" | "info" | "journal">): Promise<"none" | "completed" | "recovered"> {
	const journal = await ports.journal.read(manifestPath);
	if (journal === undefined) return "none";
	const info = await ports.info().catch(() => undefined);
	if (info !== undefined && info.manifestSha256 === journal.candidateSha256) {
		await ports.journal.clear(manifestPath);
		return "completed";
	}
	const current = await ports.read(manifestPath).catch(() => undefined);
	if (current?.sha256 === journal.candidateSha256) {
		const backup = await ports.read(backupPath(manifestPath));
		if (backup.sha256 !== journal.baseSha256) throw new Error(`${backupPath(manifestPath)} does not hold the settings from before the interrupted setup; fix ${manifestPath} by hand`);
		await ports.replace(manifestPath, backup.text, journal.candidateSha256, false);
		await ports.journal.clear(manifestPath);
		return "recovered";
	}
	await ports.journal.clear(manifestPath);
	return "none";
}

const samePath = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Setup never moves the data directory (and with it the daemon lock) or the API port the client talks to. */
export function sameLocation(base: string, candidate: string): boolean {
	const where = (text: string) => {
		const raw = parse(text) as { bot?: { dataDir?: unknown }; api?: { port?: unknown } } | null;
		return JSON.stringify([raw?.bot?.dataDir ?? null, raw?.api?.port ?? null]);
	};
	try {
		return where(base) === where(candidate);
	} catch {
		return false;
	}
}

async function waitGone(ports: ApplyPorts, pid: number, limits: ApplyLimits): Promise<boolean> {
	const deadline = ports.now() + limits.stopMs;
	while (ports.alive(pid)) {
		if (ports.now() >= deadline) return false;
		await ports.sleep(limits.pollMs);
	}
	return true;
}

/** SIGTERM (graceful), then SIGKILL; true once the pid is gone. */
async function stopProcess(ports: ApplyPorts, pid: number, limits: ApplyLimits): Promise<boolean> {
	if (!ports.alive(pid)) return true;
	try {
		ports.kill(pid, "SIGTERM");
	} catch {}
	if (await waitGone(ports, pid, limits)) return true;
	try {
		ports.kill(pid, "SIGKILL");
	} catch {}
	return waitGone(ports, pid, { ...limits, stopMs: Math.min(limits.stopMs, 5_000) });
}

type Started =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: string; readonly child?: number; readonly foreign?: boolean };

/**
 * Spawns a daemon and waits until one answers with its identity. Ours booted from `sha256`: success. Another process
 * already serving this file's expected content (a second client won the race and our child lost the daemon lock): success
 * too. Anything else is a failure carrying the child's pid when it may still be alive.
 */
async function startDaemon(ports: ApplyPorts, path: string, sha256: string, limits: ApplyLimits): Promise<Started> {
	let child: { readonly pid: number; exited(): boolean };
	try {
		child = await ports.spawn(path);
	} catch (error) {
		return { ok: false, reason: `could not start dinobot: ${error instanceof Error ? error.message : String(error)}` };
	}
	const deadline = ports.now() + limits.startMs;
	while (ports.now() < deadline) {
		const info = await ports.info().catch(() => undefined);
		if (info !== undefined) {
			if (info.manifestSha256 === sha256 && (info.pid === child.pid || !ports.alive(child.pid))) return { ok: true };
			if (info.pid === child.pid) return { ok: false, reason: "the new daemon booted from different settings", child: child.pid };
			if (!ports.alive(child.pid)) return { ok: false, reason: `another process (pid ${info.pid}) answers on the API port`, foreign: true };
		}
		if (child.exited()) return { ok: false, reason: "the daemon exited during startup" };
		await ports.sleep(limits.pollMs);
	}
	return { ok: false, reason: `the daemon did not answer within ${Math.round(limits.startMs / 1000)}s`, child: child.pid };
}

// ---------------------------------------------------------------------------------------------------------------------
// How each outcome reads (the TUI's copy, English and Korean)

type Copy = {
	readonly applying: string;
	readonly applied: string;
	readonly conflict: string;
	readonly invalid: (problems: string) => string;
	readonly unreachable: string;
	readonly olderDaemon: string;
	readonly otherManifest: (path: string) => string;
	readonly unsafeChange: string;
	readonly busy: (threads: string) => string;
	readonly external: (path: string) => string;
	readonly stuck: (pid: number) => string;
	readonly rolledBack: (reason: string, log: string) => string;
	readonly failed: (reason: string, log: string) => string;
	readonly recovered: string;
};

const en: Copy = {
	applying: "Applying setup: saving dinobot.yaml and restarting dinobot…",
	applied: "Setup applied; dinobot restarted with the new settings.",
	conflict: "dinobot.yaml changed while setup was running, so nothing was saved. Run /setup again.",
	invalid: (problems) => `The new settings did not validate, so nothing was saved:\n${problems}`,
	unreachable: "Could not reach the dinobot daemon, so nothing was changed.",
	olderDaemon: "The running dinobot daemon is older than this TUI and cannot be restarted safely. Nothing was changed; restart dinobot and run /setup again.",
	otherManifest: (path) => `The running daemon uses another manifest (${path}), so nothing was changed.`,
	unsafeChange: "The new settings would move the data directory or API port, which setup never does. Nothing was changed.",
	busy: (threads) => `Some conversations are still working (${threads}). Nothing was changed; run /setup again when they finish.`,
	external: (path) => `Saved ${path}. This dinobot daemon is managed outside the TUI (for example by systemd), so restart that service to apply the changes.`,
	stuck: (pid) => `The old dinobot daemon (pid ${pid}) did not stop in time. The previous settings were restored and nothing new was started; open dinobot again once it has exited.`,
	rolledBack: (reason, log) => `dinobot could not start with the new settings (${reason}). The previous settings were restored and dinobot is running again.${log ? `\n${log}` : ""}`,
	failed: (reason, log) => `dinobot could not start (${reason}). The previous settings are restored on disk; open dinobot again.${log ? `\n${log}` : ""}`,
	recovered: "An earlier setup was interrupted; dinobot.yaml was brought back in line with the running daemon.",
};

const ko: Copy = {
	applying: "설정을 적용하는 중: dinobot.yaml을 저장하고 dinobot을 재시작해요…",
	applied: "설정을 적용했어요. dinobot이 새 설정으로 재시작됐어요.",
	conflict: "설정하는 동안 dinobot.yaml이 바뀌어서 아무것도 저장하지 않았어요. /setup을 다시 실행하세요.",
	invalid: (problems) => `새 설정이 검증을 통과하지 못해 아무것도 저장하지 않았어요:\n${problems}`,
	unreachable: "dinobot 데몬에 연결할 수 없어 아무것도 바꾸지 않았어요.",
	olderDaemon: "실행 중인 dinobot 데몬이 이 TUI보다 오래된 버전이라 안전하게 재시작할 수 없어요. 아무것도 바꾸지 않았어요. dinobot을 재시작한 뒤 /setup을 다시 실행하세요.",
	otherManifest: (path) => `실행 중인 데몬은 다른 설정 파일(${path})을 쓰고 있어서 아무것도 바꾸지 않았어요.`,
	unsafeChange: "새 설정이 데이터 디렉터리나 API 포트를 바꾸려고 해요. setup은 이런 변경을 하지 않아요. 아무것도 바꾸지 않았어요.",
	busy: (threads) => `아직 작업 중인 대화가 있어요 (${threads}). 아무것도 바꾸지 않았어요. 끝난 뒤 /setup을 다시 실행하세요.`,
	external: (path) => `${path}에 저장했어요. 이 dinobot 데몬은 TUI 밖에서(예: systemd) 관리되고 있으니 그 서비스를 재시작하면 적용돼요.`,
	stuck: (pid) => `이전 dinobot 데몬(pid ${pid})이 제때 멈추지 않았어요. 이전 설정으로 되돌렸고 새로 띄우지 않았어요. 종료된 뒤 dinobot을 다시 여세요.`,
	rolledBack: (reason, log) => `새 설정으로 dinobot을 시작하지 못했어요 (${reason}). 이전 설정으로 되돌렸고 dinobot이 다시 실행 중이에요.${log ? `\n${log}` : ""}`,
	failed: (reason, log) => `dinobot을 시작하지 못했어요 (${reason}). 디스크에는 이전 설정을 복구했어요. dinobot을 다시 여세요.${log ? `\n${log}` : ""}`,
	recovered: "이전 설정 작업이 중간에 끊겨서, dinobot.yaml을 실행 중인 데몬과 같은 상태로 맞췄어요.",
};

/** `ko`, `ko_KR.UTF-8`, `ko-KR` are Korean; everything else falls back to English. */
export const applyCopy = (locale: string | undefined): Copy => (locale !== undefined && /^ko(?:$|[_.@-])/i.test(locale) ? ko : en);

/** The outcome with the text and level the TUI shows for it. */
export function describeApply(outcome: ApplyStatus, request: ManifestApplyRequest, logPath: string | null): ApplyOutcome {
	const copy = applyCopy(request.locale);
	const changes = [...request.changes];
	const summary = [...request.summary];
	const out = (text: string, level: ApplyOutcome["level"]): ApplyOutcome => ({ ...outcome, text, level, changes, summary, logPath });
	switch (outcome.status) {
		case "applied":
			return out([copy.applied, ...changes, ...summary].join("\n"), "success");
		case "saved_external":
			return out([copy.external(request.manifestPath), ...changes, ...summary].join("\n"), "info");
		case "conflict":
			return out(copy.conflict, "error");
		case "invalid":
			return out(copy.invalid(outcome.problems.map((problem) => `- ${problem}`).join("\n")), "error");
		case "unreachable":
			return out(copy.unreachable, "error");
		case "older_daemon":
			return out(copy.olderDaemon, "error");
		case "other_manifest":
			return out(copy.otherManifest(outcome.path), "error");
		case "unsafe_change":
			return out(copy.unsafeChange, "error");
		case "busy":
			return out(copy.busy(outcome.threads.join(", ")), "error");
		case "stuck":
			return out(copy.stuck(outcome.pid), "error");
		case "rolled_back":
			return out(copy.rolledBack(outcome.reason, outcome.log), "error");
		case "failed":
			return out(copy.failed(outcome.reason, outcome.log), "error");
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Real ports

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The manifest text (strict UTF-8, BOM kept) and the SHA-256 of its bytes on disk. */
export async function readManifestSnapshot(path: string): Promise<ManifestSnapshot> {
	const bytes = await readFile(path);
	return { text: UTF8.decode(bytes), sha256: sha256Bytes(bytes) };
}

/**
 * Atomically replace the file at `path` with `text` iff its current content hashes to `expectedSha256`; with `backup`
 * the current bytes go to `${path}.bak` first. The hash is checked again right before the rename. A symlink is resolved
 * and its target replaced.
 */
export async function replaceManifest(path: string, text: string, expectedSha256: string, backup: boolean): Promise<ManifestSnapshot> {
	const target = await realpath(path);
	const handle = await open(target, "r");
	let current: Uint8Array;
	let mode: number;
	try {
		const info = await handle.stat();
		if (!info.isFile()) throw new Error(`${path} is not a regular file`);
		mode = info.mode & 0o7777 || 0o600;
		current = await handle.readFile();
	} finally {
		await handle.close();
	}
	if (sha256Bytes(current) !== expectedSha256) throw new ManifestConflictError(`${path} changed since it was read`);
	if (backup) await writeAtomically(backupPath(path), current, mode);
	await writeAtomically(target, new TextEncoder().encode(text), mode, async () => {
		const now = await readFile(target);
		if (sha256Bytes(now) !== expectedSha256) throw new ManifestConflictError(`${path} changed while it was being replaced`);
	});
	return { text, sha256: sha256Hex(text) };
}

async function writeAtomically(destination: string, bytes: Uint8Array, mode: number, beforeRename?: () => Promise<void>): Promise<void> {
	const directory = dirname(destination);
	const temporary = join(directory, `.${basename(destination)}.${randomUUID()}.tmp`);
	let renamed = false;
	try {
		const file: FileHandle = await open(temporary, "wx", mode);
		try {
			await file.chmod(mode).catch(() => {});
			await file.writeFile(bytes);
			await file.sync();
		} finally {
			await file.close();
		}
		await beforeRename?.();
		await rename(temporary, destination);
		renamed = true;
	} finally {
		if (!renamed) await unlink(temporary).catch(() => {});
	}
	await syncDirectory(directory);
}

async function syncDirectory(directory: string): Promise<void> {
	let handle: FileHandle | undefined;
	try {
		handle = await open(directory, "r");
		await handle.sync();
	} catch (error) {
		// Some platforms (Windows) cannot open or fsync a directory; the rename itself already happened.
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EISDIR" && code !== "EPERM" && code !== "EACCES") throw error;
	} finally {
		await handle?.close();
	}
}

/**
 * The candidate must be a YAML mapping that parses without errors. The TUI additionally runs the daemon's own boot
 * validation in-process; that code is not available here, so a candidate the daemon rejects at boot is caught by the
 * restart check and rolled back instead.
 */
export async function validateManifest(text: string): Promise<Validation> {
	try {
		const document = parseDocument(text);
		if (document.errors.length > 0) return { ok: false, problems: document.errors.map((error) => error.message) };
		const value: unknown = document.toJS();
		if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, problems: ["the manifest must be a YAML mapping"] };
		return { ok: true };
	} catch (error) {
		return { ok: false, problems: [error instanceof Error ? error.message : String(error)] };
	}
}

/** True while the process exists (EPERM: exists but owned by someone else). */
export function processAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(value)}\n`);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

export class HttpError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

/** bot.dataDir of a manifest text, resolved like the rest of the app does (`~` expanded). */
export function manifestDataDir(text: string): string | null {
	try {
		const raw = parse(text) as { bot?: { dataDir?: unknown } } | null;
		const dir = raw?.bot?.dataDir;
		if (typeof dir !== "string" || dir === "") return null;
		const expanded = dir === "~" || dir.startsWith("~/") || dir.startsWith("~\\") ? join(homedir(), dir.slice(1)) : dir;
		return resolve(expanded);
	} catch {
		return null;
	}
}

export type PortsContext = { readonly port: number; readonly dataDir: string | null };

export function createApplyPorts(context: PortsContext, overrides: Partial<ApplyPorts> = {}): ApplyPorts {
	const base = `http://127.0.0.1:${context.port}`;
	const ports: ApplyPorts = {
		read: readManifestSnapshot,
		replace: replaceManifest,
		validate: validateManifest,
		realpath: (path) => realpath(path),
		info: async () => {
			const response = await fetch(`${base}/v1/daemon`, { signal: AbortSignal.timeout(3_000) });
			if (response.status === 404) {
				await response.body?.cancel();
				return undefined;
			}
			if (!response.ok) throw new HttpError(response.status, `GET /v1/daemon: HTTP ${response.status}`);
			return (await response.json()) as DaemonInfo;
		},
		shutdown: async (pid) => {
			const response = await fetch(`${base}/v1/daemon/shutdown`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ pid }),
				signal: AbortSignal.timeout(5_000),
			});
			if (response.status === 202) {
				await response.body?.cancel();
				return { status: "stopping" };
			}
			if (response.status === 409) return (await response.json()) as ShutdownResult;
			throw new HttpError(response.status, `POST /v1/daemon/shutdown: HTTP ${response.status} ${await response.text()}`);
		},
		alive: processAlive,
		spawn: async (manifestPath) => {
			const command = await dinobotCommand();
			if (command === null) throw new Error("the dinobot daemon that ships with the app is missing; reinstall the app");
			if (context.dataDir === null) throw new Error("the manifest has no bot.dataDir");
			return spawnDaemonProcess(command, manifestPath, context.dataDir);
		},
		kill: (pid, signal) => {
			process.kill(pid, signal);
		},
		logTail: () => logTail(context.dataDir),
		journal: {
			write: (path, entry) => writePrivateJson(journalPath(path), entry),
			read: async (path) => {
				try {
					const value = JSON.parse(await readFile(journalPath(path), "utf8")) as Partial<ApplyJournal>;
					if (typeof value.baseSha256 !== "string" || typeof value.candidateSha256 !== "string" || typeof value.pid !== "number" || typeof value.startedAt !== "string") return undefined;
					return value as ApplyJournal;
				} catch {
					return undefined;
				}
			},
			clear: (path) => rm(journalPath(path), { force: true }),
		},
		sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
		now: () => Date.now(),
	};
	return { ...ports, ...overrides };
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs the transaction for an `apply` command event and describes the outcome. `daemon` is the client's view of the
 * daemon (pid, owner); the live GET /v1/daemon answer is what the transaction decides on, as in the TUI. Concurrent
 * calls run one after another.
 */
export function setupApply(
	request: ManifestApplyRequest,
	_daemon: { pid: number; owner: "tui" | "external" },
	port: number,
	options: { overrides?: Partial<ApplyPorts>; limits?: ApplyLimits; dataDir?: string | null } = {},
): Promise<ApplyOutcome> {
	const run = async (): Promise<ApplyOutcome> => {
		let dataDir = options.dataDir ?? null;
		if (options.dataDir === undefined) dataDir = manifestDataDir((await readManifestSnapshot(request.manifestPath).catch(() => undefined))?.text ?? "");
		const logPath = dataDir === null ? null : daemonLogPath(dataDir);
		let outcome: ApplyStatus;
		try {
			outcome = await applyManifestChange(request, createApplyPorts({ port, dataDir }, options.overrides), options.limits);
		} catch (error) {
			outcome = { status: "failed", reason: error instanceof Error ? error.message : String(error), log: "" };
		}
		return describeApply(outcome, request, logPath);
	};
	const next = queue.then(run, run);
	queue = next.catch(() => {});
	return next;
}

/**
 * Startup reconciliation of a leftover `<manifest>.setup-journal.json` (invariant I4). `recovered` is true when the
 * previous settings were restored; `message` carries the notice to show, or the error when recovery itself failed.
 */
export async function setupRecover(
	manifestPath: string | null,
	port: number,
	locale: string | undefined,
	overrides: Partial<ApplyPorts> = {},
): Promise<{ recovered: boolean; message?: string }> {
	if (manifestPath === null) return { recovered: false };
	const path = await realpath(manifestPath).catch(() => undefined);
	if (path === undefined) return { recovered: false };
	try {
		const result = await recoverInterruptedApply(path, createApplyPorts({ port, dataDir: null }, overrides));
		return result === "recovered" ? { recovered: true, message: applyCopy(locale).recovered } : { recovered: false };
	} catch (error) {
		return { recovered: false, message: error instanceof Error ? error.message : String(error) };
	}
}
