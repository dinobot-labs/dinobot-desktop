/**
 * HTTP request/response shapes of the dinobot client API (loopback, unauthenticated).
 * Mirrored from dinobot src/api/server.ts (routes :76-312, parsers :567-645), src/channels/types.ts:12-17,
 * src/channels/ask-buttons.ts:20-25, src/core/message-images.ts:11-17, src/core/queue.ts:30,66,
 * src/core/sessions.ts:13-32, src/core/claims.ts:25, src/core/daemon-info.ts:5-34, src/setup/state.ts:6,
 * src/commands/types.ts:11-161, src/commands/index.ts:53-56, src/tui/client.ts:10,178.
 */
import type { AuthEvent, ModelThinkingLevel, Usage } from "./messages.ts";

/** Default `api.port` written by a first run (src/cli/default-manifest.ts:23). */
export const DEFAULT_API_PORT = 8786;
/** The TUI's channel (src/tui/app.ts:34). Plugins `computer`/`browser` only admit this channel by default. */
export const TUI_CHANNEL = "tui";

/** Any non-2xx JSON error body. Some 404s (unknown route) have an empty body. */
export type ErrorBody = { error: string };

/** channels/types.ts:12. `data` canonical base64 (padding required, no data: prefix). */
export type InboundImage = { mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };
/** message-images.ts:11 */
export const MESSAGE_IMAGE_LIMITS = { maxImages: 4, maxBytesPerImage: 2 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024 } as const;

/** channels/types.ts:17; parsed by ask-buttons.ts:20 (exact keys; askId /^[0-9a-f]{32}$/; option integer 0..3). */
export type AskChoice = { askId: string; option: number };

/** server.ts:617 SendBody. POST /v1/threads/:channel/:thread/messages */
export type SendMessageRequest = {
	/** Non-empty unless images are attached. With `choice`, replaced server-side by `[ask <id>] choice: <option text>`. */
	text: string;
	choice?: AskChoice;
	images?: InboundImage[];
	/** Only used when the thread is busy: "steer" lands after the current tool round; default (absent) = "followUp" after the answer. */
	whenBusy?: "followUp" | "steer";
	/** Default "local". Becomes `<from user="...">`. */
	userId?: string;
	/** Idempotency key (request id `<channel>:<messageId>`); default random UUID. */
	messageId?: string;
};
export type SendMessageResponse = {
	submissionId: number;
	/** Present when the daemon scheduled an automatic session report (frustration detected, ADR 0073). */
	autoReport?: { id: string; sendAt: string; rule: string };
};

/** POST /v1/threads/:channel/:thread/workspace (server.ts:118). Creates the thread with this cwd if new. */
export type WorkspaceRequest = { cwd: string };
/** `cwd` = the thread's effective cwd (an existing thread keeps its own); `requestedCwd` = realpath of the request. */
export type WorkspaceResponse = { cwd?: string; requestedCwd: string };

/** GET /v1/threads (server.ts:130). `key` = `<channel>:<threadKey>`; archived history keys look like `<key>#<n>`. */
export type ThreadSummary = { key: string; conversationId: number };
export type ThreadsResponse = { threads: ThreadSummary[] };

/**
 * DELETE /v1/threads/:channel/:thread (core/threads.ts deleteThread). 200 deleted, 404 not_found, 409 otherwise:
 * `busy` (a run, queued input or subagents), `moved` (rebound meanwhile), `quarantined` (claims awaiting reconcile).
 */
export type DeleteThreadResult =
	| { status: "deleted"; removed: string[]; releasedClaims: number }
	| { status: "not_found" | "moved" | "busy" | "quarantined" };

/** queue.ts:66. POST .../queue/send */
export type SendNowResult = { sent: number; submissionId?: number };
/** queue.ts:30. POST .../queue/:id/withdraw */
export type WithdrawResult =
	| { status: "withdrawn"; item: { id: number; mode: "steer" | "followUp"; text: string; userId?: string } }
	| { status: "already_placed" | "settled" | "not_found" };

/** commands/types.ts:14. GET /v1/threads/:channel/:thread/model (server.ts:196 adds signedIn). */
export type ThreadModelState = {
	/** `provider/modelId` */
	model: string;
	thinkingLevel: ModelThinkingLevel;
	/** [] = reasoning unavailable; one entry = locked. */
	supportedThinkingLevels: ModelThinkingLevel[];
	fast: boolean;
	fastSupported: boolean;
	/** false: provider has no credential yet (run /setup or /login). */
	signedIn?: boolean;
	/** From the model catalog (daemon with GET /v1/usage, PR #96); absent when unknown or on older daemons. */
	contextWindow?: number;
	maxTokens?: number;
};

/** claims.ts:25 */
export type Claim = {
	quarantined?: string;
	key: string;
	/** `channel:threadKey` or `conversation:<id>` */
	holder: string;
	intent: string;
	token: number;
	acquiredAt: number;
	expiresAt: number;
};

