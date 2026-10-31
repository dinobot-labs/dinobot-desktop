/**
 * App state: daemon connection, the thread list (keys + live session status), the selected thread and the open
 * thread streams. Chat content itself lives in ChatSession objects (chat/session.ts), not in this store.
 */
import { type DaemonInfo, newThreadName, type SessionStatus, type SessionsEvent, type ThreadModelState } from "@dinobot/contracts";
import { type ManifestApplyRequest } from "@dinobot/contracts";
import { toast } from "@dinobot/ui";
import { createElement } from "react";
import { create } from "zustand";
import { ReportButton } from "../dialogs/ReportDialog.tsx";
import { bindReport, reportAvailable, reportThreadFor } from "./report.ts";
import { type RunSurface, startCommand } from "./command-runner.ts";
import { startUsagePolling } from "./usage.ts";
import { loadCommands, useCommands } from "./commands.ts";
import { ChatSession } from "../chat/session.ts";
import { api, openStream, sessionsEventsPath } from "../lib/api.ts";
import { HttpError } from "../lib/sse.ts";
import { type DaemonConfig, desktop } from "../lib/bridge.ts";
import { rememberCwd, rememberTitle, threadCwds, threadTitles, useSettings } from "../lib/settings.ts";

import { hasActiveWork } from "./thread-activity.ts";

export type Connection = "checking" | "online" | "offline" | "starting";

export interface ThreadEntry {
	key: string;
	channel: string;
	/** Creation time encoded in TUI-style names, else undefined. */
	createdAt?: number;
	status?: SessionStatus;
	/** Created in this app and not yet known to the daemon's thread list. */
	draft?: boolean;
	/** Working folder chosen for a draft (a project's "+"); unset uses the default folder. */
	cwd?: string;
}

interface AppState {
	connection: Connection;
	connectionError?: string;
	logTail?: string;
	config?: DaemonConfig;
	daemon?: DaemonInfo;
	threads: ThreadEntry[];
	titles: Record<string, string>;
	/** Folders this app bound for its threads (fallback for daemons that do not report `SessionStatus.cwd`). */
	cwds: Record<string, string>;
	activeKey: string | null;
	models: Record<string, ThreadModelState | undefined>;
	/** Threads whose turn finished while not on screen. */
	unseen: string[];
	paletteOpen: boolean;
	paletteQuery: string;
	settingsOpen: boolean;
	/** A setup change is being written and the daemon restarted (composer locked, T27). */
	applying: boolean;
	applyOutcome: unknown;
	preferencesTab: string;
	update: { latest: string; newer: boolean } | null;
	/** A newer build of the desktop app itself; `updating` once the installer was started. */
	desktopUpdate: { current: string; latest: string; newer: boolean; updating?: boolean } | null;
	olderDaemon: boolean;
	dismissed: string[];
	subagentView: { conversationId: number; title: string } | null;
	/** Nested subagent navigation (TUI takeover inside takeover): the views under the current one. */
	subagentBack: { conversationId: number; title: string }[];
}

export const useApp = create<AppState>(() => ({
	connection: "checking",
	threads: [],
	titles: threadTitles(),
	cwds: threadCwds(),
	activeKey: null,
	models: {},
	unseen: [],
	paletteOpen: false,
	paletteQuery: "",
	settingsOpen: false,
	applying: false,
	applyOutcome: null,
	preferencesTab: "general",
	update: null,
	desktopUpdate: null,
	olderDaemon: false,
	dismissed: [],
	subagentView: null,
	subagentBack: [],
}));

const set = useApp.setState;
const get = useApp.getState;

// A problem report includes the open thread's conversation (daemon mode).
bindReport({ thread: () => reportThreadFor(get().activeKey, get().threads) });

// ---------------------------------------------------------------- thread list

/** `tui:20261015141712-c6fa` -> 2026-10-15T14:17:12Z. */
export function createdAtOf(key: string): number | undefined {
	const m = /^[^:]+:(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)-[0-9a-f]{4}$/.exec(key);
	if (!m) return undefined;
	const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
	return Date.UTC(y as number, (mo as number) - 1, d, h, mi, s);
}

const channelOf = (key: string) => key.slice(0, Math.max(0, key.indexOf(":")));

/** Active parent or child work first, then most recent activity (or creation). */
export function sortThreads(threads: ThreadEntry[]): ThreadEntry[] {
	const at = (t: ThreadEntry) => t.status?.lastActivityAt ?? t.createdAt ?? 0;
	return [...threads].sort((a, b) => Number(hasActiveWork(b.status)) - Number(hasActiveWork(a.status)) || at(b) - at(a) || b.key.localeCompare(a.key));
}

