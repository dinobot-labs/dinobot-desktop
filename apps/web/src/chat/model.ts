/**
 * Chat model: turns one thread's event stream (docs/protocol.md §3) into transcript blocks, run state and the
 * side panels (todos, subagents, asks, queue, DAG, workflow). Same semantics as the TUI reducer
 * (dinobot src/tui/state.ts), so both clients show the same thing for the same stream.
 *
 * Blocks are mutable records with a `version`; `revision` is a monotone clock bumped on every visible change. React
 * reads a frozen view through `ChatStore` (store.ts) and memoizes rows on (id, version).
 */
import {
	AGREEMENTS_SECTION,
	type AssistantMessage,
	type AskView,
	type ClientEvent,
	type ClientSnapshotEvent,
	type DagView,
	type EntryRecord,
	type JsonObject,
	KILL_TASK_TOOL,
	MEMORY_NOTE_KIND,
	type MemoryNoteData,
	type Message,
	type MessageChange,
	type QueuedInput,
	stripFromHeader,
	type SubagentProgress,
	TASK_MESSAGE_TOOL,
	TASK_OUTPUT_TOOL,
	TASK_TOOL,
	type TaskDetails,
	type TaskOutputDetails,
	TODO_TOOL,
	type TodoDetails,
	type TodoItem,
	type ToolResultMessage,
	type Usage,
	type UsageState,
	type UserMessage,
	type WorkflowStatus,
} from "@dinobot/contracts";
import { type ArtifactMention, pathsInText, pathsInToolCall, pathsInToolResult, recordArtifacts } from "./artifacts.ts";

type BlockBase = { readonly id: string; version: number };
export type ImagePart = { readonly mimeType: string; readonly data: string };
export type UserBlock = BlockBase & { kind: "user"; text: string; at: number; images?: readonly ImagePart[] };
export type AgentBlock = BlockBase & { kind: "agent"; text: string; at: number; streaming: boolean };
export type ThinkingBlock = BlockBase & { kind: "thinking"; text: string; startedAt: number; endedAt?: number; streaming: boolean };
export type ToolStatus = "pending" | "running" | "done" | "error" | "cancelled";
export type ToolBlock = BlockBase & {
	kind: "tool";
	callId: string;
	name: string;
	args: JsonObject;
	status: ToolStatus;
	/** Live output window while running. */
	output: string;
	/** Final result text. */
	result?: string;
	details?: unknown;
	startedAt?: number;
	endedAt?: number;
};
export type SubagentBlock = BlockBase & { kind: "subagent"; callId: string; progress: SubagentProgress };
export type NoticeLevel = "info" | "error" | "turn";
export type NoticeBlock = BlockBase & { kind: "notice"; text: string; level: NoticeLevel; elapsedMs?: number; tps?: number };
export type Block = UserBlock | AgentBlock | ThinkingBlock | ToolBlock | SubagentBlock | NoticeBlock;

export type RunPhase = "waiting_response" | "thinking" | "responding" | "tool" | "waiting_subagents" | "compacting" | "retry";
export type RunState = {
	startedAt: number;
	phase: RunPhase;
	phaseStartedAt: number;
	tool?: string;
	retry?: string;
	/** The run was already going when this client attached: its start time is unknown. */
	attached?: boolean;
};
export type AgentInfo = { model?: { provider: string; modelId: string }; cwd?: string };

export interface ChatData {
	blocks: Block[];
	run: RunState | undefined;
	lastTurnMs: number | undefined;
	todos: TodoItem[];
	subagents: Map<string, SubagentProgress>;
	asks: Map<string, AskView>;
	/** Asks the person already answered in the transcript; the agent resolves them later, the bar hides them now. */
	answeredAsks: Set<string>;
	queue: QueuedInput[];
	workflow: WorkflowStatus | null;
	dag: DagView | null;
	agent: AgentInfo;
	usage: { contextTokens: number; sent: number; output: number; totalTokens: number; cost: number };
	/** The thread's usage ledger (per model and per tool), as the daemon keeps it. */
	ledger: UsageState;
	/** Last live model call: tok/s and cache ratio (TUI T145). */
	call: { tps?: number; cacheRatio?: number };
	/** Output tokens / generation time of this turn's timed calls. */
	turn: { outputTokens: number; generationMs: number; firstTokenAt: number | null | undefined };
	/** Snapshots seen (0 until the first one arrives). */
	snapshots: number;
	revision: number;
	seenEntries: Set<number>;
	/** contentIndex of the in-flight assistant partial -> block index (-1: none). */
	live: number[];
	toolRows: Map<string, number>;
	subagentRows: Map<string, number>;
	subagentRowsByTask: Map<string, number>;
	/** Paths of HTML pages and images seen in settled messages (artifacts.ts), oldest first. */
	artifacts: Map<string, ArtifactMention>;
}

