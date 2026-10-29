import type { BrowserUiBridge } from "./browser-types.ts";
export type { BrowserReply, BrowserTab, BrowserViewState, BrowserUiAction, ChromeProfile, BrowserUiBridge } from "./browser-types.ts";

/** The preload bridge (window.dinobotDesktop). Shared by the main process and the web app. */
export interface DaemonConfig {
	/** Manifest the daemon is (or would be) started with. */
	manifestPath: string | null;
	/** api.port from the manifest, or 8786. */
	port: number;
	dataDir: string | null;
	/** bot.workspaceRoot from the manifest, if set. */
	workspaceRoot: string | null;
	/** The user's home directory: the working folder of new threads when nothing else is set. */
	homeDir: string;
	/** Resolved dinobot executable (the bundled daemon's main.js in an installed app), or null when there is none. */
	command: string | null;
	/** The daemon that ships with the app is the one that will be started (it is updated with the app). */
	bundled?: boolean;
	/** Why the manifest could not be read, if it could not. */
	problem?: string;
}

export interface DaemonStartResult {
	ok: boolean;
	pid?: number;
	/** Last log lines when the start failed. */
	logTail?: string;
	error?: string;
	/** The daemon process is still running but did not answer in time; it may come up later. */
	timedOut?: boolean;
	/** The port the daemon answers on. */
	port?: number;
	/** api.port was taken by another program, so the manifest was moved from this port to {@link port}. */
	movedFrom?: number;
}

/** Command-line choices (TUI T01/T13): `--thread <name>`, `--resume` (= main), `--setup [section]`. */
export interface LaunchArgs {
	thread?: string;
	setup?: string;
}

export interface DesktopBridge {
	/** Optional for compatibility with older desktop builds. No transport credentials cross this bridge. */
	browserCall?: BrowserUiBridge["browserCall"];
	platform: NodeJS.Platform;
	launch: LaunchArgs;
	version: string;
	daemonConfig(): Promise<DaemonConfig>;
	startDaemon(): Promise<DaemonStartResult>;
	openDaemonLog(): Promise<void>;
	pickDirectory(): Promise<string | null>;
	openExternal(url: string): Promise<void>;
	/** Repaint the native caption buttons for the current theme (Windows, Linux). */
	setTitleBarTheme(theme: { background: string; foreground: string }): void;
	/** Count of unseen finished turns, shown on the taskbar/dock. */
	setBadge(count: number): void;
	onMenuCommand(listener: (command: MenuCommand) => void): () => void;
}

export type MenuCommand = "new-thread" | "command-palette" | "settings" | "toggle-panel" | "find" | "report";

// ---------------------------------------------------------------------------------------------------------------------
// Main-process features (ipc-features.ts)

/** One row of the `@` reference completion. `insert` is the whole token for the composer, e.g. "@file:src/app.ts ". */
export interface RefItem {
	insert: string;
	label: string;
	description?: string;
	kind: "kind" | "file" | "folder";
}

/** `@` references expanded for sending. When `blocked` is set nothing was attached and `text` is the original text. */
export interface RefsExpansion {
	text: string;
	warnings: string[];
	blocked?: string;
}

export interface ImageData {
	mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
	/** base64 */
	data: string;
	bytes: number;
}

/**
 * A composer attachment sent as a path instead of inline (anything but an in-limit png/jpeg/gif/webp). A file is copied
 * into `<temp>/dinobot-attachments/<stamp>-<random>/` so the agent opens a stable snapshot with its tools; a folder is
 * referenced where it is. The daemon runs on this machine, so the path is valid for it.
 */
export interface StagedAttachment {
	kind: "file" | "folder";
	/** Absolute path the agent opens: the staged copy, or the folder itself. */
	path: string;
	/** The name the person attached (chip label). */
	name: string;
	/** Size of the staged copy; 0 for a folder. */
	bytes: number;
}

/** A file with no path on disk (clipboard data, a drag from a web page) crosses IPC in memory up to this size. */
export const MAX_IN_MEMORY_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** One path checked for the Artifacts panel; `path` is the real file (symlinks resolved). */
export type ArtifactStat =
	| { requested: string; ok: true; path: string; kind: "html" | "image"; bytes: number; mtimeMs: number }
	| { requested: string; ok: false; error: string };

/** An artifact's content: HTML text for a sandboxed frame, or an image as base64. */
export type ArtifactContent =
	| { kind: "html"; path: string; text: string; bytes: number; mtimeMs: number }
	| { kind: "image"; path: string; mimeType: string; data: string; bytes: number; mtimeMs: number };

export interface UpdateCheck {
	latest: string;
	newer: boolean;
}

/** A newer build of this desktop app on the invite download channel (only for copies the installer put in place). */
export interface DesktopUpdate {
	current: string;
	latest: string;
	newer: boolean;
}