let sessionsByKey = new Map<string, SessionStatus>();

async function refreshThreads(): Promise<void> {
	const { threads } = await api.threads();
	const known = new Set<string>();
	const list: ThreadEntry[] = [];
	for (const { key } of threads) {
		if (key.includes("#") || !key.includes(":")) continue; // archived history
		known.add(key);
		const status = sessionsByKey.get(key);
		const createdAt = createdAtOf(key);
		list.push({ key, channel: channelOf(key), ...(createdAt ? { createdAt } : {}), ...(status ? { status } : {}) });
	}
	for (const t of get().threads) if (t.draft && !known.has(t.key)) list.push(t);
	set({ threads: sortThreads(list) });
}

export function applySessions(snapshot: SessionsEvent): void {
	const previous = sessionsByKey;
	sessionsByKey = new Map(snapshot.sessions.map((s) => [s.thread, s]));
	let missing = false;
	const threads = get().threads.map((t) => {
		const status = sessionsByKey.get(t.key);
		return status ? { ...t, status } : t.status ? { key: t.key, channel: t.channel, ...(t.createdAt ? { createdAt: t.createdAt } : {}), ...(t.draft ? { draft: true } : {}), ...(t.cwd ? { cwd: t.cwd } : {}) } : t;
	});
	for (const s of snapshot.sessions) if (!threads.some((t) => t.key === s.thread)) missing = true;
	// A thread went idle while not on screen: mark it for the person.
	const unseen = new Set(get().unseen);
	for (const [key, before] of previous) {
		const after = sessionsByKey.get(key);
		if (before.busy && after && !after.busy && key !== get().activeKey) unseen.add(key);
	}
	set({ threads: sortThreads(threads), unseen: [...unseen] });
	desktop?.setBadge(unseen.size);
	if (missing) void refreshThreads().catch(() => {});
}

// ---------------------------------------------------------------- sessions (open streams)

const open = new Map<string, ChatSession>();
const KEEP_OPEN = 3;

export function sessionFor(key: string): ChatSession {
	let session = open.get(key);
	if (!session) {
		session = ChatSession.forThread(key);
		open.set(key, session);
		const s = session;
		s.onEvent((event) => {
			if (event === "run_end") notifyTurnEnd(key);
		});
		s.subscribe(() => {
			const first = s.side.firstUserText;
			if (first && !get().titles[key] && rememberTitle(key, first)) set({ titles: threadTitles() });
			notifyAsks(key, s);
		});
	}
	// LRU: re-insert as newest, close the oldest beyond the limit.
	open.delete(key);
	open.set(key, session);
	while (open.size > KEEP_OPEN) {
		const [oldest, s] = open.entries().next().value as [string, ChatSession];
		if (oldest === get().activeKey) break;
		s.stop();
		open.delete(oldest);
	}
	return session;
}

const askedAbout = new Set<string>();
/** A new open question for the person (TUI T155): OS notification when the window is not in front. */
function notifyAsks(key: string, s: ChatSession): void {
	const now = Date.now();
	for (const ask of s.side.asks) {
		if (ask.to !== "human" || ask.state !== "open" || ask.deadlineAt <= now || askedAbout.has(ask.id)) continue;
		askedAbout.add(ask.id);
		if (s.side.snapshots <= 1 && document.hasFocus()) continue;
		if (document.visibilityState === "visible" && document.hasFocus() && get().activeKey === key) continue;
		if (!useSettings.getState().notifications || typeof Notification === "undefined" || Notification.permission === "denied") continue;
		const show = () => {
			const n = new Notification("dinobot이 물어봐요", { body: ask.question.slice(0, 160) });
			n.onclick = () => {
				window.focus();
				void selectThread(key);
			};
		};
		if (Notification.permission === "granted") show();
		else void Notification.requestPermission().then((p) => p === "granted" && show());
	}
}

function notifyTurnEnd(key: string): void {
	const visible = document.visibilityState === "visible" && document.hasFocus() && get().activeKey === key;
	if (visible) return;
	if (!useSettings.getState().notifications || typeof Notification === "undefined") return;
	const last = open.get(key)?.side.lastAgentText;
	const body = last ? last.replace(/\s+/g, " ").slice(-160) : "작업이 끝났어요";
	const show = () => {
		const n = new Notification(get().titles[key] ?? "dinobot", { body, silent: false });
		n.onclick = () => {
			window.focus();
			void selectThread(key);
		};
	};
	if (Notification.permission === "granted") show();
	else if (Notification.permission !== "denied") void Notification.requestPermission().then((p) => p === "granted" && show());
}