export const HIDDEN_TOOLS: ReadonlySet<string> = new Set([TODO_TOOL, TASK_TOOL, TASK_OUTPUT_TOOL, KILL_TASK_TOOL, TASK_MESSAGE_TOOL]);
export const isHiddenTool = (name: string): boolean => HIDDEN_TOOLS.has(name);

export function createChatData(): ChatData {
	return {
		blocks: [],
		run: undefined,
		lastTurnMs: undefined,
		todos: [],
		subagents: new Map(),
		asks: new Map(),
		answeredAsks: new Set(),
		queue: [],
		workflow: null,
		dag: null,
		agent: {},
		usage: { contextTokens: 0, sent: 0, output: 0, totalTokens: 0, cost: 0 },
		ledger: { models: {}, tools: {} },
		call: {},
		turn: { outputTokens: 0, generationMs: 0, firstTokenAt: undefined },
		snapshots: 0,
		revision: 0,
		seenEntries: new Set(),
		live: [],
		toolRows: new Map(),
		subagentRows: new Map(),
		subagentRowsByTask: new Map(),
		artifacts: new Map(),
	};
}

// ---------------------------------------------------------------- primitives

let nextId = 0;
const newId = (prefix: string): string => `${prefix}-${++nextId}`;
const bump = (d: ChatData): number => ++d.revision;
const touch = (d: ChatData, block: Block): void => {
	block.version = bump(d);
};
function push(d: ChatData, block: Block): number {
	block.version = bump(d);
	d.blocks.push(block);
	return d.blocks.length - 1;
}
function removeAt(d: ChatData, index: number): void {
	d.blocks.splice(index, 1);
	for (const map of [d.toolRows, d.subagentRows, d.subagentRowsByTask]) {
		for (const [key, row] of map) {
			if (row === index) map.delete(key);
			else if (row > index) map.set(key, row - 1);
		}
	}
	d.live = d.live.map((row) => (row === index ? -1 : row > index ? row - 1 : row));
	bump(d);
}
function notice(d: ChatData, text: string, level: NoticeLevel, extra: { elapsedMs?: number; tps?: number } = {}): void {
	push(d, { kind: "notice", id: newId("notice"), version: 0, text, level, ...extra });
}
function setPhase(d: ChatData, phase: RunPhase, now: number, tool?: string): void {
	if (!d.run) return;
	if (d.run.phase === phase && d.run.tool === tool) return;
	const next: RunState = { startedAt: d.run.startedAt, phase, phaseStartedAt: now };
	if (tool !== undefined) next.tool = tool;
	if (d.run.attached) next.attached = true;
	d.run = next;
	bump(d);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTaskDetails = (v: unknown): v is TaskDetails => isObject(v) && isObject(v.subagent) && typeof v.subagent.taskId === "string";
const isTaskOutputDetails = (v: unknown): v is TaskOutputDetails => isObject(v) && Array.isArray(v.subagents);
const isTodoDetails = (v: unknown): v is TodoDetails => isObject(v) && Array.isArray(v.todos);

export const userText = (message: UserMessage): string =>
	stripFromHeader(typeof message.content === "string" ? message.content : message.content.map((p) => (p.type === "text" ? p.text : "")).join(""));
export const resultText = (message: ToolResultMessage): string => message.content.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("\n");
const contextTokensOf = (u: Usage): number => u.input + u.cacheRead + u.cacheWrite + u.output;

// ---------------------------------------------------------------- run lifecycle

function startRun(d: ChatData, now: number): void {
	if (d.run) return;
	d.run = { startedAt: now, phase: "waiting_response", phaseStartedAt: now };
	d.turn = { outputTokens: 0, generationMs: 0, firstTokenAt: undefined };
	bump(d);
}

function endRun(d: ChatData, now: number): void {
	if (!d.run) return;
	d.lastTurnMs = now - d.run.startedAt;
	d.run = undefined;
	finishStreaming(d, now);
	const tps = d.turn.generationMs >= 250 && d.turn.outputTokens > 0 ? d.turn.outputTokens / (d.turn.generationMs / 1000) : undefined;
	notice(d, "Worked for", "turn", { elapsedMs: d.lastTurnMs, ...(tps === undefined ? {} : { tps }) });
}

function finishStreaming(d: ChatData, now: number): void {
	for (const row of d.live) {
		const block = d.blocks[row];
		if (!block) continue;
		if (block.kind === "agent" && block.streaming) {
			block.streaming = false;
			touch(d, block);
		} else if (block.kind === "thinking" && block.streaming) {
			block.streaming = false;
			block.endedAt = now;
			touch(d, block);
		}
	}
	d.live = [];
}

function recordCall(d: ChatData, usage: Usage, now: number): void {
	const first = d.turn.firstTokenAt;
	const duration = typeof first === "number" ? now - first : undefined;
	const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
	d.call = {
		...(duration !== undefined && duration >= 250 && usage.output > 0 ? { tps: usage.output / (duration / 1000) } : {}),
		...(prompt > 0 ? { cacheRatio: usage.cacheRead / prompt } : {}),
	};
	if (duration !== undefined && usage.output > 0) {
		d.turn = { ...d.turn, outputTokens: d.turn.outputTokens + usage.output, generationMs: d.turn.generationMs + duration };
	}
}

// ---------------------------------------------------------------- subagents, asks, hidden tools

function provisionalProgress(args: JsonObject, now: number): SubagentProgress {
	return {
		taskId: "",
		description: typeof args.description === "string" ? args.description : "",
		subagentType: typeof args.subagent_type === "string" ? args.subagent_type : "general-purpose",
		background: args.run_in_background === true,
		conversationId: 0,
		status: "running",
		startedAt: now,
		toolCount: 0,
	};
}

function subagentRow(d: ChatData, callId: string, args: JsonObject, now: number): SubagentBlock {
	const row = d.subagentRows.get(callId);
	const existing = row === undefined ? undefined : d.blocks[row];
	if (existing?.kind === "subagent") return existing;
	const block: SubagentBlock = { kind: "subagent", id: newId("subagent"), version: 0, callId, progress: provisionalProgress(args, now) };
	d.subagentRows.set(callId, push(d, block));
	return block;
}

function recordProgress(d: ChatData, progress: SubagentProgress, callId?: string): void {
	// Tool slots can replay an older running value after the runner settled: keep the terminal one.
	const previous = d.subagents.get(progress.taskId);
	const current = progress.status === "running" && previous && previous.status !== "running" ? previous : progress;
	d.subagents.set(progress.taskId, current);
	bump(d);
	let row = d.subagentRowsByTask.get(progress.taskId);
	if (row === undefined && callId !== undefined) row = d.subagentRows.get(callId);
	if (row === undefined) return;
	const block = d.blocks[row];
	if (block?.kind !== "subagent") return;
	block.progress = current;
	touch(d, block);
	d.subagentRowsByTask.set(progress.taskId, row);
}

/** Asks carried by tool details: `ask`, `relayed` or `asks[]` (also inside codemode details). */
export function asksIn(details: unknown): AskView[] {
	if (!isObject(details)) return [];
	const out: AskView[] = [];
	for (const candidate of [details.ask, details.relayed, ...(Array.isArray(details.asks) ? details.asks : [])]) {
		if (!isObject(candidate)) continue;
		const c = candidate;
		if (typeof c.id !== "string" || (c.to !== "main" && c.to !== "human") || typeof c.question !== "string" || typeof c.state !== "string" || typeof c.default !== "string" || typeof c.deadlineAt !== "number") continue;
		const from = c.from;
		const label = isObject(from) ? String(from.taskId ?? from.conversationId ?? "") : String(from ?? "");
		const view: AskView = {
			id: c.id,
			to: c.to,
			kind: typeof c.kind === "string" ? c.kind : "",
			question: c.question,
			from: label,
			state: c.state,
			default: c.default,
			deadlineAt: c.deadlineAt,
		};
		if (typeof c.answer === "string") view.answer = c.answer;
		if (Array.isArray(c.options) && c.options.every((o) => typeof o === "string")) view.options = [...(c.options as string[])];
		out.push(view);
	}
	return out;
}

/** `[ask <id>] choice…` / `[ask <id>] answer…`: the person's reply to an ask (the daemon rewrites buttons to this text). */
const ASK_REPLY = /^\[ask ([^\]\s]+)\] (?:choice|answer)\b/;

