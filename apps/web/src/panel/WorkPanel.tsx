import type { SubagentProgress, WorkflowStatus } from "@dinobot/contracts";
import { Badge, cn, DagCounts, DagGraph, DagHeader, DagRail, Dino, Shimmer, STATUS, StatusMark, type StatusKind, statusTextClass, Tabs, TabsList, TabsTab, TodoList } from "@dinobot/ui";
import { IconRobot } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useUi } from "../state/ui.ts";
import { ResearchCard } from "./Research.tsx";
import { BrowserPanel } from "./BrowserPanel.tsx";
import { ArtifactsPanel, useArtifacts, usePanelTab } from "./Artifacts.tsx";
import { formatElapsed, useNow, useSession } from "../lib/hooks.ts";
import { useSettings } from "../lib/settings.ts";
import { openSubagent, sessionFor } from "../state/app.ts";

const SUB: Record<string, StatusKind> = { running: "running", completed: "done", failed: "failed", cancelled: "skipped" };
const PLAN: Record<string, StatusKind> = { met: "done", pending: "pending", stale: "retry", running: "running", cancelled: "skipped", unknown: "lastseen", failed: "failed" };
const WORKFLOW: Record<WorkflowStatus["status"], string> = {
	informational: "정보 요청",
	planning: "계획 중",
	implementing: "구현 중",
	verifying: "검증 중",
	verified: "검증 완료",
	blocked: "막힘",
	cancelled: "취소됨",
};

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<h3 className="font-mono text-micro uppercase tracking-[var(--tr-label)] text-fg-3">{title}</h3>
				<span className="flex-1" />
				{aside}
			</div>
			{children}
		</section>
	);
}

function SubagentList({ list, now }: { list: SubagentProgress[]; now: number }) {
	return (
		<div className="flex flex-col gap-1">
			{list.map((p) => {
				const kind = SUB[p.status] ?? "pending";
				return (
					<button
						key={p.taskId}
						type="button"
						data-testid="subagent-row"
						disabled={p.conversationId <= 0}
						onClick={() => openSubagent(p.conversationId, p.description || p.taskId)}
						className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-hover disabled:cursor-default"
					>
						<StatusMark kind={kind} size={13} />
						<IconRobot size={13} className="shrink-0 text-fg-3" />
						<span className="min-w-0 flex-1 truncate text-fg">{p.status === "running" && p.currentTool ? <Shimmer>{p.description}</Shimmer> : p.description}</span>
						<span className={cn("shrink-0 font-mono text-micro", statusTextClass(kind))}>{p.status === "running" ? formatElapsed(now - p.startedAt) : STATUS[kind].label}</span>
					</button>
				);
			})}
		</div>
	);
}

const CHECK_WORD: Record<string, string> = { met: "통과", pending: "실행 전", stale: "다시 실행", running: "실행 중", cancelled: "취소", unknown: "모름", failed: "실패" };

/** Plan tab (TUI T166/T168): requirement tree with each check's state, and the workflow grammar line. */
function Workflow({ workflow }: { workflow: WorkflowStatus }) {
	const plan = workflow.plan;
	const met = plan?.checks.filter((c) => c.state === "met").length ?? 0;
	const tail = workflow.status === "verified" ? "검증됨" : plan && met === plan.checks.length && !workflow.certificate ? "work_finish 대기" : workflow.blockers[0] ?? "아직 검증 안 됨";
	return (
		<div className="flex flex-col gap-1.5" data-testid="plan">
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<Badge variant={workflow.status === "verified" ? "success" : workflow.status === "blocked" ? "failed" : workflow.status === "cancelled" ? "neutral" : "running"}>{WORKFLOW[workflow.status]}</Badge>
				{plan ? <span className="text-xs text-fg-3">검사 {met}/{plan.checks.length} 통과 · {tail}</span> : null}
			</div>
			{plan?.requirements.map((r) => (
				<div key={r.id} className="flex flex-col gap-0.5">
					<div className="flex min-w-0 items-start gap-2 text-xs">
						<StatusMark kind={PLAN[r.state] ?? "pending"} size={12} className="mt-0.5" />
						<span className="shrink-0 font-mono text-fg-3">{r.id}</span>
						<span className="min-w-0 text-fg-2">{r.assertion}</span>
					</div>
					{r.checkIds.map((id) => {
						const c = plan.checks.find((x) => x.id === id);
						if (!c) return null;
						return (
							<div key={id} className="flex min-w-0 items-start gap-2 pl-5 text-micro">
								<StatusMark kind={PLAN[c.state] ?? "pending"} size={11} className="mt-px" />
								<span className="shrink-0 font-mono text-fg-3">{c.id}</span>
								<span className="shrink-0 text-fg-3">{CHECK_WORD[c.state] ?? c.state}</span>
								<span className="min-w-0 truncate text-fg-3">{c.expected}</span>
							</div>
						);
					})}
				</div>
			))}
			{workflow.blockers.length ? <div className="text-xs text-status-failed-fg">{workflow.blockers.join(" · ")}</div> : null}
		</div>
	);
}