// ---------------------------------------------------------------- actions

let sessionsStreamClose: (() => void) | undefined;
let launchedSetup = false;
let recovered = false;

export async function connect(): Promise<void> {
	// The desktop app owns its daemon: start it (or find it, moving off a port another program holds) before talking to it.
	if (desktop) return startDaemon();
	set({ connection: "checking" });
	if (!(await api.healthy())) {
		set({ connection: "offline", connectionError: "데몬이 응답하지 않아요" });
		return;
	}
	await onOnline();
}

async function onOnline(): Promise<void> {
	set({ connection: "online", connectionError: undefined, logTail: undefined });
	try {
		const daemon = await api.daemon();
		set({ daemon });
	} catch {
		// Older daemons have no /v1/daemon.
	}
	await refreshThreads().catch((error) => set({ connectionError: String(error) }));
	startUsagePolling();
	void loadCommands().then(() => set({ olderDaemon: !useCommands.getState().loaded }));
	// The main process decides by the connected daemon's pid whether `dinobot update` applies (not for the bundled daemon).
	const connected = get().daemon;
	if (desktop?.checkUpdate && connected?.version) void desktop.checkUpdate(connected.version, connected.pid).then((u) => set({ update: u ?? null }));
	if (desktop?.checkDesktopUpdate) void desktop.checkDesktopUpdate().then((u) => u && set({ desktopUpdate: u }));
	sessionsStreamClose?.();
	sessionsStreamClose = openStream(
		sessionsEventsPath(),
		(event) => applySessions(event as SessionsEvent),
		(status) => {
			if (status.state === "retrying" && status.attempt > 2) void watchHealth();
		},
	);
	const { activeKey, threads } = get();
	const launch = desktop?.launch;
	if (!activeKey) {
		if (launch?.thread) await selectThread(`tui:${launch.thread}`);
		else {
			const first = threads.find((t) => t.channel === "tui");
			if (first) await selectThread(first.key);
		}
	}
	if (launch?.setup !== undefined && !launchedSetup) {
		launchedSetup = true;
		runCommandUi("setup", launch.setup || undefined);
	}
	if (desktop?.setupRecover && !recovered) {
		recovered = true;
		void desktop.setupRecover().then((r) => r.recovered && toast({ tone: "waiting", title: "끝나지 않은 설정 적용을 되돌렸어요", body: r.message, duration: 0 }));
	}
}

let watching = false;
/** The sessions stream keeps failing: check whether the daemon is gone. */
async function watchHealth(): Promise<void> {
	if (watching) return;
	watching = true;
	try {
		if (!(await api.healthy())) {
			sessionsStreamClose?.();
			sessionsStreamClose = undefined;
			for (const s of open.values()) s.stop();
			open.clear();
			set({ connection: "offline", connectionError: "데몬 연결이 끊겼어요" });
		}
	} finally {
		watching = false;
	}
}

/** Hands the update to the installer; it closes and reopens the app once the new build is verified. */
export async function startDesktopUpdate(): Promise<void> {
	const current = get().desktopUpdate;
	if (!current?.newer || current.updating || !desktop?.applyDesktopUpdate) return;
	set({ desktopUpdate: { ...current, updating: true } });
	const started = await desktop.applyDesktopUpdate().catch(() => false);
	if (!started) set({ desktopUpdate: { ...current, updating: false } });
}

export async function startDaemon(): Promise<void> {
	if (!desktop) return;
	set({ connection: "starting", connectionError: undefined, logTail: undefined });
	const result = await desktop.startDaemon();
	const config = await desktop.daemonConfig().catch(() => undefined);
	if (config) set({ config });
	if (result.ok) {
		if (result.movedFrom !== undefined && result.port !== undefined) {
			toast({ tone: "info", duration: 10_000, title: `${result.movedFrom}번 포트를 다른 프로그램이 쓰고 있어서 ${result.port}번으로 옮겼어요`, ...(config?.manifestPath ? { body: `${config.manifestPath}의 api.port를 바꿨어요.` } : {}) });
		}
		await onOnline();
	} else {
		set({ connection: "offline", connectionError: result.error ?? "데몬을 시작하지 못했어요", ...(result.logTail ? { logTail: result.logTail } : {}) });
		if (result.timedOut) void reconnectWhenDaemonAnswers();
	}
}