/** The person replied: the ask waits only for the agent's `answer` call now, so stop offering it. */
function markAnswered(d: ChatData, text: string): void {
	const id = ASK_REPLY.exec(text)?.[1];
	if (!id || d.answeredAsks.has(id)) return;
	d.answeredAsks.add(id);
	const ask = d.asks.get(id);
	if (ask?.state === "open") d.asks.set(id, { ...ask, state: "answered" });
	bump(d);
}

function recordAsks(d: ChatData, details: unknown): void {
	for (const reported of asksIn(details)) {
		const ask = reported.state === "open" && d.answeredAsks.has(reported.id) ? { ...reported, state: "answered" } : reported;
		const previous = d.asks.get(ask.id);
		if (previous && JSON.stringify(previous) === JSON.stringify(ask)) continue;
		d.asks.set(ask.id, ask);
		bump(d);
	}
}

function applyHiddenDetails(d: ChatData, name: string, details: unknown, isError: boolean, callId?: string): void {
	recordAsks(d, details);
	if (name === "codemode") {
		if (isTodoDetails(details)) applyHiddenDetails(d, TODO_TOOL, details, false);
		if (isTaskDetails(details)) recordProgress(d, details.subagent, callId);
		if (isTaskOutputDetails(details)) for (const p of details.subagents) recordProgress(d, p);
		return;
	}
	if (name === TODO_TOOL) {
		if (!isError && isTodoDetails(details)) {
			d.todos = details.todos.map((t) => ({ ...t }));
			bump(d);
		}
		return;
	}
	if (name === TASK_TOOL && isTaskDetails(details)) recordProgress(d, details.subagent, callId);
	if ((name === TASK_OUTPUT_TOOL || name === KILL_TASK_TOOL || name === TASK_MESSAGE_TOOL) && isTaskOutputDetails(details)) {
		for (const p of details.subagents) recordProgress(d, p);
	}
}

