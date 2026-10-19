/**
 * dinobot-specific shapes on the thread stream and in tool `details`.
 * Mirrored from dinobot src/core/ui-contract.ts:12-163, src/core/verification.ts:94-108,
 * src/core/verification-execution.ts:21-22, src/core/dag.ts:58, src/core/plan.ts:18, src/core/ask.ts:10-46,
 * src/core/codemode/calls.ts:36,93 and src/tui/state.ts:313 (AskView).
 */
import type { AgentEvent, SnapshotEvent } from "./durable.ts";
import type { JsonValue } from "./messages.ts";

/** ui-contract.ts:12-22. Tool names the UI treats specially. */
export const TODO_TOOL = "todo_write";
export const TASK_TOOL = "task";
export const TASK_OUTPUT_TOOL = "task_output";
export const KILL_TASK_TOOL = "kill_task";
export const TASK_MESSAGE_TOOL = "task_message";
export const CODEMODE_TOOL = "codemode";
/** state.ts:95. Calls never drawn as tool rows; their details feed todos / subagents instead. */
export const HIDDEN_TOOLS: readonly string[] = [TODO_TOOL, TASK_TOOL, TASK_OUTPUT_TOOL, KILL_TASK_TOOL, TASK_MESSAGE_TOOL];
/** ui-contract.ts:24-27 */
export const MEMORY_NOTE_KIND = "dinobot.nudge";
export type MemoryNoteData = { schema: 1; items: { key: string; revision: number }[] };
export const AGREEMENTS_SECTION = "working_agreements";

/** ui-contract.ts:29-32. The latest successful todo_write result (or codemode details.todos) is the whole list. */
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoItem = { id: string; content: string; status: TodoStatus; workId?: string };
export type TodoDetails = { todos: TodoItem[] };

/** verification.ts:94-108 */
export type PlanState = "met" | "pending" | "stale" | "running" | "cancelled" | "unknown" | "failed";
export type CheckEvidenceKind = "behavioral" | "build" | "lint" | "typecheck" | "smoke" | "human";
export type PlanCheck = { id: string; evidence: CheckEvidenceKind; expected: string; state: PlanState };
export type PlanRequirement = { id: string; assertion: string; checkIds: string[]; state: PlanState };
export type WorkPlan = { requirements: PlanRequirement[]; checks: PlanCheck[] };
export type WorkCertificate = {
	id: string; workId: string; sourceIds: string[]; contractHash: string; version: number; methodEpoch: number;
	mutationEpoch: number; fingerprint: string; evidenceIds: string[]; at: number; limitations: string[];
};
export type WorkflowState = "informational" | "planning" | "implementing" | "verifying" | "verified" | "blocked" | "cancelled";
/** verification.ts:100. `methods`/`evidence` are diagnostic detail; render `status`, `blockers`, `plan`. */
export type WorkflowStatus = {
	status: WorkflowState;
	workId: string | null;
	sourceIds: string[];
	version: number;
	methodEpoch: number;
	mutationEpoch: number;
	blockers: string[];
	unmetCheckIds: string[];
	certificate: WorkCertificate | null;
	costs: { attempts: number; repairs: number; seconds: number; coaching: number; slots: string[] } | null;
	methods: Record<string, JsonValue[]>;
	evidence: JsonValue[];
	limitations: string[];
	plan?: WorkPlan;
};

/** ui-contract.ts:34-64 */
export type SubagentStatus = "running" | "completed" | "failed" | "cancelled";
export type SubagentProgress = {
	/** `sa-<n>`; "" on a provisional row before the daemon reports it. */
	taskId: string;
	description: string;
	subagentType: string;
	background: boolean;
	/** Child conversation; stream it with GET /v1/conversations/:id/events (0 = not yet known). */
	conversationId: number;
	status: SubagentStatus;
	startedAt: number;
	endedAt?: number;
	currentTool?: string;
	toolCount: number;
	lastText?: string;
	tokens?: number;
	messages?: number;
	messageSubmissions?: number[];
	error?: string;
	workflow?: WorkflowStatus;
};
export type TaskDetails = { subagent: SubagentProgress };
export type TaskOutputDetails = { subagents: SubagentProgress[] };

