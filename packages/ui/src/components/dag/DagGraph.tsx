import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Shimmer } from "../shimmer.tsx";
import { STATUS, StatusMark } from "../status.tsx";
import { type DagDisplayState, DISPLAY_MARK, closure, displayState, nodeMeta } from "./display.ts";
import { KindIcon } from "./kind-icon.tsx";
import { type Direction, edgePath, layoutDag } from "./layout.ts";
import type { DagLive, DagNodeView, DagView } from "./types.ts";

function useWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setWidth(el.clientWidth);
		const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return [ref, width] as const;
}

function NodeCard({ node, state, live, dim, selected, onSelect, onHover }: {
	node: DagNodeView;
	state: DagDisplayState;
	live?: DagLive;
	dim: boolean;
	selected: boolean;
	onSelect?: (id: string) => void;
	onHover: (id: string | null) => void;
}) {
	const mark = DISPLAY_MARK[state];
	const meta = nodeMeta(node, state, live);
	const quiet = state === "done" || state === "skipped";
	return (
		<button
			type="button"
			data-slot="dag-node"
			data-state={state}
			aria-label={`${node.title || node.id}, ${node.kind}, ${STATUS[mark].label}${meta ? `, ${meta}` : ""}`}
			aria-pressed={selected}
			onClick={() => onSelect?.(node.id)}
			onMouseEnter={() => onHover(node.id)}
			onMouseLeave={() => onHover(null)}
			onFocus={() => onHover(node.id)}
			onBlur={() => onHover(null)}
			className={cn(
				"absolute flex cursor-pointer items-center gap-2 overflow-hidden rounded-md border bg-surface px-2.5 text-left outline-none transition-[opacity,border-color] duration-(--dur-state) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
				state === "failed" ? "border-line border-l-2 border-l-status-failed" : "border-line hover:border-line-strong",
				state === "waiting" && "border-status-waiting bg-status-waiting-tint",
				state === "pending" && "border-dashed",
				selected && "outline-2 outline-offset-2 outline-focus",
				dim && "opacity-35",
			)}
			style={{ left: 0, top: 0, width: "100%", height: "100%" }}
		>
			<StatusMark kind={mark} size={14} />
			<span className="min-w-0 flex-1">
				<span className={cn("block truncate text-xs font-medium", quiet ? "text-fg-2" : "text-fg")}>
					{state === "running" ? <Shimmer>{node.title || node.id}</Shimmer> : node.title || node.id}
				</span>
				<span className="flex min-w-0 items-center gap-1 font-mono text-micro text-fg-3">
					<KindIcon kind={node.kind} size={11} />
					<span className="shrink-0">{node.id}</span>
					{meta ? <span className="min-w-0 truncate tabular-nums">· {meta}</span> : null}
				</span>
			</span>
			{state === "running" ? <span className="dn-scan" style={{ ["--scan-color" as string]: "var(--status-running)" }} /> : null}
		</button>
	);
}

/**
 * Layered DAG graph (custom SVG edges + HTML nodes). Direction is TB below 720 px and LR above unless fixed.
 * Hover or focus highlights the node's upstream and downstream closure. Only running nodes move (spinner arc,
 * shimmer, scan line); everything stops under reduced motion. Layout ignores state, so updates never move nodes.
 */
