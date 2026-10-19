import { cn } from "../../lib/cn.ts";
import { STATUS, StatusMark, TONE_TEXT } from "../status.tsx";
import { RUN_MARK, summarize } from "./display.ts";
import type { DagLive, DagView } from "./types.ts";

/** Title row: run mark + status · wave K/h · D/N done · reqs C/R [· rev X] [· reason] (TUI dagTitle). */
export function DagHeader({ view, live, className, children }: { view: DagView; live?: DagLive; className?: string; children?: React.ReactNode }) {
	const s = summarize(view, live);
	const mark = RUN_MARK[view.status];
	const parts = [
		s.wave !== null && view.levels > 0 ? `wave ${s.wave}/${s.levels}` : null,
		view.levels > 0 ? `${s.done}/${s.total} done` : null,
		s.requirements ? `reqs ${s.certified}/${s.requirements}` : null,
		view.revision > 0 ? `rev ${view.revision}` : null,
	].filter(Boolean);
	return (
		<div data-slot="dag-header" className={cn("flex min-w-0 items-center gap-2 text-xs", className)}>
			<span className="font-mono text-micro font-semibold tracking-[var(--tr-label)] text-fg">DAG</span>
			<span className={cn("inline-flex items-center gap-1 font-medium", TONE_TEXT[STATUS[mark].tone])}>
				<StatusMark kind={mark} size={13} />
				{view.status}
			</span>
			<span className="min-w-0 truncate text-fg-3 tabular-nums">
				{parts.join(" · ")}
				{(view.status === "blocked" || view.status === "cancelled") && view.reason ? <span className="text-fg-2"> · {view.reason}</span> : null}
			</span>
			{children ? <span className="ml-auto flex shrink-0 items-center gap-1">{children}</span> : null}
		</div>
	);
}