/** The `apply` command event of /setup: a manifest change the client writes and applies by restarting its daemon. */
export interface ManifestApplyRequest {
	/** Absolute path of the manifest the daemon booted from. */
	readonly manifestPath: string;
	/** sha256 of the manifest text the candidate was derived from; the write is refused when the file changed since. */
	readonly baseSha256: string;
	readonly candidate: string;
	/** One line per changed entry, e.g. `+ channels.telegram`. */
	readonly changes: readonly string[];
	/** Shown after a successful restart. */
	readonly summary: readonly string[];
	/** Locale the copy of the outcome should use. */
	readonly locale: string;
}

export type ApplyStatus =
	| { status: "applied" }
	| { status: "saved_external" }
	| { status: "conflict" }
	| { status: "invalid"; problems: string[] }
	| { status: "unreachable" }
	| { status: "older_daemon" }
	| { status: "other_manifest"; path: string }
	| { status: "unsafe_change" }
	| { status: "busy"; threads: string[] }
	| { status: "stuck"; pid: number }
	| { status: "rolled_back"; reason: string; log: string }
	| { status: "failed"; reason: string; log: string };

/** An apply outcome plus what the TUI shows for it: the full notice text (request locale), its level, and the request's lines. */
export type ApplyOutcome = ApplyStatus & {
	text: string;
	level: "success" | "info" | "error";
	changes: string[];
	summary: string[];
	/** <dataDir>/dinobot.log, for a "show log" link. */
	logPath: string | null;
};

export interface SetupRecovery {
	recovered: boolean;
	/** The notice to show (restored), or why recovery failed. */
	message?: string;
}

/** Why a problem report is sent (the manifest's `trigger.rule`). */
export type ReportTrigger = "button" | "setup-failed" | "daemon-down";

/** `dinobot report consent --json`: the consent text the person agrees to before the first report. */
export type ReportConsentResult =
	| { ok: true; version: string; text: string; textSha256?: string; consented: boolean; auto: boolean }
	| { ok: false; error: string };

/** `dinobot report agree <version>`; `versionMismatch` when the text changed since it was shown. */
export type ReportAgreeResult = { ok: true } | { ok: false; error: string; versionMismatch?: boolean };

/** The open thread whose conversation the report includes (daemon mode): `channel:key` as in the daemon's thread list. */
export interface ReportThread {
	channel: string;
	key: string;
}

export interface ReportSendRequest {
	trigger: ReportTrigger;
	note?: string;
	thread?: ReportThread;
}

/** `dinobot report send --json`: sent (uploaded), pending (stored, retried later), failed, or consent_required. */
export interface ReportSendResult {
	status: "sent" | "pending" | "failed" | "consent_required";
	id?: string;
	shortId?: string;
	error?: string;
	/** "daemon" or "offline". */
	mode?: string;
}

export interface DesktopFeatureBridge {
	/** app.getLocale(), e.g. "ko" or "en-US". */
	locale: string;
	gitBranch(cwd: string): Promise<string | null>;
	refsComplete(cwd: string, token: string): Promise<RefItem[]>;
	refsExpand(cwd: string, text: string, opts?: { contextWindow?: number }): Promise<RefsExpansion>;
	clipboardImage(): Promise<{ mimeType: "image/png"; data: string; bytes: number } | null>;
	clipboardFilePaths(): Promise<string[]>;
	readImageFile(path: string): Promise<ImageData | { error: string }>;
	/**
	 * Stage a dropped, picked or pasted file (or a pasted absolute path) as a path attachment. Optional for older
	 * desktop builds.
	 */
	stageAttachment?(file: File | string): Promise<StagedAttachment | { error: string }>;
	/** Which of these absolute (or `~/`) paths are HTML pages or images the panel may show. */
	artifactStat(paths: string[]): Promise<ArtifactStat[]>;
	artifactRead(path: string): Promise<ArtifactContent | { error: string }>;
	/** Open with the default app (HTML: the browser), or show it in the file manager. false when not allowed. */
	artifactOpen(path: string, how: "open" | "reveal"): Promise<boolean>;
	/** Newer dinobot on npm for the connected daemon (`pid`); null for the app's bundled daemon, which updates with the app. */
	checkUpdate(current: string, pid?: number): Promise<UpdateCheck | null>;
	/** null for dev builds and copies not installed by the invite installer. */
	checkDesktopUpdate(): Promise<DesktopUpdate | null>;
	/** Starts the installer, which closes and restarts the app once the new build is verified. false when unavailable. */
	applyDesktopUpdate(): Promise<boolean>;
	setupApply(request: ManifestApplyRequest, daemon: { pid: number; owner: "tui" | "external" }, port: number): Promise<ApplyOutcome>;
	setupRecover(): Promise<SetupRecovery>;
	/** Optional for older desktop builds. */
	reportConsent?(): Promise<ReportConsentResult>;
	reportAgree?(version: string, auto: boolean): Promise<ReportAgreeResult>;
	reportSend?(request: ReportSendRequest): Promise<ReportSendResult>;
}

// Declaration merging: the bridge carries the feature methods too.
export interface DesktopBridge extends DesktopFeatureBridge {}
