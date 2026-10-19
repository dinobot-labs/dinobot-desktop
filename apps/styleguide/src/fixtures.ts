import type { DagNodeState, DagNodeView, DagView, NodeKind, TodoItem } from "@dinobot/ui";

/** Fixtures modeled on the TUI's offline preview (script/qa/dag-design-preview.ts): same ids, titles and shape. */
function n(id: string, kind: NodeKind, title: string, level: number, parents: string[], state: DagNodeState, extra: Partial<DagNodeView> = {}): DagNodeView {
	return { id, kind, title, state, level, parents, directParents: parents, attempt: state === "pending" ? 0 : 1, maxAttempts: 3, covers: [], critical: false, ...extra };
}

export function runningView(t0: number): DagView {
	return {
		id: "run-7",
		revision: 0,
		status: "running",
		replanBudget: 8,
		requirements: [{ id: "ship", certified: false }],
		levels: 3,
		updatedAt: t0,
		nodes: [
			n("survey", "act", "SSE snapshot 경로 조사", 0, [], "succeeded", { startedAt: t0 - 900_000, endedAt: t0 - 896_000 }),
			n("tokens", "act", "Dinobot Signal 토큰 확인", 0, [], "succeeded", { startedAt: t0 - 900_000, endedAt: t0 - 896_000 }),
			n("q", "ask", "노드 라벨 표기 결정", 0, [], "waiting", { handle: "orchestrator", startedAt: t0 - 860_000 }),
			n("bot", "delegate", "DAG 투영과 SSE 스트림 구현", 1, ["survey"], "running", { handle: "sa-122869", startedAt: t0 - 873_000, critical: true }),
			n("docs", "act", "ADR 0032와 위키 정리", 1, ["survey", "tokens"], "pending", { attempt: 1, error: "lint failed" }),
			n("tui", "act", "상시 DAG 패널 렌더링", 1, ["tokens", "q"], "pending"),
			n("verify", "verify", "bun test와 화면 검증", 2, ["bot", "docs", "tui"], "pending", { directParents: ["bot", "docs", "tui"], covers: ["ship"] }),
		],
	};
}

export function blockedView(t0: number): DagView {
	const v = runningView(t0);
	return {
		...v,
		id: "run-blocked",
		status: "blocked",
		reason: "nodes failed: bot (attempt 3: retry budget exhausted); replan or cancel",
		nodes: v.nodes.map((node) => {
			if (node.id === "bot") return { ...node, state: "failed", attempt: 3, endedAt: t0 - 60_000, error: "API contract mismatch: snapshot.dag missing" };
			if (node.id === "verify") return node;
			return { ...node, state: "succeeded", error: undefined, startedAt: node.startedAt ?? t0 - 800_000, endedAt: (node.startedAt ?? t0 - 800_000) + 4_000 };
		}),
	};
}

export function largeView(t0: number): DagView {
	const nodes: DagNodeView[] = [];
	const sizes = [8, 8, 8, 6, 6, 3];
	const titles = ["스키마 조사", "UI 토큰 정리", "TUI 렌더 구현", "SSE 연결", "검증 시나리오", "배포 준비"];
	sizes.forEach((count, level) => {
		for (let i = 0; i < count; i++) {
			const id = `w${level + 1}n${i + 1}`;
			const parents = level === 0 ? [] : [`w${level}n${(i % sizes[level - 1]!) + 1}`, `w${level}n${((i + 3) % sizes[level - 1]!) + 1}`].filter((p, k, a) => a.indexOf(p) === k);
			let state: DagNodeState = "pending";
			if (level < 2) state = "succeeded";
			else if (level === 2) state = i < 2 ? "running" : i < 7 ? "succeeded" : "running";
			else if (level === 3) state = i < 3 ? "ready" : "pending";
			const kind: NodeKind = level === 4 ? "verify" : i % 4 === 3 ? "delegate" : "act";
			nodes.push(n(id, kind, `${titles[level]} ${i + 1}`, level, parents, state, state === "succeeded" ? { startedAt: t0 - 1_200_000, endedAt: t0 - 1_200_000 + 4000 + i * 900 } : state === "running" ? { startedAt: t0 - 776_000 + i * 4000 } : {}));
		}
	});
	return { id: "run-large", revision: 1, status: "running", replanBudget: 7, requirements: [{ id: "ship", certified: false }], levels: 6, nodes, updatedAt: t0 };
}

export const todos: TodoItem[] = [
	{ id: "1", content: "DAG 표현 리서치", status: "completed" },
	{ id: "2", content: "Signal Paper 토큰 이식", status: "completed" },
	{ id: "3", content: "Dino 마스코트 애니메이션", status: "in_progress" },
	{ id: "4", content: "DagGraph 컴포넌트", status: "pending" },
	{ id: "5", content: "Electron 셸", status: "cancelled" },
];