function toolRow(d: ChatData, callId: string, name: string, args: JsonObject): ToolBlock {
	const row = d.toolRows.get(callId);
	const existing = row === undefined ? undefined : d.blocks[row];
	if (existing?.kind === "tool") return existing;
	const block: ToolBlock = { kind: "tool", id: newId("tool"), version: 0, callId, name, args, status: "pending", output: "" };
	d.toolRows.set(callId, push(d, block));
	return block;
}

// ---------------------------------------------------------------- assistant partials

function liveBlock(d: ChatData, contentIndex: number): Block | undefined {
	const row = d.live[contentIndex];
	return row === undefined || row < 0 ? undefined : d.blocks[row];
}

function placeLive(d: ChatData, contentIndex: number, block: Block): void {
	const row = d.live[contentIndex];
	const current = row === undefined || row < 0 ? undefined : d.blocks[row];
	if (current && current.kind === block.kind) return;
	if (current) removeAt(d, row as number);
	const index = push(d, block);
	while (d.live.length < contentIndex) d.live.push(-1);
	d.live[contentIndex] = index;
}

function bindLive(d: ChatData, contentIndex: number, row: number | undefined): void {
	if (row === undefined) return;
	while (d.live.length <= contentIndex) d.live.push(-1);
	d.live[contentIndex] = row;
}

function closeThinking(d: ChatData, contentIndex: number, now: number): void {
	for (let i = 0; i < Math.min(contentIndex, d.live.length); i++) {
		const block = liveBlock(d, i);
		if (block?.kind === "thinking" && block.streaming) {
			block.streaming = false;
			block.endedAt = now;
			touch(d, block);
		}
	}
}

