import type { SubagentProgress } from "@dinobot/contracts";
import { Badge, Button, DagHeader, DagRail, Dialog, DialogPopup, formatClock, formatTokens } from "@dinobot/ui";
import { IconArrowLeft } from "@tabler/icons-react";
import { useEffect, useMemo } from "react";
import { ChatSession } from "../chat/session.ts";
import { StatusLine } from "../chat/StatusLine.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { ignoreStackedPress } from "../lib/dismiss.ts";
import { useNow, useSession } from "../lib/hooks.ts";
import { backSubagent, closeSubagent, sessionFor, useApp } from "../state/app.ts";

const WORKFLOW: Record<string, string> = { planning: "계획 중", implementing: "구현 중", verifying: "검증 중", verified: "검증 완료", blocked: "막힘", cancelled: "취소됨" };

function Details({ p }: { p: SubagentProgress }) {
	const now = useNow(p.status === "running", 1000);
	return (
		<div className="flex flex-col gap-1 rounded-lg border border-line bg-sunken px-3 py-2 text-xs text-fg-2" data-testid="subagent-details">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<Badge variant={p.status === "running" ? "running" : p.status === "completed" ? "success" : p.status === "failed" ? "failed" : "neutral"}>{p.status}</Badge>
				<span>{p.subagentType}</span>
				<span>{p.background ? "백그라운드" : "포그라운드"}</span>
				<span>도구 {p.toolCount}개</span>
				{p.tokens ? <span>출력 {formatTokens(p.tokens)} 토큰</span> : null}
				<span>{formatClock((p.endedAt ?? now) - p.startedAt)}</span>
				{p.workflow && p.workflow.status !== "informational" ? <span>검증: {WORKFLOW[p.workflow.status] ?? p.workflow.status}</span> : null}
			</div>
			{p.status === "running" && p.currentTool ? <div>지금: <span className="font-mono">{p.currentTool}</span></div> : null}
			{p.lastText ? <div className="line-clamp-2">최근: {p.lastText}</div> : null}
			{p.error ? <div className="text-status-failed-fg">오류: {p.error}</div> : null}
		</div>
	);
}

function SubagentView({ conversationId }: { conversationId: number }) {
	const session = useMemo(() => ChatSession.forConversation(conversationId), [conversationId]);
	useSession(session);
	const activeKey = useApp((s) => s.activeKey);
	const parent = useMemo(() => (activeKey ? sessionFor(activeKey) : undefined), [activeKey]);
	useSession(parent);
	const now = useNow(Boolean(session.side.dag), 1000);
	useEffect(() => {
		session.start();
		return () => session.stop();
	}, [session]);
	const progress = parent?.side.subagents.find((s) => s.conversationId === conversationId);
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2">
			<div className="flex flex-col gap-2 px-5">
				{progress ? <Details p={progress} /> : null}
				{session.side.dag ? (
					<div className="rounded-lg border border-line bg-surface p-2">
						<DagHeader view={session.side.dag} live={{ now }} />
						<DagRail view={session.side.dag} live={{ now }} collapseDone className="mt-1 max-h-48 overflow-auto" />
					</div>
				) : null}
			</div>
			<Transcript session={session} keyboard={false} />
			<div className="px-6 pb-3">
				<StatusLine run={session.side.run} side={session.side} onStop={() => {}} readOnly />
			</div>
		</div>
	);
}

/** A subagent's own transcript (TUI takeover), read-only, with its details and its own DAG; nested views stack. */
export function SubagentSheet() {
	const view = useApp((s) => s.subagentView);
	const back = useApp((s) => s.subagentBack);
	useEffect(() => {
		if (!view) return;
		const onKey = (e: KeyboardEvent) => {
			if ((e.altKey && e.key === "ArrowLeft") || (e.key === "Backspace" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement))) {
				if (useApp.getState().subagentBack.length) {
					e.preventDefault();
					backSubagent();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [view]);
	return (
		<Dialog
			open={Boolean(view)}
			onOpenChange={(o, details) => {
				if (!o && ignoreStackedPress(details)) return;
				if (!o) closeSubagent();
			}}
		>
			<DialogPopup
				side="right"
				className="w-[min(94vw,760px)]"
				heading={
					<span className="flex items-center gap-2">
						{back.length ? (
							<Button size="icon-xs" variant="ghost" aria-label="뒤로" onClick={backSubagent}>
								<IconArrowLeft />
							</Button>
						) : null}
						<span className="truncate">{view?.title}</span>
					</span>
				}
				description={view ? `서브에이전트 대화 #${view.conversationId}${back.length ? ` · ${back.map((b) => b.title).join(" › ")} ›` : ""}` : undefined}
				data-testid="subagent-sheet"
			>
				{view ? <SubagentView key={view.conversationId} conversationId={view.conversationId} /> : null}
			</DialogPopup>
		</Dialog>
	);
}
