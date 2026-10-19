import type { StatusKind } from "../status.tsx";
import type { DagLive, DagNodeView, DagView, RunStatus } from "./types.ts";

/**
 * Display state of a node, the TUI's displayState (src/tui/panes/dag.ts:31) ported 1:1:
 *   running/waiting in a run that is no longer running -> lastseen (frozen)
 *   running/waiting whose bound subagent already settled -> settling (awaiting dag_step)
 *   pending/ready with a failed earlier attempt -> retry
 */
export type DagDisplayState = "running" | "settling" | "waiting" | "ready" | "retry" | "pending" | "done" | "failed" | "skipped" | "lastseen";

export function displayState(node: DagNodeView, run: RunStatus, live: DagLive = {}): DagDisplayState {
	switch (node.state) {
		case "running":
		case "waiting": {
			if (run !== "running") return "lastseen";
			if (node.handle && live.settledHandles?.has(node.handle)) return "settling";
			return node.state;
		}
		case "pending":
		case "ready":
			if (node.attempt > 0 && node.error) return "retry";
			return node.state;
		case "succeeded":
			return "done";
		case "failed":
			return "failed";
		case "skipped":
			return "skipped";
	}
}

/** Display state -> design-system status mark (components/status.tsx). */
export const DISPLAY_MARK: Readonly<Record<DagDisplayState, StatusKind>> = {
	running: "running",
	settling: "settling",
	waiting: "waiting",
	ready: "ready",
	retry: "retry",
	pending: "pending",
	done: "done",
	failed: "failed",
	skipped: "skipped",
	lastseen: "lastseen",
};

export const RUN_MARK: Readonly<Record<RunStatus, StatusKind>> = {
	compiling: "compiling",
	running: "ready",
	verified: "verified",
	blocked: "blocked",
	cancelled: "cancelled",
};

/** Urgency order for summaries (TUI COUNT_ORDER). */
export const COUNT_ORDER: readonly DagDisplayState[] = ["running", "settling", "waiting", "failed", "retry", "ready", "lastseen", "done", "pending", "skipped"];

export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
	const h = Math.floor(m / 60);
	return `${h}h${String(m % 60).padStart(2, "0")}m`;
}

/** The right-hand meta text of a node row (TUI meta table, condensed). */
export function nodeMeta(node: DagNodeView, state: DagDisplayState, live: DagLive = {}): string {
	const now = live.now ?? Date.now();
	switch (state) {
		case "running": {
			const elapsed = node.startedAt ? formatDuration(now - node.startedAt) : "";
			const activity = live.activity?.[node.id];
			return [activity, elapsed].filter(Boolean).join(" · ");
		}
		case "settling":
			return "awaiting dag_step";
		case "waiting":
			return "answer needed";
		case "lastseen":
			return node.startedAt ? `last seen · ${formatDuration(now - node.startedAt)}` : "last seen";
		case "retry":
			return `attempt ${node.attempt}/${node.maxAttempts} failed${node.error ? `: ${node.error}` : ""}`;
		case "failed":
			return node.error ?? "failed";
		case "done":
			return node.startedAt && node.endedAt ? formatDuration(node.endedAt - node.startedAt) : "";
		default:
			return "";
	}
}

export interface DagSummary {
	done: number;
	total: number;
	/** 1-based current wave (lowest unfinished level + 1), or null when all done. */
	wave: number | null;
	levels: number;
	certified: number;
	requirements: number;
	counts: Partial<Record<DagDisplayState, number>>;
}

export function summarize(view: DagView, live: DagLive = {}): DagSummary {
	const counts: Partial<Record<DagDisplayState, number>> = {};
	let lowest = Number.POSITIVE_INFINITY;
	for (const n of view.nodes) {
		const s = displayState(n, view.status, live);
		counts[s] = (counts[s] ?? 0) + 1;
		if (s !== "done" && s !== "skipped") lowest = Math.min(lowest, n.level);
	}
	return {
		done: counts.done ?? 0,
		total: view.nodes.length,
		wave: Number.isFinite(lowest) ? lowest + 1 : null,
		levels: view.levels,
		certified: view.requirements.filter((r) => r.certified).length,
		requirements: view.requirements.length,
		counts,
	};
}

/** Upstream and downstream closure of a node, over directParents. */
export function closure(view: DagView, id: string): Set<string> {
	const parents = new Map(view.nodes.map((n) => [n.id, n.directParents]));
	const children = new Map<string, string[]>();
	for (const n of view.nodes) for (const p of n.directParents) children.set(p, [...(children.get(p) ?? []), n.id]);
	const out = new Set<string>([id]);
	const walk = (start: string, next: (v: string) => readonly string[]) => {
		const stack = [start];
		while (stack.length) {
			const v = stack.pop() as string;
			for (const w of next(v)) if (!out.has(w)) {
				out.add(w);
				stack.push(w);
			}
		}
	};
	walk(id, (v) => parents.get(v) ?? []);
	walk(id, (v) => children.get(v) ?? []);
	return out;
}