function applyContentBlock(d: ChatData, contentIndex: number, content: AssistantMessage["content"][number], now: number, final: boolean): void {
	closeThinking(d, contentIndex, now);
	switch (content.type) {
		case "text": {
			let block = liveBlock(d, contentIndex);
			if (block?.kind !== "agent") {
				placeLive(d, contentIndex, { kind: "agent", id: newId("agent"), version: 0, text: "", at: now, streaming: true });
				block = liveBlock(d, contentIndex);
			}
			if (block?.kind !== "agent") return;
			if (block.text !== content.text || block.streaming === final) {
				block.text = content.text;
				block.streaming = !final;
				touch(d, block);
			}
			if (!final && content.text.trim() !== "") setPhase(d, "responding", now);
			return;
		}
		case "thinking": {
			let block = liveBlock(d, contentIndex);
			if (block?.kind !== "thinking") {
				placeLive(d, contentIndex, { kind: "thinking", id: newId("thinking"), version: 0, text: "", startedAt: now, streaming: true });
				block = liveBlock(d, contentIndex);
			}
			if (block?.kind !== "thinking") return;
			if (block.text !== content.thinking || block.streaming === final) {
				block.text = content.thinking;
				if (final) {
					block.streaming = false;
					block.endedAt ??= now;
				}
				touch(d, block);
			}
			if (!final) setPhase(d, "thinking", now);
			return;
		}
		case "toolCall": {
			const args = isObject(content.arguments) ? (content.arguments as JsonObject) : {};
			if (isHiddenTool(content.name)) {
				if (content.name === TASK_TOOL) {
					const block = subagentRow(d, content.id, args, now);
					bindLive(d, contentIndex, d.subagentRows.get(content.id));
					if (block.progress.description === "" && typeof args.description === "string") {
						block.progress = { ...block.progress, description: args.description };
						touch(d, block);
					}
				}
				return;
			}
			const existing = liveBlock(d, contentIndex);
			if (existing?.kind === "tool" && existing.callId === content.id) {
				if (JSON.stringify(existing.args) !== JSON.stringify(args)) {
					existing.args = args;
					touch(d, existing);
				}
				return;
			}
			const block = toolRow(d, content.id, content.name, args);
			bindLive(d, contentIndex, d.toolRows.get(content.id));
			if (JSON.stringify(block.args) !== JSON.stringify(args)) {
				block.args = args;
				touch(d, block);
			}
			return;
		}
	}
}

function applyChanges(d: ChatData, changes: readonly MessageChange[], now: number): void {
	for (const change of changes) {
		switch (change.type) {
			case "message":
				applyAssistant(d, change.message, now, false);
				break;
			case "text_start":
			case "thinking_start":
			case "toolcall_start":
			case "block":
				// A whole-block replacement is that block's settled form (the TUI treats it as final).
				applyContentBlock(d, change.contentIndex, change.block, now, change.type === "block");
				break;
			case "text_delta": {
				const block = liveBlock(d, change.contentIndex);
				if (block?.kind === "agent") {
					block.text += change.delta;
					touch(d, block);
				} else applyContentBlock(d, change.contentIndex, { type: "text", text: change.delta }, now, false);
				setPhase(d, "responding", now);
				break;
			}
			case "thinking_delta": {
				const block = liveBlock(d, change.contentIndex);
				if (block?.kind === "thinking") {
					block.text += change.delta;
					touch(d, block);
				} else applyContentBlock(d, change.contentIndex, { type: "thinking", thinking: change.delta }, now, false);
				setPhase(d, "thinking", now);
				break;
			}
			case "toolcall_delta":
				// Arguments arrive whole through `block` changes.
				break;
		}
	}
}

function applyAssistant(d: ChatData, message: AssistantMessage, now: number, final: boolean): void {
	message.content.forEach((content, index) => applyContentBlock(d, index, content, now, final));
	// Drop partial rows the message no longer has (highest index first so earlier rows keep their positions).
	const stale = d.live.slice(message.content.length).filter((row) => row >= 0).sort((a, b) => b - a);
	for (const row of stale) removeAt(d, row);
	d.live.length = Math.min(d.live.length, message.content.length);
	if (final) {
		let found = false;
		for (const content of message.content) {
			if (content.type === "text") found = recordArtifacts(d.artifacts, pathsInText(content.text), "mention", message.timestamp) || found;
			else if (content.type === "toolCall" && isObject(content.arguments)) found = recordArtifacts(d.artifacts, pathsInToolCall(content.name, content.arguments), "write", message.timestamp) || found;
		}
		if (found) bump(d);
		for (const row of d.live) {
			const block = d.blocks[row];
			if (block?.kind === "agent") {
				block.at = message.timestamp;
				block.streaming = false;
				touch(d, block);
			} else if (block?.kind === "thinking" && block.streaming) {
				block.streaming = false;
				block.endedAt = now;
				touch(d, block);
			}
		}
		d.live = [];
		const unconfigured = /^Provider is not configured: (.+)$/.exec(message.errorMessage ?? "");
		if (message.stopReason === "error" && unconfigured) notice(d, `${unconfigured[1]}에 아직 로그인하지 않았어요. /login으로 연결한 뒤 다시 보내 주세요.`, "info");
		else if (message.stopReason === "error") notice(d, message.errorMessage ?? "model error", "error");
		else if (message.stopReason === "aborted") notice(d, "멈췄어요.", "info");
		if (d.run) recordCall(d, message.usage, now);
	}
	if (message.usage && contextTokensOf(message.usage) > 0) setContextTokens(d, message.usage);
}

