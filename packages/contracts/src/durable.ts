/**
 * Durable runtime shapes the thread event stream carries. Mirrored from @earendil-works/pi-durable 1.0.2:
 * dist/types.d.ts:262-384 (ContextEdit, EntryRecord, SubmissionRecord), dist/harness/events.d.ts:9-151
 * (MessageChange, SnapshotEvent, AgentEvent), dist/harness/live.d.ts:8-40 (ToolSlot, CompactionStatus),
 * dist/harness/types.d.ts:88-92,237-253,324 (ToolDiagnostic, AgentState, CompactionReason), dist/harness/usage.d.ts (UsageState).
 * Durable ids are plain numbers on the wire.
 */
import type { AssistantMessage, JsonObject, JsonValue, Message, ModelThinkingLevel, Usage } from "./messages.ts";

export type EntryId = number;
export type SubmissionId = number;
export type TaskId = number;
export type ConversationId = number;

/**
 * Built-in entry kinds (pi-durable dist/entries.js:10-30) plus the dinobot memory-recall note
 * (dinobot src/core/ui-contract.ts:24). Other `dinobot.*` kinds may appear; clients ignore unknown kinds.
 */
export const ENTRY_KINDS = {
	/** `model` = [UserMessage] */
	user: "pi.user",
	/** `model` = [AssistantMessage] (any stop reason, including error/aborted) */
	assistant: "pi.assistant",
	/** `model` = [SystemMessage]; prompt/tool/section patches */
	system: "pi.system",
	/** `model` = [ToolResultMessage]; `data.diagnostics` = ToolDiagnostic[] */
	toolResult: "pi.tool-result",
	/** new context (`/new`-like reset or handoff); `model` absent or [UserMessage] handoff */
	reset: "pi.reset",
	/** compaction summary; `model` = [UserMessage] summary, `head` = first kept entry */
	compaction: "pi.compaction",
	/** recalled project memories; `data` = MemoryNoteData */
	memoryNote: "dinobot.nudge",
} as const;
export type KnownEntryKind = (typeof ENTRY_KINDS)[keyof typeof ENTRY_KINDS];

/** pi-durable types.d.ts:262 */
export type ContextEdit = { target: EntryId } & ({ action: "omit" } | { action: "replace"; messages: Message[] });

/** pi-durable types.d.ts:274. Immutable transcript record; identity for dedupe is `id`. */
export type EntryRecord = {
	id: EntryId;
	conversationId: ConversationId;
	kind: string;
	model?: Message[];
	data?: JsonValue;
	head?: EntryId;
	edits?: ContextEdit[];
	byTaskId?: TaskId;
};

/** pi-durable harness/types.d.ts:88 */
export type ToolDiagnostic = { severity: "info" | "warn" | "error"; message: string; code?: string };

/** pi-durable harness/types.d.ts:324 */
export type CompactionReason = "manual" | "threshold" | "overflow";

/** pi-durable harness/types.d.ts:237 (`pi.agent`); `{}` when absent. */
export type ModelRef = { provider: string; modelId: string };
export type AgentState = {
	model?: ModelRef;
	thinkingLevel?: ModelThinkingLevel;
	extensions?: string[] | { add?: string[]; remove?: string[] };
	tools?: string[] | { remove: string[] };
	instructions?: string;
	cwd?: string;
};

/** pi-durable harness/usage.d.ts. Keys: `provider/modelId` and tool names. */
export type UsageState = { models: Record<string, Usage>; tools: Record<string, Usage> };

/** pi-durable harness/live.d.ts:8. One call of the current tool round. */
export type ToolSlot = {
	callId: string;
	name: string;
	taskId?: TaskId;
	status: "pending" | "running" | "done";
	output?: string;
	droppedBytes?: number;
	droppedLines?: number;
	details?: JsonValue;
	diagnostics?: ToolDiagnostic[];
	entry?: EntryId;
};

/** pi-durable harness/live.d.ts:29 */
export type CompactionStatus = { taskId: TaskId; reason: CompactionReason; blocking: boolean; attempt: number; retry?: { at: number; error: string } };

