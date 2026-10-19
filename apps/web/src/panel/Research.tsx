import type { ResearchView } from "@dinobot/contracts";
import { Badge, Button, Dialog, DialogPopup, formatClock } from "@dinobot/ui";
import { IconFileText, IconFlask } from "@tabler/icons-react";
import { useState } from "react";
import { Markdown } from "../chat/Markdown.tsx";
import { api } from "../lib/api.ts";
import { useNow } from "../lib/hooks.ts";

// Mission text comes from the model: strip control characters before showing it (TUI slash.ts sanitize).
const clean = (s: string | undefined) => (s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

/** Research mission summary (TUI DAG pane research lines + /dag research rows): status, budgets, best candidate, report. */
export function ResearchCard({ research: r, threadKey, compact = false }: { research: ResearchView; threadKey: string; compact?: boolean }) {
	const now = useNow(true, 5000);
	const [report, setReport] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const best = r.candidates.find((c) => c.id === (r.selectedId ?? r.incumbentId));
	const bad = r.candidates.filter((c) => c.validity && c.validity !== "valid").length;
	const left = r.deadlineAt - now;
	return (
		<div className="rounded-lg border border-line bg-surface p-3 text-sm" data-testid="research-card">
			<div className="flex items-center gap-2">
				<IconFlask size={15} className="text-fg-3" />
				<span className="font-medium text-fg">연구</span>
				<Badge variant={r.status === "running" ? "running" : r.status === "completed" ? "success" : "neutral"}>{clean(r.status)}</Badge>
				{r.judgment ? <span className="truncate text-xs text-fg-2">{clean(r.judgment)}</span> : null}
				<span className="flex-1" />
				{r.report.state !== "absent" ? (
					<Button
						size="xs"
						variant="ghost"
						onClick={() => {
							setOpen(true);
							if (report === null) void api.researchReport(threadKey, r.id).then((x) => setReport(x.content)).catch((e: unknown) => setReport(`보고서를 읽지 못했어요: ${e instanceof Error ? e.message : String(e)}`));
						}}
					>
						<IconFileText /> 보고서
					</Button>
				) : null}
			</div>
			<div className="mt-1 line-clamp-2 text-fg-2">{clean(r.question)}</div>
			{!compact ? (
				<div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-micro text-fg-3">
					<span>
						시도 {r.attempts.used}/{r.attempts.limit}
					</span>
					<span>
						라운드 {r.rounds.used}/{r.rounds.limit}
					</span>
					<span>
						후보 {r.candidateBudget.used}/{r.candidateBudget.limit}
					</span>
					<span>진행 중 {r.activeAttempts}</span>
					{left > 0 ? <span>남은 시간 {formatClock(left)}</span> : null}
					{r.stopReason ? <span>멈춘 이유 {clean(r.stopReason)}</span> : null}
				</div>
			) : null}
			<div className="mt-1 text-xs text-fg-2">
				최고 후보: {best ? `${clean(best.hypothesis)}${best.value !== undefined ? ` · ${best.value}${best.unit ?? ""}` : ""}` : "아직 비교할 결과가 없어요"}
				{bad ? <span className="text-fg-3"> · 무효·불확실 {bad}</span> : null}
			</div>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogPopup className="w-[min(92vw,860px)]" heading="연구 보고서" description={r.report.directory}>
					<div className="min-h-0 overflow-y-auto px-5 pb-5">{report === null ? <div className="text-sm text-fg-3">불러오는 중…</div> : <Markdown text={report} />}</div>
				</DialogPopup>
			</Dialog>
		</div>
	);
}