function setContextTokens(d: ChatData, usage: Usage | undefined): void {
	if (!usage) return;
	const context = contextTokensOf(usage);
	const sent = usage.input + usage.cacheRead + usage.cacheWrite;
	if (context === 0 || (context === d.usage.contextTokens && sent === d.usage.sent && usage.output === d.usage.output)) return;
	d.usage = { ...d.usage, contextTokens: context, sent, output: usage.output };
	bump(d);
}

// ---------------------------------------------------------------- entries

function isAbortedResult(entry: EntryRecord): boolean {
	const data = entry.data;
	return isObject(data) && Array.isArray(data.diagnostics) && data.diagnostics.some((item) => isObject(item) && item.code === "aborted" && item.severity === "error");
}

export function ingestEntry(d: ChatData, entry: EntryRecord, now: number): void {
	if (d.seenEntries.has(entry.id)) return;
	d.seenEntries.add(entry.id);
	const message = entry.model?.[0] as Message | undefined;
	switch (entry.kind) {
		case "pi.user":
			if (message?.role === "user") {
				const images = Array.isArray(message.content)
					? message.content.flatMap((p) => (p.type === "image" ? [{ mimeType: p.mimeType, data: p.data }] : []))
					: [];
				const text = userText(message);
				push(d, { kind: "user", id: newId("user"), version: 0, text, at: message.timestamp, ...(images.length > 0 ? { images } : {}) });
				markAnswered(d, text);
			}
			return;
		case "pi.assistant":
			if (message?.role === "assistant") applyAssistant(d, message, now, true);
			return;
		case "pi.tool-result":
			if (message?.role === "toolResult") ingestToolResult(d, message, now, isAbortedResult(entry));
			return;
		case "pi.reset":
			d.usage = { ...d.usage, contextTokens: 0, sent: 0, output: 0 };
			notice(d, "새 컨텍스트", "info");
			return;
		case "pi.compaction":
			// The old measurement describes the pre-compaction request, not the new context.
			d.usage = { ...d.usage, contextTokens: 0, sent: 0, output: 0 };
			notice(d, "컨텍스트를 압축했어요", "info");
			return;
		case "pi.system": {
			const sections = (message as { sections?: Record<string, string | null> } | undefined)?.sections;
			const text = sections?.[AGREEMENTS_SECTION];
			if (text === undefined) return;
			const count = text === null ? 0 : text.split("\n").filter((row) => row.startsWith("- [")).length;
			notice(d, count === 0 ? "적용 중인 작업 약속 없음" : `작업 약속 ${count}개 적용`, "info");
			return;
		}
		case MEMORY_NOTE_KIND: {
			const items = (entry.data as MemoryNoteData | undefined)?.items ?? [];
			notice(d, `기억 ${items.length}개를 떠올렸어요${items.length ? `: ${items.map((i) => i.key).join(", ")}` : ""}`, "info");
			return;
		}
		default:
			return;
	}
}

