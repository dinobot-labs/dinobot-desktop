import { type ComponentProps, memo, useMemo } from "react";
import { MARK_COLS, MARK_ROWS, markSprite, type PoseName, spriteDots } from "../../brand/mascot.ts";
import { SPECIES, SPECIES_IDS, type SpeciesId } from "../../brand/species.ts";
import { cn } from "../../lib/cn.ts";
import {
	CHOREOGRAPHY,
	type DinoPalette,
	type DinoState,
	type DotStyle,
	GRID,
	type Mark,
	poseLayers,
	REST_POSE,
	socketOf,
} from "./geometry.ts";
import { useDinoSpecies } from "./species-context.tsx";

export interface DinoProps extends Omit<ComponentProps<"svg">, "children"> {
	/** A fixed pose. Ignored when `state` is set. */
	pose?: PoseName;
	/** An animated choreography (idle, thinking, running, waiting, done, failed). */
	state?: DinoState;
	/** Rendered width in CSS px; the height follows the 30x18 grid. Multiples of 30 stay crisp in pixel mode. */
	size?: number;
	/** "auto" picks pixel cells below 72px and round dots above. */
	shape?: "auto" | "dot" | "pixel";
	/** "color" brand stops (default), "ink"/"mint"/"white" mono, or "current" (currentColor). */
	palette?: DinoPalette;
	/** A dotted ground line under the feet; it scrolls while running. */
	ground?: boolean;
	/** Accessible name. Without it the mascot is decorative. */
	title?: string;
	/** The dinosaur; defaults to the nearest DinoSpeciesProvider (the T-rex without one). */
	species?: SpeciesId;
}

const GROUND_Y = GRID.rows + 0.9;
const GROUND_DOTS = Array.from({ length: 18 }, (_, i) => -2 + i * 2);

function Marks({ marks }: { marks: readonly Mark[] }) {
	return (
		<>
			{marks.map((m, i) =>
				m.kind === "rect" ? (
					<rect key={i} x={m.x} y={m.y} width={m.size} height={m.size} fill={m.fill} shapeRendering="crispEdges" />
				) : (
					<circle key={i} cx={m.x} cy={m.y} r={m.size} fill={m.fill} />
				),
			)}
		</>
	);
}

/** The 2x2 paper socket behind the mark's pupil: centered on the species' pupil, inset 0.04 like the body cells. */
export function markSocketOf(species: SpeciesId): { x: number; y: number; size: number } {
	const { cx, cy } = SPECIES[species].mark.pupil;
	return { x: cx - 0.96, y: cy - 0.96, size: 1.92 };
}

const MARK_MARKS = Object.fromEntries(
	SPECIES_IDS.map((id) => [
		id,
		spriteDots(markSprite(id), { fill: 1 }).map(
			(d): Mark =>
				d.part === "pupil" || d.part === "glint"
					? { kind: "circle", x: d.cx, y: d.cy, size: d.r, fill: d.fill }
					: { kind: "rect", x: d.cx - 0.5, y: d.cy - 0.5, size: 1, fill: d.fill },
		),
	]),
) as Record<SpeciesId, Mark[]>;

/** The compact head mark (11x9) for avatars and small chrome. Integer px per cell (22, 33, 44) stays crisp. */
export function DinoMark({
	size = 22,
	title,
	className,
	species: speciesProp,
	...props
}: Omit<ComponentProps<"svg">, "children"> & { size?: number; title?: string; species?: SpeciesId }) {
	const contextSpecies = useDinoSpecies();
	const species = speciesProp ?? contextSpecies;
	const socket = markSocketOf(species);
	return (
		<svg
			data-slot="dino-mark"
			data-species={species}
			viewBox={`0 0 ${MARK_COLS} ${MARK_ROWS}`}
			width={size}
			height={(size * MARK_ROWS) / MARK_COLS}
			className={cn("inline-block shrink-0", className)}
			role={title ? "img" : undefined}
			aria-label={title}
			aria-hidden={title ? undefined : true}
			{...props}
		>
			<rect x={socket.x} y={socket.y} width={socket.size} height={socket.size} rx={0.2} fill="var(--dino-socket)" />
			<Marks marks={MARK_MARKS[species]} />
		</svg>
	);
}

/** The dinobot mascot (the T-rex unless a species is given or provided). Static with `pose`, alive with `state`. Motion is pure CSS (styles/dino.css) and stops under reduced motion. */
export const Dino = memo(function Dino({
	pose = "idle",
	state,
	size = 60,
	shape = "auto",
	palette = "color",
	ground = false,
	title,
	species: speciesProp,
	className,
	...props
}: DinoProps) {
	const contextSpecies = useDinoSpecies();
	const species = speciesProp ?? contextSpecies;
	const socket = socketOf(species);
	const resolvedShape = shape === "auto" ? (size < 72 ? "pixel" : "dot") : shape;
	const style: DotStyle = useMemo(() => ({ shape: resolvedShape, palette }), [resolvedShape, palette]);

	const layers = useMemo(() => {
		const plan = state ? CHOREOGRAPHY[state] : { eye: [pose], mouth: [pose], legs: [pose] };
		const basePose = state ? REST_POSE[state] : pose;
		const region = (name: "eye" | "mouth" | "legs", poses: readonly PoseName[]) =>
			poses.map((p, index) => {
				const l = poseLayers(p, style, species);
				return { key: `${name}:${p}`, rest: index === 0, marks: l[name], socket: name === "eye" && l.socket };
			});
		return {
			base: poseLayers(basePose, style, species).base,
			eye: region("eye", plan.eye),
			mouth: region("mouth", plan.mouth),
			legs: region("legs", plan.legs),
		};
	}, [state, pose, style, species]);

	const height = ground ? GRID.rows + 1.6 : GRID.rows;
	return (
		<svg
			data-slot="dino"
			data-state={state}
			data-species={species}
			data-pose={state ? undefined : pose}
			viewBox={`0 0 ${GRID.cols} ${height}`}
			width={size}
			height={(size * height) / GRID.cols}
			className={cn("dn-dino inline-block shrink-0 overflow-visible", className)}
			role={title ? "img" : undefined}
			aria-label={title}
			aria-hidden={title ? undefined : true}
			{...props}
		>
			{title ? <title>{title}</title> : null}
			{ground ? (
				<g className="dn-ground" fill="var(--dot-ink)">
					{GROUND_DOTS.map((x) => (
						<circle key={x} cx={x + 0.5} cy={GROUND_Y} r={0.32} />
					))}
				</g>
			) : null}
			<g className="dn-body">
				<Marks marks={layers.base} />
				{(["legs", "mouth", "eye"] as const).map((name) =>
					layers[name].map((variant) => (
						<g key={variant.key} data-layer={variant.key} data-rest={variant.rest ? "" : undefined}>
							{variant.socket ? (
								<rect
									x={socket.x + 0.08}
									y={socket.y + 0.08}
									width={socket.size - 0.16}
									height={socket.size - 0.16}
									rx={resolvedShape === "pixel" ? 0.2 : 1.1}
									fill="var(--dino-socket)"
								/>
							) : null}
							<Marks marks={variant.marks} />
						</g>
					)),
				)}
			</g>
		</svg>
	);
});
