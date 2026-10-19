/**
 * Pure geometry for the animated mascot. Poses on the 30x18 grid only differ in three regions (mascot.ts): the eye
 * cell, the mouth run plus jaw, and the limbs (legs for walkers, the wing for the pterosaur). Every species
 * (brand/species.ts) carries its own three regions; they never overlap. So a frame is one shared `base` layer plus one variant per region, and an
 * animation only toggles which region variant is visible. No DOM here; test/dino.test.ts pins the invariants.
 */
import {
	type Dot,
	eyeCellOf,
	limbRectOf,
	MASCOT_COLS,
	MASCOT_ROWS,
	mouthRunOf,
	type Palette,
	POSES,
	type PoseName,
	poseSprite,
	spriteDots,
} from "../../brand/mascot.ts";
import { INK } from "../../brand/palette.ts";
import { DEFAULT_SPECIES, type SpeciesId } from "../../brand/species.ts";

export type Region = "base" | "eye" | "mouth" | "legs";
export const REGIONS: readonly Region[] = ["base", "eye", "mouth", "legs"];

/**
 * The region a grid cell belongs to, for a species: its 3x3 eye cell, its 5-cell mouth run plus the jaw row below,
 * and its limb rectangle ("legs": the legs of the T-rex and the brachiosaurus, the wing of the pterosaur).
 */
export function regionOf(x: number, y: number, species: SpeciesId = DEFAULT_SPECIES): Region {
	const eye = eyeCellOf(species);
	if (x >= eye.x && x < eye.x + eye.size && y >= eye.y && y < eye.y + eye.size) return "eye";
	const mouth = mouthRunOf(species);
	if ((y === mouth.y || y === mouth.y + 1) && x >= mouth.x && x < mouth.x + mouth.length) return "mouth";
	const limbs = limbRectOf(species);
	if (x >= limbs.x && x < limbs.x + limbs.w && y >= limbs.y && y < limbs.y + limbs.h) return "legs";
	return "base";
}

export type DinoPalette = Palette | "current";

export interface DotStyle {
	/** "dot": round dots with gaps (large sizes). "pixel": square cells without gaps (small sizes, crisp). */
	shape: "dot" | "pixel";
	palette: DinoPalette;
}

/** One drawable mark in grid units. Squares are drawn for pixel cells; circles for dots, pupils and glints. */
export interface Mark {
	kind: "circle" | "rect";
	x: number;
	y: number;
	/** circle radius, or rect side */
	size: number;
	fill: string;
}

export interface PoseLayers {
	base: Mark[];
	eye: Mark[];
	mouth: Mark[];
	legs: Mark[];
	/** True when the eye is open (a pupil in a socket): the socket is drawn behind it. */
	socket: boolean;
}

function toMark(d: Dot, style: DotStyle): Mark {
	const fill = style.palette === "current" && d.fill === INK ? "currentColor" : d.fill;
	const pixel = style.shape === "pixel" && d.part !== "pupil" && d.part !== "glint" && Number.isInteger(d.cx - 0.5) && Number.isInteger(d.cy - 0.5);
	if (pixel) return { kind: "rect", x: d.cx - 0.5, y: d.cy - 0.5, size: 1, fill };
	return { kind: "circle", x: d.cx, y: d.cy, size: d.r, fill };
}

/** Split one pose of a species into its four region layers. */
export function poseLayers(pose: PoseName, style: DotStyle, species: SpeciesId = DEFAULT_SPECIES): PoseLayers {
	const palette: Palette = style.palette === "current" ? "ink" : style.palette;
	const sprite = poseSprite(pose, undefined, species);
	const dots = spriteDots(sprite, { palette, fill: style.shape === "pixel" ? 1 : 0.74 });
	const layers: PoseLayers = { base: [], eye: [], mouth: [], legs: [], socket: sprite.pupil !== null };
	for (const d of dots) {
		const region = d.part === "pupil" || d.part === "glint" ? "eye" : regionOf(d.x, d.y, species);
		let mark = toMark(d, style);
		if (style.palette === "current" && mark.fill !== "currentColor" && (d.part === "pupil" || d.part === "glint")) {
			mark = { ...mark, fill: d.part === "pupil" ? "currentColor" : "var(--dino-socket)" };
		}
		layers[region].push(mark);
	}
	return layers;
}

/** Stable key of a region's content, to dedupe identical variants across poses. */
export function layerKey(marks: readonly Mark[]): string {
	return marks.map((m) => `${m.kind}${m.x},${m.y},${m.size},${m.fill}`).join(";");
}

// ---------------------------------------------------------------- choreography

/** What the agent is doing; each state is a small looped (or one-shot) choreography of poses. */
export type DinoState = "idle" | "thinking" | "running" | "waiting" | "done" | "failed";
export const DINO_STATES: readonly DinoState[] = ["idle", "thinking", "running", "waiting", "done", "failed"];

/**
 * For each state, the pose variants each animated region cycles through. The first variant of each region is the rest
 * frame shown when motion is reduced. CSS (dino.css) owns the timing; this table owns which layers exist.
 */
export const CHOREOGRAPHY: Readonly<Record<DinoState, { eye: PoseName[]; mouth: PoseName[]; legs: PoseName[] }>> = {
	idle: { eye: ["idle", "blink", "look-forward"], mouth: ["idle"], legs: ["idle"] },
	thinking: { eye: ["look-up", "idle", "look-forward", "blink"], mouth: ["idle"], legs: ["idle"] },
	running: { eye: ["run-a"], mouth: ["run-a"], legs: ["run-a", "run-b"] },
	waiting: { eye: ["look-forward", "blink"], mouth: ["idle"], legs: ["idle"] },
	done: { eye: ["done"], mouth: ["happy"], legs: ["idle", "jump"] },
	failed: { eye: ["failed"], mouth: ["failed"], legs: ["idle"] },
};

/** The single pose that best stands for a state when it cannot move (reduced motion, thumbnails). */
export const REST_POSE: Readonly<Record<DinoState, PoseName>> = {
	idle: "idle",
	thinking: "look-up",
	running: "run-a",
	waiting: "look-forward",
	done: "happy",
	failed: "failed",
};

export const GRID = { cols: MASCOT_COLS, rows: MASCOT_ROWS } as const;
/** The paper socket behind an open eye: the species' 3x3 eye cell. */
export function socketOf(species: SpeciesId = DEFAULT_SPECIES): { x: number; y: number; size: number } {
	const { x, y, size } = eyeCellOf(species);
	return { x, y, size };
}
/** The T-rex socket, kept for compatibility; use socketOf(species). */
export const SOCKET = socketOf(DEFAULT_SPECIES);

export function isPose(name: string): name is PoseName {
	return Object.hasOwn(POSES, name);
}