function ingestToolResult(d: ChatData, message: ToolResultMessage, now: number, cancelled: boolean): void {
	if (message.toolName === "codemode") applyHiddenDetails(d, message.toolName, message.details, message.isError, message.toolCallId);
	if (isHiddenTool(message.toolName)) {
		let details: unknown = message.details;
		if (message.toolName === TASK_TOOL && message.isError && isTaskDetails(details) && details.subagent.status === "running") {
			const authoritative = d.subagents.get(details.subagent.taskId);
			details = {
				subagent: authoritative && authoritative.status !== "running" ? authoritative : { ...details.subagent, status: "failed", endedAt: now, error: resultText(message) },
			};
		}
		applyHiddenDetails(d, message.toolName, details, message.isError, message.toolCallId);
		if (message.isError) {
			const text = resultText(message).replace(/<\/?harness>/g, "").trim();
			const aborted = cancelled || /^\[error\] Tool task was aborted$/.test(text);
			if (message.toolName === TASK_TOOL) {
				const row = d.subagentRows.get(message.toolCallId);
				const block = row === undefined ? undefined : d.blocks[row];
				if (block?.kind === "subagent" && block.progress.status === "running") {
					block.progress = aborted ? { ...block.progress, status: "cancelled", endedAt: now } : { ...block.progress, status: "failed", endedAt: now, error: text };
					if (block.progress.taskId) recordProgress(d, block.progress, message.toolCallId);
					else touch(d, block);
				}
			}
			if (!aborted) notice(d, text, "error");
		}
		if (d.run && (message.toolName === TASK_TOOL || message.toolName === TASK_OUTPUT_TOOL)) setPhase(d, "waiting_response", now);
		return;
	}
	const block = toolRow(d, message.toolCallId, message.toolName, {});
	block.status = cancelled ? "cancelled" : message.isError ? "error" : "done";
	block.result = resultText(message);
	if (!message.isError && recordArtifacts(d.artifacts, pathsInToolResult(message.toolName, block.result), "image", message.timestamp)) bump(d);
	if (message.details !== undefined) {
		block.details = message.details;
		recordAsks(d, message.details);
	}
	block.endedAt ??= now;
	touch(d, block);
	if (d.run?.tool === message.toolName) setPhase(d, "waiting_response", now);
}

// ---------------------------------------------------------------- snapshot and events

function setWorkflow(d: ChatData, workflow: WorkflowStatus | null): void {
	if (JSON.stringify(workflow) === JSON.stringify(d.workflow)) return;
	d.workflow = workflow;
	bump(d);
}
function setDag(d: ChatData, dag: DagView | null): void {
	if (JSON.stringify(dag) === JSON.stringify(d.dag)) return;
	d.dag = dag;
	bump(d);
}
function applyUsageLedger(d: ChatData, usage: UsageState | undefined): void {
	if (!usage) return;
	let total = 0;
	let cost = 0;
	for (const entry of Object.values(usage.models)) {
		total += entry.totalTokens;
		cost += entry.cost.total;
	}
	d.usage = { ...d.usage, totalTokens: total, cost };
	d.ledger = usage;
	bump(d);
}

function reduceSnapshot(d: ChatData, event: ClientSnapshotEvent, now: number): void {
	const fresh = createChatData();
	fresh.revision = d.revision;
	fresh.snapshots = d.snapshots + 1;
	Object.assign(d, fresh);
	setWorkflow(d, event.workflow ?? null);
	setDag(d, event.dag ?? null);
	for (const entry of event.entries) ingestEntry(d, entry, now);
	d.agent = { ...(event.agent?.model ? { model: event.agent.model } : {}), ...(event.agent?.cwd !== undefined ? { cwd: event.agent.cwd } : {}) };
	applyUsageLedger(d, event.usage);
	if (event.run) {
		d.run = { startedAt: now, phase: "waiting_response", phaseStartedAt: now, attached: true };
		if (event.generation?.message) {
			d.turn.firstTokenAt = null; // started before we attached: not timed
			applyAssistant(d, event.generation.message, now, false);
		}
		for (const slot of event.tools ?? []) {
			if (slot.status === "done") continue;
			if (isHiddenTool(slot.name)) {
				if (slot.name === TASK_TOOL) {
					subagentRow(d, slot.callId, {}, now);
					if (isTaskDetails(slot.details)) recordProgress(d, slot.details.subagent, slot.callId);
				}
				if (slot.status === "running") setPhase(d, "waiting_subagents", now, slot.name);
				continue;
			}
			if (slot.name === "codemode") applyHiddenDetails(d, slot.name, slot.details, false, slot.callId);
			const block = toolRow(d, slot.callId, slot.name, {});
			block.status = slot.status;
			block.output = slot.output ?? "";
			if (slot.details !== undefined) block.details = slot.details;
			touch(d, block);
			if (slot.status === "running") setPhase(d, "tool", now, slot.name);
		}
		if (event.generation?.retry) setPhase(d, "retry", now);
	}
	d.queue = event.queue ?? [];
	bump(d);
}