let lateWatch = false;
/** The daemon process is alive but slow (large database, cold disk): connect by itself once it answers instead of leaving the error screen up. */
async function reconnectWhenDaemonAnswers(): Promise<void> {
	if (lateWatch) return;
	lateWatch = true;
	try {
		const deadline = Date.now() + 5 * 60_000;
		while (Date.now() < deadline && get().connection === "offline") {
			await new Promise((r) => setTimeout(r, 2_000));
			if (get().connection !== "offline") return;
			if (await api.healthy()) return void (await startDaemon());
		}
	} finally {
		lateWatch = false;
	}
}

export async function restartDaemon(): Promise<string | null> {
	const info = get().daemon ?? (await api.daemon());
	const result = await api.shutdown(info.pid).catch((e: unknown) => ({ status: "refused" as const, error: String(e) }));
	if (result.status !== "stopping") return result.status === "refused" && "error" in result ? `재시작할 수 없어요: ${result.error}${"busy" in result && result.busy?.length ? ` (${result.busy.join(", ")})` : ""}` : "재시작할 수 없어요";
	sessionsStreamClose?.();
	for (const s of open.values()) s.stop();
	open.clear();
	set({ connection: "starting" });
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline && (await api.healthy())) await new Promise((r) => setTimeout(r, 200));
	await startDaemon();
	const key = get().activeKey;
	if (key) sessionFor(key).start();
	return null;
}