/** sessions.ts:13-32. GET /v1/sessions, and every frame of GET /v1/sessions/events (plus `type: "sessions"`). */
export type SessionState = "idle" | "generating" | "running_tools" | "retrying";
export type SessionSubagent = { taskId: string; description: string; subagentType: string; currentTool?: string; startedAt: number };
export type SessionStatus = {
	/** `channel:threadKey` */
	thread: string;
	conversationId: number;
	/** A run is active. */
	busy: boolean;
	state: SessionState;
	runningTools: string[];
	/** steer + followUp items waiting in the inbox */
	queued: number;
	/** running subagents only */
	subagents: SessionSubagent[];
	/** `provider/modelId` */
	model?: string;
	/** Working folder bound to the conversation (dinobot PR #99); absent on older daemons. */
	cwd?: string;
	/** Latest indexed message (epoch ms, role, one line <= 160 chars). Absent until the thread has any message. */
	lastActivityAt?: number;
	lastRole?: string;
	lastText?: string;
	claims: Claim[];
};
/** Sorted busy first, then newest activity. Threads with no activity, run, queue or subagent are omitted. */
export type SessionsSnapshot = { at: number; sessions: SessionStatus[]; claims: Claim[] };
export type SessionsEvent = SessionsSnapshot & { type: "sessions" };

/** daemon-info.ts:5-34, setup/state.ts:6. GET /v1/daemon (404 when the server has no control). */
export type DaemonOwner = "tui" | "external";
export type SetupState = { startedAt?: string; completedAt?: string };
export type DaemonInfo = {
	pid: number;
	version: string;
	manifestPath: string;
	manifestSha256: string;
	owner: DaemonOwner;
	/** ISO time */
	startedAt: string;
	/** threads with a run, queued input or running subagents */
	busy: string[];
	setup: SetupState;
};
/** POST /v1/daemon/shutdown { pid } -> 202 stopping | 409 refused. */
export type ShutdownRequest = { pid: number };
export type ShutdownResult =
	| { status: "stopping" }
	| { status: "refused"; error: "external" | "pid" | "busy"; busy?: string[] };

/** commands/types.ts:161. GET /v1/commands -> { commands } (surface "tui", sorted, disabled removed). */
export type CommandInfo = { name: string; description: string; usage?: string };
export type CommandsResponse = { commands: CommandInfo[] };
/** commands/types.ts:28. GET /v1/commands/:name/arguments?channel=&thread= -> { arguments } */
export type CommandArgument = {
	value: string;
	label: string;
	description?: string;
	group?: string;
	current?: boolean;
	badge?: string;
	disabled?: boolean;
};
export type CommandArgumentsResponse = { arguments: CommandArgument[] };

/** commands/types.ts:43-66 */
export type CommandSelectOption = {
	id: string;
	label: string;
	description?: string;
	group?: string;
	current?: boolean;
	badge?: string;
	tag?: string;
	disabled?: boolean;
};
export type CommandChecklistOption = CommandSelectOption & { checked: boolean };
/** commands/types.ts:107. Answer: select -> option id; checklist -> JSON string array of checked ids; text kinds -> text. */
export type CommandPromptSpec =
	| { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
	| { type: "select"; message: string; options: CommandSelectOption[]; login?: boolean }
	| { type: "checklist"; message: string; options: CommandChecklistOption[] };

/** commands/types.ts:80 */
export type ManifestApplyRequest = {
	manifestPath: string;
	baseSha256: string;
	candidate: string;
	changes: string[];
	summary: string[];
	locale: string;
};

/** POST /v1/threads/:channel/:thread/commands body (server.ts:594). */
export type RunCommandRequest = { name: string; args?: string; userId?: string; locale?: string };
/** commands/types.ts:95. SSE frames of a command run: starts with `started`, ends with `done` or `error`. */
export type CommandEvent =
	| { type: "apply"; request: ManifestApplyRequest }
	| { type: "started"; runId: string }
	| { type: "output"; text: string; level: "info" | "success" | "error" }
	| { type: "auth"; event: AuthEvent }
	| { type: "prompt"; id: string; prompt: CommandPromptSpec }
	| ({ type: "state" } & Partial<ThreadModelState>)
	| { type: "done" }
	| { type: "error"; message: string };
/** commands/index.ts:56. POST /v1/command-runs/:runId/prompts/:promptId -> 204 | 404 no such pending prompt. */
export type PromptAnswer = { value: string } | { cancel: true };

/** GET /v1/threads/:c/:t/research/:mission/report?file= */
export type ResearchReportResponse = { content: string };

/** GET /v1/search?q=&limit=&exclude= (core/search.ts:36-47). Snippets mark matched words with [brackets]. */
export type SearchHit = { thread: string; conversationId: number; score: number; hits: number; role: string; at: number; entryId: number; snippet: string };
export type SearchResponse = { query: string; match: "all" | "any" | "substring" | "none"; results: SearchHit[] };

/** GET /v1/usage (daemon >= the release that adds it; 404 before). Usage summary across conversations and provider limit windows. */
export type UsageLimitRow = { id: string; label: string; windowId?: string; windowLabel?: string; durationMs?: number; resetsAt?: number; usedFraction?: number; status?: string };
export type UsageAccount = {
	id: string | number;
	type?: "oauth" | "api_key";
	label?: string;
	active: boolean;
	blockedUntil?: number;
	lastFailure?: string;
	report?: { fetchedAt: number; source: string; limits: UsageLimitRow[]; notes?: string[] };
	error?: string;
	stale?: boolean;
};
export type UsageResponse = {
	at: number;
	summary: {
		conversations: number;
		models: Record<string, Usage>;
		tools: Record<string, Usage>;
		threads: { thread: string; conversationId: number; totalTokens: number; cost: number; lastActivityAt?: number }[];
	};
	limits: { providers: { key: string; name: string; accounts: UsageAccount[] }[] };
};