/** The right work panel: DAG (rail or graph), todos, subagents, the verification workflow and thread facts. */
export function WorkPanel({ threadKey }: { threadKey: string }) {
	const session = useMemo(() => sessionFor(threadKey), [threadKey]);
	useSession(session);
	const d = session.side;
	const dagView = useSettings((s) => s.dagLayout);
	const width = useSettings((s) => s.panelWidth);
	const setSettings = useSettings((s) => s.set);
	const subagents = [...d.subagents].sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.startedAt - a.startedAt);
	const now = useNow(Boolean(d.run) || subagents.some((s) => s.status === "running"), 1000);
	const live = { now };
	const showWorkflow = Boolean(d.workflow && (d.workflow.plan || ["implementing", "verifying", "verified", "blocked"].includes(d.workflow.status)));
	const empty = !d.dag && !d.todos.length && !subagents.length && !showWorkflow;
	const [hideDone, setHideDone] = useState(false);
	const tab = usePanelTab((s) => s.tab);
	const setTab = usePanelTab((s) => s.set);
	const artifacts = useArtifacts(d.artifacts, d.lastTurnMs);
	const openNode = (id: string) => {
		const node = d.dag?.nodes.find((n) => n.id === id);
		const sub = node?.handle?.startsWith("sa-") ? d.subagents.find((s) => s.taskId === node.handle) : undefined;
		if (sub && sub.conversationId > 0) openSubagent(sub.conversationId, sub.description || sub.taskId);
	};
	return (
		<aside className="relative flex shrink-0 flex-col border-l border-line bg-surface" style={{ width }} aria-label="작업 패널" data-testid="work-panel">
			<div
				role="separator"
				aria-orientation="vertical"
				className="absolute z-10 -ml-1 h-full w-2 cursor-col-resize"
				onPointerDown={(e) => {
					const startX = e.clientX;
					const start = width;
					const move = (ev: PointerEvent) => setSettings({ panelWidth: Math.max(300, Math.min(720, start - (ev.clientX - startX))) });
					const up = () => {
						window.removeEventListener("pointermove", move);
						window.removeEventListener("pointerup", up);
					};
					window.addEventListener("pointermove", move);
					window.addEventListener("pointerup", up);
				}}
			/>
			<div className="flex shrink-0 items-center border-b border-line px-3 py-1.5">
				<Tabs value={tab} onValueChange={(v) => setTab(v as "work" | "artifacts" | "browser")}>
					<TabsList className="h-7">
						<TabsTab value="work" className="h-6 px-2 text-xs">작업</TabsTab>
						<TabsTab value="artifacts" className="h-6 px-2 text-xs" data-testid="artifacts-tab">
							아티팩트{artifacts.items.length ? <span className="font-mono text-micro text-fg-3">{artifacts.items.length}</span> : null}
						</TabsTab>
						<TabsTab value="browser" className="h-6 px-2 text-xs" data-testid="browser-tab">브라우저</TabsTab>
					</TabsList>
				</Tabs>
			</div>
			{tab === "artifacts" ? <ArtifactsPanel list={artifacts} running={Boolean(d.run)} /> : null}
			{tab === "browser" ? <BrowserPanel /> : null}
			<div className={cn("flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3", tab !== "work" && "hidden")}>
				{empty ? (
					<div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
						<Dino state={d.run ? "running" : "idle"} size={90} />
						<div className="text-sm text-fg-3">작업이 시작되면 계획과 진행 상황이 여기에 나타나요.</div>
					</div>
				) : null}
				{d.dag ? (
					<Section
						title="DAG"
						aside={
							<Tabs value={dagView} onValueChange={(v) => setSettings({ dagLayout: v as "rail" | "graph" })}>
								<TabsList className="h-6">
									<TabsTab value="rail" className="h-5 px-2 text-xs">목록</TabsTab>
									<TabsTab value="graph" className="h-5 px-2 text-xs">그래프</TabsTab>
								</TabsList>
							</Tabs>
						}
					>
						<DagHeader view={d.dag} live={live} />
						<DagCounts view={d.dag} live={live} />
						{d.dag.diagnostics?.length ? <div className="text-xs text-status-failed-fg">{d.dag.diagnostics.join("\n")}</div> : null}
						{d.dag.research ? <ResearchCard research={d.dag.research} threadKey={threadKey} compact /> : null}
						{dagView === "graph" ? <DagGraph view={d.dag} live={live} onSelect={openNode} className="max-h-[480px]" /> : <DagRail view={d.dag} live={live} onSelect={openNode} collapseDone />}
						<button type="button" onClick={() => useUi.setState({ dagOpen: true })} className="self-start cursor-pointer text-xs text-accent-deep hover:underline">
							전체 보기
						</button>
					</Section>
				) : null}
				{d.todos.length ? (
					<Section title="Todo" aside={<label className="flex cursor-pointer items-center gap-1 text-micro text-fg-3"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> 끝난 일 숨기기</label>}>
						<TodoList todos={hideDone ? d.todos.filter((t) => t.status !== "completed" && t.status !== "cancelled") : d.todos} className="[&>div:first-child]:hidden" />
					</Section>
				) : null}
				{subagents.length ? (
					<Section title={`서브에이전트 ${subagents.filter((s) => s.status === "running").length}/${subagents.length}`}>
						<SubagentList list={subagents} now={now} />
					</Section>
				) : null}
				{d.workflow && showWorkflow ? (
					<Section title="검증">
						<Workflow workflow={d.workflow} />
					</Section>
				) : null}
			</div>
			<div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-3 py-2 font-mono text-micro text-fg-3">
				{d.agent.model ? <span>{d.agent.model.modelId}</span> : null}
				{d.usage.contextTokens ? <span>context {(d.usage.contextTokens / 1000).toFixed(1)}k</span> : null}
				{d.usage.totalTokens ? <span>total {(d.usage.totalTokens / 1000).toFixed(0)}k</span> : null}
				{d.usage.cost ? <span>${d.usage.cost.toFixed(2)}</span> : null}
			</div>
		</aside>
	);
}