export async function selectThread(key: string): Promise<void> {
	set((s) => ({ activeKey: key, unseen: s.unseen.filter((k) => k !== key) }));
	desktop?.setBadge(get().unseen.length);
	const entry = get().threads.find((t) => t.key === key);
	const session = sessionFor(key);
	if (entry?.draft) {
		// Like the TUI, bind the new thread's working folder before its first request; without a choice the daemon
		// would use its own process directory.
		const config = get().config;
		const cwd = entry.cwd ?? useSettings.getState().defaultCwd ?? config?.workspaceRoot ?? config?.homeDir ?? null;
		if (cwd) {
			try {
				const bound = await api.workspace(key, cwd);
				if (rememberCwd(key, bound.cwd ?? bound.requestedCwd ?? cwd)) set({ cwds: threadCwds() });
			} catch (error) {
				session.notice(`작업 폴더를 설정하지 못했어요: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		}
	}
	session.start();
	void refreshModel(key);
}

let onboarded = false;
export async function refreshModel(key: string): Promise<void> {
	if (!key.startsWith("tui:")) return;
	try {
		const model = await api.model(key);
		set((s) => ({ models: { ...s.models, [key]: model } }));
		// First run (TUI T11): not signed in to the model yet -> the setup wizard, once per app run.
		if (model.signedIn === false && !onboarded) {
			onboarded = true;
			if (useCommands.getState().commands.some((c) => c.name === "setup")) runCommandUi("setup");
			else openSettings(true, "accounts");
		}
	} catch {
		// The model line is optional.
	}
}

/** Open a fresh thread; `cwd` binds it to that folder (a sidebar project) instead of the default folder. */
export function newThread(name?: string, cwd?: string): string {
	const key = `tui:${name ?? newThreadName()}`;
	if (name && get().threads.some((t) => t.key === key)) {
		void selectThread(key);
		return key;
	}
	const createdAt = createdAtOf(key);
	set((s) => ({ threads: sortThreads([{ key, channel: "tui", draft: true, ...(createdAt ? { createdAt } : {}), ...(cwd ? { cwd } : {}) }, ...s.threads]) }));
	void selectThread(key);
	return key;
}

const DELETE_REFUSED = {
	busy: "작업 중인 스레드는 지울 수 없어요. 멈춘 뒤 다시 시도해 주세요.",
	moved: "스레드가 방금 바뀌었어요. 다시 시도해 주세요.",
	quarantined: "확인이 끝나지 않은 작업 잠금이 있어 지울 수 없어요.",
} as const;

/**
 * Delete a local (tui) thread on the daemon and drop it from the list. Its stream is stopped first: an open
 * events stream that reconnected after the delete would bind the key to a fresh conversation again. A refusal
 * keeps the row and says why; a busy thread is refused here without asking the daemon. True when it is gone.
 */
export async function deleteThread(key: string): Promise<boolean> {
	const entry = get().threads.find((t) => t.key === key);
	if (!entry || entry.channel !== "tui") return false;
	const refuse = (body: string) => {
		toast({ tone: "error", title: "스레드를 지우지 못했어요", body });
		return false;
	};
	if (entry.status?.busy || (entry.status?.queued ?? 0) > 0 || (entry.status?.subagents.length ?? 0) > 0) return refuse(DELETE_REFUSED.busy);
	if (!entry.draft) {
		open.get(key)?.stop();
		open.delete(key);
		const restore = () => {
			if (get().activeKey === key) sessionFor(key).start();
		};
		try {
			const outcome = await api.deleteThread(key);
			if (outcome.status !== "deleted" && outcome.status !== "not_found") {
				restore();
				return refuse(DELETE_REFUSED[outcome.status]);
			}
		} catch (error) {
			restore();
			return refuse(error instanceof HttpError && error.status === 404 ? "이 데몬은 스레드 삭제를 지원하지 않아요. dinobot을 업데이트해 주세요." : error instanceof Error ? error.message : String(error));
		}
	} else {
		open.get(key)?.stop();
		open.delete(key);
	}
	const wasActive = get().activeKey === key;
	set((s) => ({ threads: s.threads.filter((t) => t.key !== key), unseen: s.unseen.filter((k) => k !== key), ...(s.activeKey === key ? { activeKey: null } : {}) }));
	desktop?.setBadge(get().unseen.length);
	if (wasActive) {
		const next = get().threads.find((t) => t.channel === "tui");
		if (next) void selectThread(next.key);
		else newThread();
	}
	toast({ tone: "success", title: "스레드를 지웠어요" });
	return true;
}

export function setTitle(key: string, text: string): void {
	if (rememberTitle(key, text)) set({ titles: threadTitles() });
}

export const openPalette = (query = "") => set({ paletteOpen: true, paletteQuery: query });
export const closePalette = () => set({ paletteOpen: false, paletteQuery: "" });
export const openSettings = (open = true, tab?: string) => set({ settingsOpen: open, ...(tab ? { preferencesTab: tab } : {}) });
/** Thread used for commands when no thread is open (commands are thread-scoped on the daemon). */
export const SETTINGS_THREAD = "tui:desktop-settings";
export const commandThread = () => get().activeKey ?? SETTINGS_THREAD;

export const runCommandUi = (name: string, args?: string, surface: RunSurface = "dialog") => {
	set({ paletteOpen: false });
	// Slack setup must never inherit a remote/shared active conversation.
	const key = surface === "slack" ? SETTINGS_THREAD : commandThread();
	return startCommand(key, name, args, {
		surface: name === "login" && surface === "dialog" ? "login" : surface,
		onDone: (run) => {
			if (run.stateChanged || name === "model" || name === "reasoning" || name === "fast") void refreshModel(key);
			if (run.apply) void applySetup(run.apply);
		},
	});
};

/** Setup's `apply` event: write the manifest and restart the daemon in the main process (TUI setup-apply). */
async function applySetup(request: ManifestApplyRequest): Promise<void> {
	if (!desktop?.setupApply) {
		toast({ tone: "error", title: "이 설정 변경은 데스크톱 앱에서만 적용할 수 있어요" });
		return;
	}
	set({ applying: true, applyOutcome: null });
	try {
		const info = get().daemon ?? (await api.daemon());
		const port = get().config?.port ?? 8786;
		for (const s of open.values()) s.stop();
		open.clear();
		const outcome = await desktop.setupApply(request, { pid: info.pid, owner: info.owner }, port);
		set({ applyOutcome: outcome });
		const o = outcome as { status: string; text?: string; level?: string; changes?: string[]; logPath?: string };
		toast({
			tone: o.level === "error" ? "error" : o.status === "applied" ? "success" : "waiting",
			title: o.text?.split("\n")[0] ?? o.status,
			body: [o.text?.split("\n").slice(1).join("\n"), o.changes?.join(", "), o.logPath ? `로그: ${o.logPath}` : ""].filter(Boolean).join("\n") || undefined,
			...(o.level === "error" && reportAvailable() ? { actions: createElement(ReportButton, { trigger: "setup-failed", variant: "secondary", size: "xs", testId: "report-setup-failed" }) } : {}),
			duration: 0,
		});
		await connect();
		const key = get().activeKey;
		if (key) sessionFor(key).start();
	} catch {
		set({ applyOutcome: { status: "error" } });
		toast({ tone: "error", title: "설정 적용 결과를 확인하지 못했어요. 연결 완료로 간주하지 마세요." });
	} finally {
		set({ applying: false });
	}
}
export const openSubagent = (conversationId: number, title: string) =>
	set((s) => ({ subagentView: { conversationId, title }, subagentBack: s.subagentView ? [...s.subagentBack, s.subagentView] : [] }));
export const closeSubagent = () => set({ subagentView: null, subagentBack: [] });
export const backSubagent = () => set((s) => ({ subagentView: s.subagentBack.at(-1) ?? null, subagentBack: s.subagentBack.slice(0, -1) }));