export function reduceEvent(d: ChatData, event: ClientEvent, now: number): void {
	switch (event.type) {
		case "snapshot":
			reduceSnapshot(d, event, now);
			return;
		case "workflow_status":
			setWorkflow(d, event.workflow);
			return;
		case "dag_status":
			setDag(d, event.dag);
			return;
		case "subagent_progress":
			for (const p of event.subagents) recordProgress(d, p, event.callId);
			return;
		case "queue_status":
			d.queue = event.items;
			bump(d);
			return;
		case "run_start":
			startRun(d, now);
			return;
		case "run_end":
			endRun(d, now);
			return;
		case "message_start":
			if (event.message.role === "assistant") {
				finishStreaming(d, now);
				d.turn.firstTokenAt = undefined;
				setPhase(d, "waiting_response", now);
				if (event.message.content.length > 0) {
					d.turn.firstTokenAt = now;
					applyAssistant(d, event.message, now, false);
				}
			}
			return;
		case "message_update":
			if (d.turn.firstTokenAt === undefined && event.changes.length > 0) d.turn.firstTokenAt = now;
			applyChanges(d, event.changes, now);
			setContextTokens(d, event.usage);
			return;
		case "message_end":
		case "entry_appended":
			ingestEntry(d, event.entry, now);
			return;
		case "tool_execution_start": {
			if (isHiddenTool(event.toolName)) {
				if (event.toolName === TASK_TOOL) subagentRow(d, event.toolCallId, event.args ?? {}, now);
				setPhase(d, event.toolName === TODO_TOOL ? "tool" : "waiting_subagents", now, event.toolName);
				return;
			}
			const block = toolRow(d, event.toolCallId, event.toolName, event.args ?? {});
			block.status = "running";
			block.startedAt = now;
			block.args = event.args ?? block.args;
			touch(d, block);
			setPhase(d, "tool", now, event.toolName);
			return;
		}
		case "tool_execution_update": {
			if (event.toolName === "codemode") applyHiddenDetails(d, event.toolName, event.details, false, event.toolCallId);
			if (isHiddenTool(event.toolName)) {
				if (event.details !== undefined) applyHiddenDetails(d, event.toolName, event.details, false, event.toolCallId);
				return;
			}
			const row = d.toolRows.get(event.toolCallId);
			const block = row === undefined ? undefined : d.blocks[row];
			if (block?.kind !== "tool") return;
			if (event.output) {
				if ("set" in event.output) block.output = event.output.set;
				else {
					if (event.output.trimStart) block.output = block.output.slice(event.output.trimStart);
					if (event.output.append) block.output += event.output.append;
				}
			}
			if (event.details !== undefined) block.details = event.details;
			touch(d, block);
			return;
		}
		case "tool_execution_end": {
			if (event.entry) ingestEntry(d, event.entry, now);
			else if (!isHiddenTool(event.toolName)) {
				const block = toolRow(d, event.toolCallId, event.toolName, {});
				block.status = "error";
				block.result ??= "tool task faulted";
				block.endedAt ??= now;
				touch(d, block);
			}
			if (d.run?.tool === event.toolName) setPhase(d, "waiting_response", now);
			return;
		}
		case "auto_retry_start":
			if (d.run) {
				d.run = { ...d.run, phase: "retry", phaseStartedAt: now, retry: `attempt ${event.attempt}: ${event.errorMessage}` };
				bump(d);
			}
			return;
		case "auto_retry_end":
			setPhase(d, "waiting_response", now);
			return;
		case "usage_changed":
			applyUsageLedger(d, event.usage);
			return;
		case "agent_changed":
			d.agent = { ...(event.agent.model ? { model: event.agent.model } : {}), ...(event.agent.cwd !== undefined ? { cwd: event.agent.cwd } : {}) };
			bump(d);
			return;
		case "task_failed":
			notice(d, `${event.kind} failed: ${event.message}`, "error");
			return;
		case "compaction_start":
			if (event.blocking) setPhase(d, "compacting", now);
			return;
		case "compaction_end":
			if (d.run?.phase === "compacting") setPhase(d, "waiting_response", now);
			return;
		default:
			return;
	}
}

/** Local notices (send failures, 409 ask notices) appended by the client itself. */
export function localNotice(d: ChatData, text: string, level: NoticeLevel = "info"): void {
	notice(d, text, level);
}

export const runningSubagents = (d: ChatData): SubagentProgress[] => [...d.subagents.values()].filter((p) => p.status === "running");

/** Open human asks whose deadline has not passed, oldest first. */
export const openHumanAsks = (d: ChatData, now: number): AskView[] =>
	[...d.asks.values()].filter((a) => a.to === "human" && a.state === "open" && a.deadlineAt > now).sort((a, b) => a.deadlineAt - b.deadlineAt);