/** dag.ts:58, plan.ts:18, ui-contract.ts:75-152 */
export type RunStatus = "compiling" | "running" | "verified" | "blocked" | "cancelled";
export type NodeKind = "act" | "delegate" | "verify" | "ask" | "expand";
export type DagNodeState = "pending" | "ready" | "running" | "waiting" | "succeeded" | "failed" | "skipped";
export type DagNodeView = {
	id: string;
	kind: NodeKind;
	title: string;
	state: DagNodeState;
	/** 0-based longest-path depth; every edge goes to a strictly higher level. */
	level: number;
	/** Transitive reduction of direct parents (draw these edges). */
	parents: string[];
	directParents: string[];
	attempt: number;
	maxAttempts: number;
	/** `sa-...` subagent, `orchestrator` (ask nodes) or `check:<id>`. */
	handle?: string;
	startedAt?: number;
	endedAt?: number;
	error?: string;
	result?: string;
	covers: string[];
	critical: boolean;
};
export type ResearchCandidate = {
	id: string; parentId?: string; operation: string; state: string; hypothesis: string; value?: number; unit?: string;
	delta?: number; validity?: string; verdict?: string; feedback: string; runId?: string; nodeId?: string;
};
export type ResearchView = {
	id: string;
	revision: number;
	question: string;
	status: string;
	judgment?: string;
	stopReason?: string;
	deadlineAt: number;
	attempts: { used: number; limit: number };
	rounds: { used: number; limit: number };
	candidateBudget: { used: number; limit: number };
	activeAttempts: number;
	maxConcurrent: number;
	confirmationReserved: number;
	incumbentId?: string;
	selectedId?: string;
	candidates: ResearchCandidate[];
	report: { directory: string; state: string; writtenRevision?: number; error?: string };
};
export type DagView = {
	id: string;
	revision: number;
	status: RunStatus;
	reason?: string;
	replanBudget: number;
	requirements: { id: string; certified: boolean }[];
	levels: number;
	/** Display order: by level, then compiled order. Layout never depends on node state. */
	nodes: DagNodeView[];
	diagnostics?: string[];
	updatedAt: number;
	research?: ResearchView;
};

/** ui-contract.ts:159. `text` has the `<from>` header stripped. */
export type QueuedInput = { id: number; mode: "steer" | "followUp"; text: string; userId?: string };

/** ui-contract.ts:66-161. Events dinobot adds to the pi-durable stream. */
export type SubagentProgressEvent = { type: "subagent_progress"; subagents: SubagentProgress[]; callId?: string };
export type WorkflowStatusEvent = { type: "workflow_status"; workflow: WorkflowStatus | null };
export type DagStatusEvent = { type: "dag_status"; dag: DagView | null };
export type QueueStatusEvent = { type: "queue_status"; items: QueuedInput[] };
/** ui-contract.ts:162. The first frame, and any later replacement snapshot. */
export type ClientSnapshotEvent = SnapshotEvent & { workflow?: WorkflowStatus | null; dag?: DagView | null; queue?: QueuedInput[] };
/** ui-contract.ts:163. Every JSON frame of GET /v1/threads/:c/:t/events and /v1/conversations/:id/events. */
export type ClientEvent =
	| Exclude<AgentEvent, SnapshotEvent>
	| ClientSnapshotEvent
	| SubagentProgressEvent
	| WorkflowStatusEvent
	| DagStatusEvent
	| QueueStatusEvent;
export type ClientEventType = ClientEvent["type"];

/** ask.ts:10-46. Durable ask record; appears in tool details `ask`, `relayed` and `asks[]`. */
export type AskKind = "clarification" | "decision" | "acceptance" | "authority" | "conflict" | "external";
export type AskState = "open" | "answered" | "defaulted" | "withdrawn";
export type AskTarget = "main" | "human";
export type AskRecord = {
	/** 32 lowercase hex chars. */
	id: string;
	from: { conversationId: number; taskId?: string };
	to: AskTarget;
	kind: AskKind;
	refs: string[];
	question: string;
	/** 2-4 choices for human decision/clarification asks. */
	options?: string[];
	default: string;
	createdAt: number;
	deadlineAt: number;
	state: AskState;
	answer?: string;
	resolvedAt?: number;
	resolvedBy?: string;
	sourceEntry?: number;
	relays?: string;
	late?: { answer: string; at: number; by: string };
	run?: string;
	node?: string;
	keys?: string[];
	nodeKey?: string;
	goalBinding?: { epoch: number; hash: string; conversationId?: string };
};
/** tui/state.ts:313. The flattened view the TUI keeps per ask id (`from` = taskId or conversationId as text). */
export type AskView = {
	id: string;
	to: AskTarget;
	kind: string;
	question: string;
	from: string;
	state: string;
	answer?: string;
	default: string;
	deadlineAt: number;
	options?: string[];
};
/** Tool details that may carry asks (ask/answer tools, dag_step, task, task_output, codemode merges). */
export type AskDetails = { ask?: AskRecord; relayed?: AskRecord; asks?: AskRecord[] };

/** codemode/calls.ts:36,93. Live receipts of the calls a codemode cell made. */
export type CodemodeCallStatus = "pending" | "running" | "done" | "failed" | "aborted";
export type CodemodeCallReceipt = {
	id: number;
	name: string;
	status: CodemodeCallStatus;
	preview?: string;
	detail?: string;
	startedAt?: number;
	endedAt?: number;
	error?: string;
};
/**
 * `codemode` tool details (live slot and final result). Inner tool details are merged in: `todos` (todo_write),
 * `subagent` (task), `subagents` (task_output/kill_task), and on the final result also `ask`, `goal`, ... .
 */
export type CodemodeDetails = Partial<TodoDetails & TaskDetails & TaskOutputDetails & AskDetails> & {
	codemodeTaskId?: number;
	codemodeCalls?: CodemodeCallReceipt[];
	[key: string]: unknown;
};
