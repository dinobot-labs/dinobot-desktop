/**
 * Messages between the UI thread and the stream worker (chat/worker.ts). The worker owns every network stream, every
 * JSON.parse and the reducer, so a multi-megabyte snapshot or a firehose of deltas never blocks the UI thread. The UI
 * receives at most one coalesced patch per frame: the ids of the visible window, the blocks whose version changed
 * (large tool output trimmed), and the side state for the panels.
 */
import type { AgentInfo, Block, RunState } from "./model.ts";
import type { ArtifactCandidate } from "./artifacts.ts";
import type { AskView, DagView, QueuedInput, SubagentProgress, TodoItem, UsageState, WorkflowStatus } from "@dinobot/contracts";
import type { StreamStatus } from "../lib/api.ts";

/** A block as the UI sees it; long tool output is cut and can be fetched whole with `full`. */
export type BlockView = Block & { cut?: { field: "output" | "result"; length: number } };

export interface SideState {
	run: RunState | undefined;
	lastTurnMs: number | undefined;
	todos: TodoItem[];
	subagents: SubagentProgress[];
	asks: AskView[];
	queue: QueuedInput[];
	workflow: WorkflowStatus | null;
	dag: DagView | null;
	agent: AgentInfo;
	usage: { contextTokens: number; sent: number; output: number; totalTokens: number; cost: number };
	ledger: UsageState;
	call: { tps?: number; cacheRatio?: number };
	snapshots: number;
	/** All blocks in the thread (the window shows the last `order.length`). */
	total: number;
	firstUserText: string | undefined;
	lastAgentText: string | undefined;
	/** HTML pages and images named in the thread, newest first; the panel checks which exist. */
	artifacts: ArtifactCandidate[];
}

export type ToWorker =
	| { type: "init"; base: string }
	| { type: "open"; key: string; path: string }
	| { type: "close"; key: string }
	| { type: "more"; key: string }
	| { type: "notice"; key: string; text: string; level: "info" | "error" }
	| { type: "full"; key: string; id: string; request: number };

export type FromWorker =
	| { type: "patch"; key: string; order?: string[]; blocks?: BlockView[]; side?: SideState; status?: StreamStatus; events?: ("snapshot" | "run_end" | "run_start")[] }
	| { type: "full"; key: string; request: number; text: string };

export const WINDOW_STEP = 200;
export const CUT_AT = 24_000;
