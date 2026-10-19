import { describe, expect, test } from "bun:test";
import { closure, displayState, summarize } from "../src/components/dag/display.ts";
import { layoutDag } from "../src/components/dag/layout.ts";
import type { DagNodeState, DagNodeView, DagView } from "../src/components/dag/types.ts";

function node(id: string, level: number, parents: string[], state: DagNodeState = "pending", extra: Partial<DagNodeView> = {}): DagNodeView {
	return { id, kind: "act", title: id, state, level, parents, directParents: parents, attempt: 0, maxAttempts: 3, covers: [], critical: false, ...extra };
}
function view(nodes: DagNodeView[], status: DagView["status"] = "running"): DagView {
	return { id: "r", revision: 0, status, replanBudget: 8, requirements: [{ id: "q", certified: false }], levels: 1 + Math.max(...nodes.map((n) => n.level)), nodes, updatedAt: 0 };
}

// a diamond with a skip edge: a -> b, a -> c, b -> d, c -> d, a -> e(level 3) via skip, d -> e
const diamond = () =>
	view([node("a", 0, []), node("b", 1, ["a"]), node("c", 1, ["a"]), node("d", 2, ["b", "c"]), node("x", 1, []), node("e", 3, ["d", "x"])]);

describe("layoutDag", () => {
	for (const direction of ["LR", "TB"] as const) {
		test(`${direction}: every edge advances along the main axis and nodes never overlap`, () => {
			const l = layoutDag(diamond(), { direction });
			const main = (b: { x: number; y: number }) => (direction === "LR" ? b.x : b.y);
			for (const e of l.edges) {
				const pts = e.points.map(([x, y]) => (direction === "LR" ? x : y));
				for (let i = 1; i < pts.length; i++) expect(pts[i] as number).toBeGreaterThan(pts[i - 1] as number);
				expect(main(l.nodes[e.to] as { x: number; y: number })).toBeGreaterThan(main(l.nodes[e.from] as { x: number; y: number }));
			}
			const boxes = Object.values(l.nodes);
			for (let i = 0; i < boxes.length; i++)
				for (let j = i + 1; j < boxes.length; j++) {
					const a = boxes[i] as (typeof boxes)[number];
					const b = boxes[j] as (typeof boxes)[number];
					const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
					expect(apart).toBe(true);
				}
			expect(l.width).toBeGreaterThan(0);
			expect(l.height).toBeGreaterThan(0);
		});
	}

	test("a skip edge gets one waypoint per skipped layer", () => {
		const l = layoutDag(diamond());
		const skip = l.edges.find((e) => e.from === "x" && e.to === "e");
		expect(skip?.points.length).toBe(2 + 1);
	});

	test("state-only updates never move a node (layout depends on structure only)", () => {
		const before = layoutDag(diamond());
		const changed = diamond();
		changed.nodes = changed.nodes.map((n, i) => ({ ...n, state: (["running", "succeeded", "failed", "waiting", "skipped", "ready"] as const)[i % 6] as DagNodeState, attempt: 2, error: "x", startedAt: 1 }));
		const after = layoutDag(changed);
		expect(after.nodes).toEqual(before.nodes);
		expect(after.edges).toEqual(before.edges);
	});

	test("barycenter ordering removes avoidable crossings", () => {
		// b1 -> c2 and b2 -> c1 cross in display order; sweeping should uncross them.
		const v = view([node("b1", 0, []), node("b2", 0, []), node("c1", 1, ["b2"]), node("c2", 1, ["b1"])]);
		expect(layoutDag(v).crossings).toBe(0);
	});

	test("40 nodes lay out quickly and deterministically", () => {
		const nodes: DagNodeView[] = [];
		for (let l = 0; l < 6; l++) for (let i = 0; i < 7; i++) if (nodes.length < 40) nodes.push(node(`w${l}n${i}`, l, l ? [`w${l - 1}n${i}`, `w${l - 1}n${(i + 3) % 7}`] : []));
		const t0 = performance.now();
		const a = layoutDag(view(nodes));
		const ms = performance.now() - t0;
		expect(layoutDag(view(nodes))).toEqual(a);
		expect(ms).toBeLessThan(50);
	});
});

describe("displayState (TUI parity)", () => {
	test("maps node and run states like src/tui/panes/dag.ts", () => {
		expect(displayState(node("a", 0, [], "running"), "running")).toBe("running");
		expect(displayState(node("a", 0, [], "running", { handle: "sa-1" }), "running", { settledHandles: new Set(["sa-1"]) })).toBe("settling");
		expect(displayState(node("a", 0, [], "running"), "cancelled")).toBe("lastseen");
		expect(displayState(node("a", 0, [], "waiting"), "blocked")).toBe("lastseen");
		expect(displayState(node("a", 0, [], "pending", { attempt: 1, error: "lint" }), "running")).toBe("retry");
		expect(displayState(node("a", 0, [], "ready"), "running")).toBe("ready");
		expect(displayState(node("a", 0, [], "succeeded"), "running")).toBe("done");
		expect(displayState(node("a", 0, [], "skipped"), "cancelled")).toBe("skipped");
	});
	test("summary counts every node once and finds the current wave", () => {
		const v = diamond();
		v.nodes[0] = { ...(v.nodes[0] as DagNodeView), state: "succeeded" };
		v.nodes[1] = { ...(v.nodes[1] as DagNodeView), state: "running" };
		const s = summarize(v);
		expect(Object.values(s.counts).reduce((a, b) => a + (b ?? 0), 0)).toBe(v.nodes.length);
		expect(s.done).toBe(1);
		expect(s.wave).toBe(2);
	});
	test("closure is the upstream and downstream set", () => {
		expect([...closure(diamond(), "b")].sort()).toEqual(["a", "b", "d", "e"]);
	});
});
