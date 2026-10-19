/**
 * Layered layout for the DAG graph (docs/research/dag-visualization.md §Decision): Sugiyama-lite.
 *   1. Layers: the daemon's longest-path `level` (dag-view.ts waveLayout), so the graph and the rail agree.
 *   2. Edges over `parents` (the transitive reduction); edges spanning > 1 layer get one dummy per skipped layer.
 *   3. Order within layers: barycenter sweeps (down/up, 4 rounds) seeded with the display order, keeping the
 *      ordering with the fewest crossings. Deterministic.
 *   4. Coordinates: fixed pitch on the main axis; cross-axis slots packed per layer and centered.
 * Invariant: the output depends only on structure (ids, levels, parents, order), never on node state, so status
 * updates never move a node (test/dag-layout.test.ts).
 */
import type { DagView } from "./types.ts";

export type Direction = "LR" | "TB";

export interface LayoutOptions {
	direction: Direction;
	nodeWidth: number;
	nodeHeight: number;
	/** Gap between layers along the main axis. */
	layerGap: number;
	/** Gap between nodes inside a layer. */
	nodeGap: number;
	/** Cross-axis slot of a dummy (edge waypoint). */
	dummySize: number;
	padding: number;
}

export const DEFAULT_LAYOUT: Readonly<Record<Direction, LayoutOptions>> = {
	LR: { direction: "LR", nodeWidth: 196, nodeHeight: 44, layerGap: 44, nodeGap: 10, dummySize: 14, padding: 12 },
	TB: { direction: "TB", nodeWidth: 184, nodeHeight: 44, layerGap: 32, nodeGap: 10, dummySize: 16, padding: 12 },
};

export interface NodeBox {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	level: number;
	/** Index inside its layer after ordering. */
	rank: number;
}

export interface EdgeRoute {
	from: string;
	to: string;
	/** Polyline from the source port to the target port through dummy waypoints. */
	points: [number, number][];
}

export interface DagLayout {
	direction: Direction;
	width: number;
	height: number;
	nodes: Record<string, NodeBox>;
	edges: EdgeRoute[];
	/** Real and dummy ids per layer, ordered. */
	layers: string[][];
	crossings: number;
}

interface Item {
	id: string;
	dummy: boolean;
	level: number;
}

function countCrossings(layers: string[][], succ: Map<string, string[]>): number {
	let total = 0;
	for (let l = 0; l + 1 < layers.length; l++) {
		const lower = new Map((layers[l + 1] ?? []).map((id, i) => [id, i]));
		const pairs: [number, number][] = [];
		(layers[l] ?? []).forEach((id, i) => {
			for (const s of succ.get(id) ?? []) {
				const j = lower.get(s);
				if (j !== undefined) pairs.push([i, j]);
			}
		});
		for (let a = 0; a < pairs.length; a++)
			for (let b = a + 1; b < pairs.length; b++) {
				const [i1, j1] = pairs[a] as [number, number];
				const [i2, j2] = pairs[b] as [number, number];
				if ((i1 - i2) * (j1 - j2) < 0) total++;
			}
	}
	return total;
}

