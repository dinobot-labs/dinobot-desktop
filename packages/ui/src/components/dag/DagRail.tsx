import { cn } from "../../lib/cn.ts";
import { Shimmer } from "../shimmer.tsx";
import { STATUS, StatusMark, TONE_TEXT } from "../status.tsx";
import { COUNT_ORDER, type DagDisplayState, DISPLAY_MARK, displayState, nodeMeta } from "./display.ts";
import { KindIcon } from "./kind-icon.tsx";
import type { DagLive, DagNodeView, DagView } from "./types.ts";

/** Wave number color: green all done, amber anything moving, coral any failure, indigo waiting, gray otherwise (TUI waveStyle). */
function waveTone(states: DagDisplayState[]): string {
	if (states.every((s) => s === "done" || s === "skipped")) return "text-status-success-fg";
	if (states.some((s) => s === "failed")) return "text-status-failed-fg";
	if (states.some((s) => s === "running" || s === "settling" || s === "retry")) return "text-status-running-fg";
	if (states.some((s) => s === "waiting" || s === "lastseen")) return "text-status-waiting-fg";
	return "text-fg-3";
}

function Row({ node, state, live, onSelect, selected }: { node: DagNodeView; state: DagDisplayState; live?: DagLive; onSelect?: (id: string) => void; selected?: boolean }) {
	const meta = nodeMeta(node, state, live);
	const mark = DISPLAY_MARK[state];
	const quiet = state === "done" || state === "skipped";
	return (
		<button
			type="button"
			data-slot="dag-rail-row"
			data-state={state}
			aria-label={`${node.title || node.id}, ${node.kind}, ${STATUS[mark].label}${meta ? `, ${meta}` : ""}`}
			aria-pressed={selected}
			onClick={() => onSelect?.(node.id)}
			className={cn(
				"group/row relative flex h-7 w-full min-w-0 items-center gap-2 rounded-sm px-1.5 text-left text-sm outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
				selected && "bg-hover shadow-[inset_2px_0_0_var(--focus)]",
			)}
		>
			<StatusMark kind={mark} size={14} />
			<KindIcon kind={node.kind} size={13} />
			<span className={cn("shrink-0 font-mono text-xs", quiet ? "text-fg-3" : "text-fg")}>{node.id}</span>
			<span className={cn("min-w-0 flex-1 truncate", quiet ? "text-fg-3" : "text-fg-2")}>
				{state === "running" ? <Shimmer>{node.title}</Shimmer> : node.title}
			</span>
			{node.parents.length ? (
				<span className="hidden shrink-0 truncate font-mono text-micro text-fg-3 @[30rem]/rail:inline">← {node.parents.join(", ")}</span>
			) : null}
			{meta ? <span className={cn("max-w-[45%] shrink-0 truncate text-right font-mono text-micro tabular-nums", state === "failed" || state === "retry" ? TONE_TEXT[STATUS[mark].tone] : "text-fg-3")}>{meta}</span> : null}
		</button>
	);
}

/**
 * The default DAG view for narrow panes (320-420 px): waves as groups with a numbered spine, one 28px row per node.
 * Layout is the daemon's display order, so rows never move within a revision. `collapseDone` folds finished waves
 * into one summary row (TUI foldRows, simplified).
 */
export function DagRail({
	view,
	live,
	selected,
	onSelect,
	collapseDone = false,
	className,
}: {
	view: DagView;
	live?: DagLive;
	selected?: string;
	onSelect?: (id: string) => void;
	collapseDone?: boolean;
	className?: string;
}) {
	const waves: DagNodeView[][] = Array.from({ length: Math.max(view.levels, 0) }, () => []);
	for (const n of view.nodes) waves[n.level]?.push(n);
	return (
		<div data-slot="dag-rail" className={cn("@container/rail flex flex-col gap-1", className)}>
			{waves.map((nodes, level) => {
				const states = nodes.map((n) => displayState(n, view.status, live));
				const folded = collapseDone && states.every((s) => s === "done");
				return (
					<div key={level} className="flex gap-1.5">
						<div className="flex w-5 shrink-0 flex-col items-center pt-1.5">
							<span className={cn("font-mono text-micro font-semibold tabular-nums", waveTone(states))}>{level + 1}</span>
							<span className="mt-1 w-px flex-1 bg-line-strong" />
						</div>
						<div className="min-w-0 flex-1">
							{folded ? (
								<div className="flex h-7 items-center gap-2 px-1.5 text-sm text-fg-3">
									<StatusMark kind="done" size={14} />
									<span className="shrink-0 tabular-nums">{nodes.length} done</span>
									<span className="min-w-0 truncate font-mono text-micro">{nodes.map((n) => n.id).join(", ")}</span>
								</div>
							) : (
								nodes.map((n, i) => <Row key={n.id} node={n} state={states[i] as DagDisplayState} live={live} selected={selected === n.id} onSelect={onSelect} />)
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

/** Per-state counts in urgency order, e.g. for a collapsed pane: "1 running · 2 waiting · 5 done". */
export function DagCounts({ view, live, className }: { view: DagView; live?: DagLive; className?: string }) {
	const counts = new Map<DagDisplayState, number>();
	for (const n of view.nodes) {
		const s = displayState(n, view.status, live);
		counts.set(s, (counts.get(s) ?? 0) + 1);
	}
	return (
		<span className={cn("inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs", className)}>
			{COUNT_ORDER.filter((s) => counts.get(s)).map((s) => (
				<span key={s} className={cn("inline-flex items-center gap-1 tabular-nums", TONE_TEXT[STATUS[DISPLAY_MARK[s]].tone])}>
					<StatusMark kind={DISPLAY_MARK[s]} size={12} />
					{counts.get(s)} {STATUS[DISPLAY_MARK[s]].label}
				</span>
			))}
		</span>
	);
}
