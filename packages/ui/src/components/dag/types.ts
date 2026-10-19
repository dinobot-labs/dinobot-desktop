/**
 * The DAG projection the daemon streams (dinobot src/core/ui-contract.ts DagView / DagNodeView, src/core/plan.ts
 * NodeKind, src/core/dag.ts RunStatus) at commit 2c77e16. Mirrored, not imported: the desktop talks to the daemon
 * over HTTP/SSE (snapshot.dag, dag_status events). See docs/research/dinobot-dag-model.md.
 */
export type NodeKind = "act" | "delegate" | "verify" | "ask" | "expand";
export type DagNodeState = "pending" | "ready" | "running" | "waiting" | "succeeded" | "failed" | "skipped";
export type RunStatus = "compiling" | "running" | "verified" | "blocked" | "cancelled";

export interface DagNodeView {
	id: string;
	kind: NodeKind;
	/** First line of the description, <= 120 columns, "" when none. */
	title: string;
	/** "ready" = pending and in the executor frontier. */
	state: DagNodeState;
	/** 0-based longest-path depth. */
	level: number;
	/** Transitive reduction of the parents, display order. */
	parents: string[];
	/** Every compiled parent, display order. */
	directParents: string[];
	attempt: number;
	maxAttempts: number;
	/** "sa-..." subagent, "orchestrator" for asks, "check:<id>". */
	handle?: string;
	startedAt?: number;
	endedAt?: number;
	error?: string;
	result?: string;
	covers: string[];
	critical: boolean;
}

export interface DagView {
	id: string;
	revision: number;
	status: RunStatus;
	reason?: string;
	replanBudget: number;
	requirements: { id: string; certified: boolean }[];
	/** 0 when the plan did not compile. */
	levels: number;
	/** Display order: (level, compiled Kahn index). */
	nodes: DagNodeView[];
	diagnostics?: string[];
	updatedAt: number;
}

/** Live inputs that are not part of DagView (TUI DagLive): which bound subagents already settled, and activity text. */
export interface DagLive {
	settledHandles?: ReadonlySet<string>;
	activity?: Readonly<Record<string, string>>;
	now?: number;
}