/** pi-durable harness/events.d.ts:9 (raw inbox view; dinobot clients use `queue` / `queue_status` instead). */
export type QueuedItem = { id: SubmissionId; mode: "steer" | "followUp" | "write" };

/** pi-durable types.d.ts:320 */
export type SubmissionRecord = {
	id: SubmissionId;
	conversationId: ConversationId;
	requestId?: string;
	type: "input" | "write";
	status: "queued" | "placed" | "done" | "unanswered";
	entry?: EntryId;
	answer?: EntryId;
	reason?: string;
	detail?: JsonValue;
};

type Block = AssistantMessage["content"][number];

/** pi-durable harness/events.d.ts:14. Changes to the in-flight assistant message, applied in order. */
export type MessageChange =
	| { type: "text_start" | "thinking_start" | "toolcall_start"; contentIndex: number; block: Block }
	| { type: "text_delta" | "thinking_delta"; contentIndex: number; delta: string }
	| { type: "toolcall_delta"; contentIndex: number; path: (string | number)[]; delta: string }
	/** Whole replacement of content[contentIndex]. */
	| { type: "block"; contentIndex: number; block: Block }
	/** Whole replacement of the partial message. */
	| { type: "message"; message: AssistantMessage };

/** pi-durable harness/events.d.ts:35. First frame of every thread event stream (dinobot adds workflow/dag/queue). */
export type SnapshotEvent = {
	type: "snapshot";
	/** Every entry of the conversation, in id order (full history, can be MBs). */
	entries: EntryRecord[];
	/** Present exactly while a run is active (busy). */
	run?: { inputs: SubmissionId[] };
	/** Current generation attempt: in-flight partial, retry backoff or deferred poll. */
	generation?: { attempt: number; message?: AssistantMessage; retry?: { at: number; error: string }; deferred?: { pollAt: number } };
	tools: ToolSlot[];
	compactions: CompactionStatus[];
	inbox: QueuedItem[];
	agent: AgentState;
	usage: UsageState;
};

/** pi-durable harness/events.d.ts:62. Everything after the snapshot (and replacement snapshots). */
export type AgentEvent =
	| SnapshotEvent
	| { type: "run_start"; inputs: SubmissionId[] }
	| { type: "run_end"; inputs: SubmissionId[] }
	| { type: "turn_start" }
	| { type: "turn_end" }
	/** Assistant partial began (`message` may already hold content), or a non-streamed message (user, toolResult) is about to end. */
	| { type: "message_start"; message: Message }
	| { type: "message_update"; usage: Usage; changes: MessageChange[] }
	| { type: "message_end"; entry: EntryRecord }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: JsonObject }
	| {
			type: "tool_execution_update";
			toolCallId: string;
			toolName: string;
			/** front trim then append of the retained output window, or a replacement */
			output?: { trimStart?: number; append?: string } | { set: string };
			details?: JsonValue;
			diagnostics?: ToolDiagnostic[];
	  }
	/** `entry` absent: the tool task faulted or was orphaned. The same entry also arrives as message_start+message_end. */
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; entry?: EntryRecord }
	| { type: "inbox_update"; items: QueuedItem[] }
	| { type: "submission"; record: SubmissionRecord }
	| { type: "auto_retry_start"; attempt: number; at: number; errorMessage: string }
	| { type: "auto_retry_end"; attempt: number }
	| { type: "deferred_poll"; pollAt: number }
	/** An entry without model messages (e.g. dinobot.nudge, model-less pi.reset). */
	| { type: "entry_appended"; entry: EntryRecord }
	| { type: "agent_changed"; agent: AgentState }
	| { type: "usage_changed"; usage: UsageState }
	| { type: "task_failed"; taskId: TaskId; kind: string; message: string }
	| { type: "compaction_start"; taskId: TaskId; reason: CompactionReason; blocking: boolean }
	| { type: "compaction_end"; taskId: TaskId; reason: CompactionReason };

export type AgentEventType = AgentEvent["type"];