export function DagGraph({
	view,
	live,
	direction = "auto",
	selected,
	onSelect,
	className,
}: {
	view: DagView;
	live?: DagLive;
	direction?: Direction | "auto";
	selected?: string;
	onSelect?: (id: string) => void;
	className?: string;
}) {
	const [ref, width] = useWidth<HTMLDivElement>();
	const dir: Direction = direction === "auto" ? (width > 0 && width < 720 ? "TB" : "LR") : direction;
	const structureKey = view.nodes.map((n) => `${n.id}:${n.level}:${n.parents.join(",")}`).join("|");
	// TB in a narrow pane: shrink nodes so the widest wave fits (104-184 px), instead of scrolling sideways.
	const widest = useMemo(() => {
		const perLevel = new Map<number, number>();
		for (const n of view.nodes) perLevel.set(n.level, (perLevel.get(n.level) ?? 0) + 1);
		return Math.max(1, ...perLevel.values());
	}, [structureKey]);
	const nodeWidth = dir === "TB" && width > 0 ? Math.max(104, Math.min(184, Math.floor((width - 24 - (widest - 1) * 10) / widest))) : undefined;
	// biome-ignore lint: layout depends on structure only (structureKey), never on node state
	const layout = useMemo(() => layoutDag(view, nodeWidth ? { direction: dir, nodeWidth } : { direction: dir }), [structureKey, dir, nodeWidth]);
	const [hover, setHover] = useState<string | null>(null);
	const lit = useMemo(() => (hover ? closure(view, hover) : null), [hover, view]);
	const states = new Map(view.nodes.map((n) => [n.id, displayState(n, view.status, live)]));

	return (
		<div ref={ref} data-slot="dag-graph" data-direction={dir} className={cn("relative w-full overflow-auto", className)}>
			<div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
				<svg aria-hidden="true" width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible">
					{layout.edges.map((e) => {
						const toState = states.get(e.to);
						const fromState = states.get(e.from);
						const active = toState === "running" && fromState === "done";
						const broken = fromState === "failed";
						const dim = lit !== null && !(lit.has(e.from) && lit.has(e.to));
						return (
							<path
								key={`${e.from}->${e.to}`}
								d={edgePath(e.points, dir)}
								fill="none"
								stroke={active ? "var(--status-running)" : broken ? "var(--status-failed)" : "var(--line-ui)"}
								strokeOpacity={dim ? 0.18 : active || broken ? 1 : 0.55}
								strokeWidth={active ? 1.5 : 1}
								strokeDasharray={broken ? "3 3" : undefined}
								className="transition-[stroke-opacity] duration-(--dur-state)"
							/>
						);
					})}
				</svg>
				{view.nodes.map((n) => {
					const box = layout.nodes[n.id];
					if (!box) return null;
					return (
						<div key={n.id} className="absolute" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
							<NodeCard
								node={n}
								state={states.get(n.id) as DagDisplayState}
								live={live}
								dim={lit !== null && !lit.has(n.id)}
								selected={selected === n.id}
								onSelect={onSelect}
								onHover={setHover}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}

/** Overview glyph: one dot per node in layered position, colored by state. For run lists and pane headers. */
export function DagMini({ view, live, className, dot = 7, gap = 4 }: { view: DagView; live?: DagLive; className?: string; dot?: number; gap?: number }) {
	const layout = useMemo(() => layoutDag(view, { direction: "LR", nodeWidth: dot, nodeHeight: dot, layerGap: gap * 1.6, nodeGap: gap, dummySize: 0, padding: 1 }), [view, dot, gap]);
	const color: Record<DagDisplayState, string> = {
		running: "var(--status-running)",
		settling: "var(--text-2)",
		waiting: "var(--status-waiting)",
		ready: "var(--text-2)",
		retry: "var(--status-running)",
		pending: "var(--line-strong)",
		done: "var(--status-success)",
		failed: "var(--status-failed)",
		skipped: "var(--status-cancelled)",
		lastseen: "var(--status-cancelled)",
	};
	return (
		<svg data-slot="dag-mini" role="img" aria-label={`${view.nodes.length} nodes`} width={layout.width} height={layout.height} className={cn("shrink-0", className)}>
			{view.nodes.map((n) => {
				const b = layout.nodes[n.id];
				if (!b) return null;
				const s = displayState(n, view.status, live);
				return <circle key={n.id} cx={b.x + dot / 2} cy={b.y + dot / 2} r={dot / 2} fill={color[s]} />;
			})}
		</svg>
	);
}