export function layoutDag(view: Pick<DagView, "nodes">, options: Partial<LayoutOptions> & { direction?: Direction } = {}): DagLayout {
	const opt: LayoutOptions = { ...DEFAULT_LAYOUT[options.direction ?? "LR"], ...options };
	const items = new Map<string, Item>();
	const succ = new Map<string, string[]>();
	const pred = new Map<string, string[]>();
	const link = (a: string, b: string) => {
		succ.set(a, [...(succ.get(a) ?? []), b]);
		pred.set(b, [...(pred.get(b) ?? []), a]);
	};
	const levelCount = view.nodes.reduce((m, n) => Math.max(m, n.level + 1), 0);
	const layers: string[][] = Array.from({ length: levelCount }, () => []);
	for (const n of view.nodes) {
		items.set(n.id, { id: n.id, dummy: false, level: n.level });
		layers[n.level]?.push(n.id);
	}
	const chains: { from: string; to: string; path: string[] }[] = [];
	for (const n of view.nodes) {
		for (const p of n.parents) {
			const parent = items.get(p);
			if (!parent) continue;
			const path = [p];
			for (let l = parent.level + 1; l < n.level; l++) {
				const id = `${p}->${n.id}#${l}`;
				items.set(id, { id, dummy: true, level: l });
				layers[l]?.push(id);
				path.push(id);
			}
			path.push(n.id);
			for (let i = 0; i + 1 < path.length; i++) link(path[i] as string, path[i + 1] as string);
			chains.push({ from: p, to: n.id, path });
		}
	}

	// Barycenter sweeps, keep the best.
	let best = layers.map((l) => [...l]);
	let bestCrossings = countCrossings(best, succ);
	let current = best.map((l) => [...l]);
	const position = (layer: string[]) => new Map(layer.map((id, i) => [id, i]));
	for (let round = 0; round < 4 && bestCrossings > 0; round++) {
		for (const down of [true, false]) {
			const range = down ? [...current.keys()].slice(1) : [...current.keys()].slice(0, -1).reverse();
			for (const l of range) {
				const ref = position(current[down ? l - 1 : l + 1] ?? []);
				const layer = current[l] ?? [];
				const keyed = layer.map((id, i) => {
					const nbrs = (down ? pred.get(id) : succ.get(id)) ?? [];
					const ps = nbrs.map((v) => ref.get(v)).filter((v): v is number => v !== undefined);
					return { id, key: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : i, i };
				});
				keyed.sort((a, b) => a.key - b.key || a.i - b.i);
				current[l] = keyed.map((k) => k.id);
			}
			const c = countCrossings(current, succ);
			if (c < bestCrossings) {
				bestCrossings = c;
				best = current.map((l) => [...l]);
			}
		}
	}

	// Coordinates.
	const lr = opt.direction === "LR";
	const mainNode = lr ? opt.nodeWidth : opt.nodeHeight;
	const crossNode = lr ? opt.nodeHeight : opt.nodeWidth;
	const slot = (id: string) => (items.get(id)?.dummy ? opt.dummySize : crossNode);
	const extents = best.map((layer) => layer.reduce((sum, id, i) => sum + slot(id) + (i ? opt.nodeGap : 0), 0));
	const crossMax = Math.max(0, ...extents);
	const centers = new Map<string, { main: number; cross: number }>();
	best.forEach((layer, l) => {
		let c = opt.padding + (crossMax - (extents[l] ?? 0)) / 2;
		const main = opt.padding + l * (mainNode + opt.layerGap);
		for (const id of layer) {
			const s = slot(id);
			centers.set(id, { main: main + mainNode / 2, cross: c + s / 2 });
			c += s + opt.nodeGap;
		}
	});
	const xy = (main: number, cross: number): [number, number] => (lr ? [main, cross] : [cross, main]);

	const nodes: Record<string, NodeBox> = {};
	for (const n of view.nodes) {
		const c = centers.get(n.id);
		if (!c) continue;
		const [cx, cy] = xy(c.main, c.cross);
		nodes[n.id] = {
			id: n.id,
			x: cx - opt.nodeWidth / 2,
			y: cy - opt.nodeHeight / 2,
			width: opt.nodeWidth,
			height: opt.nodeHeight,
			level: n.level,
			rank: (best[n.level] ?? []).indexOf(n.id),
		};
	}
	const edges: EdgeRoute[] = chains.map(({ from, to, path }) => {
		const points: [number, number][] = path.map((id, i) => {
			const c = centers.get(id) as { main: number; cross: number };
			if (i === 0) return xy(c.main + mainNode / 2, c.cross);
			if (i === path.length - 1) return xy(c.main - mainNode / 2, c.cross);
			return xy(c.main, c.cross);
		});
		return { from, to, points };
	});
	const mainTotal = opt.padding * 2 + Math.max(0, levelCount * mainNode + (levelCount - 1) * opt.layerGap);
	const crossTotal = opt.padding * 2 + crossMax;
	const [width, height] = lr ? [mainTotal, crossTotal] : [crossTotal, mainTotal];
	return { direction: opt.direction, width, height, nodes, edges, layers: best, crossings: bestCrossings };
}

/**
 * SVG path through the waypoints: each hop leaves along the main axis, turns with a rounded elbow at the midpoint,
 * and enters the next point along the main axis. Straight when aligned.
 */
export function edgePath(points: readonly [number, number][], direction: Direction, radius = 6): string {
	if (points.length < 2) return "";
	const [x0, y0] = points[0] as [number, number];
	let d = `M${x0} ${y0}`;
	for (let i = 0; i + 1 < points.length; i++) {
		const [ax, ay] = points[i] as [number, number];
		const [bx, by] = points[i + 1] as [number, number];
		if (direction === "LR") {
			if (Math.abs(ay - by) < 0.5) {
				d += ` L${bx} ${by}`;
				continue;
			}
			const mx = (ax + bx) / 2;
			const r = Math.min(radius, Math.abs(by - ay) / 2, Math.abs(mx - ax));
			const sy = by > ay ? 1 : -1;
			d += ` L${mx - r} ${ay} Q${mx} ${ay} ${mx} ${ay + sy * r} L${mx} ${by - sy * r} Q${mx} ${by} ${mx + r} ${by} L${bx} ${by}`;
		} else {
			if (Math.abs(ax - bx) < 0.5) {
				d += ` L${bx} ${by}`;
				continue;
			}
			const my = (ay + by) / 2;
			const r = Math.min(radius, Math.abs(bx - ax) / 2, Math.abs(my - ay));
			const sx = bx > ax ? 1 : -1;
			d += ` L${ax} ${my - r} Q${ax} ${my} ${ax + sx * r} ${my} L${bx - sx * r} ${my} Q${bx} ${my} ${bx} ${my + r} L${bx} ${by}`;
		}
	}
	return d;
}
