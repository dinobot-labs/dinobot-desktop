import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as brand from "../src/brand/index.ts";
import { MASCOT_COLS, MASCOT_ROWS, MARK_COLS, MARK_ROWS, POSE_NAMES, POSES, poseSprite } from "../src/brand/mascot.ts";
import { STOPS, STOPS_DEEP } from "../src/brand/palette.ts";
import { DEFAULT_SPECIES, SPECIES, SPECIES_IDS, type SpeciesId } from "../src/brand/species.ts";
import { Dino, DinoMark, markSocketOf } from "../src/components/dino/Dino.tsx";
import { CHOREOGRAPHY, DINO_STATES, layerKey, poseLayers, REGIONS, REST_POSE, regionOf, SOCKET, socketOf } from "../src/components/dino/geometry.ts";
import { DinoSpeciesProvider } from "../src/components/dino/species-context.tsx";
import { resolveTheme } from "../src/styles/contrast.ts";

const light = resolveTheme(readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8"), "light");

test("brand palette and tokens agree", () => {
	for (const [name, hex] of Object.entries(STOPS)) expect(light.get(name)).toBe(hex);
	for (const [name, hex] of Object.entries(STOPS_DEEP)) expect(light.get(`${name}-deep`)).toBe(hex);
});

test("species registry: four species, rex default, 30x18 bitmaps, 11x9 marks, five stops (ADR 0100)", () => {
	expect([...SPECIES_IDS]).toEqual(["rex", "ptero", "brachio", "tricera"]);
	expect(DEFAULT_SPECIES).toBe("rex");
	expect(brand.SPECIES).toBe(SPECIES);
	for (const id of SPECIES_IDS) {
		const s = SPECIES[id];
		expect(s.id).toBe(id);
		expect(s.bitmap.length).toBe(MASCOT_ROWS);
		for (const row of s.bitmap) expect(row.length).toBe(MASCOT_COLS);
		expect(s.mark.rows.length).toBe(MARK_ROWS);
		for (const row of s.mark.rows) expect(row.length).toBe(MARK_COLS);
		expect(s.stops.length).toBe(5);
		// The T-rex mark socket stays where it always was (3.04, 2.04).
		if (id === "rex") expect(markSocketOf(id)).toEqual({ x: 3.04, y: 2.04, size: 1.92 });
	}
	// The T-rex is the original Signal mascot: its stops are the palette's stops.
	expect([...SPECIES.rex.stops]).toEqual(Object.values(STOPS));
	expect(SOCKET).toEqual(socketOf("rex"));
	expect(SOCKET).toEqual({ x: 19, y: 2, size: 3 });
});

const STYLES = [{ shape: "dot", palette: "color" }, { shape: "pixel", palette: "current" }] as const;

for (const species of SPECIES_IDS) {
	test(`${species}: poses differ only in the eye, mouth and limb regions (shared base layer)`, () => {
		for (const style of STYLES) {
			const base = layerKey(poseLayers("idle", style, species).base);
			for (const pose of POSE_NAMES) expect(layerKey(poseLayers(pose, style, species).base)).toBe(base);
		}
		// And at the token level: cells outside the three regions are the same in every pose.
		const idle = poseSprite("idle", undefined, species).rows;
		for (const pose of POSE_NAMES) {
			const rows = poseSprite(pose, undefined, species).rows;
			for (let y = 0; y < MASCOT_ROWS; y++)
				for (let x = 0; x < MASCOT_COLS; x++) if (regionOf(x, y, species) === "base") expect(`${x},${y}:${rows[y]?.[x]}`).toBe(`${x},${y}:${idle[y]?.[x]}`);
		}
	});

	test(`${species}: every region of every pose is drawn and the regions are where the species says`, () => {
		const s = SPECIES[species];
		for (const pose of POSE_NAMES) {
			const l = poseLayers(pose, { shape: "dot", palette: "color" }, species);
			expect(l.base.length).toBeGreaterThan(40);
			expect(l.legs.length).toBeGreaterThan(10);
			expect(l.mouth.length).toBeGreaterThan(0);
			expect(l.socket).toBe(POSES[pose].eye === "open" || POSES[pose].eye === "forward" || POSES[pose].eye === "up" || POSES[pose].eye === "down");
		}
		// The three regions: the eye cell, the mouth run plus jaw, the limb rect; they never overlap.
		const count: Record<string, number> = { base: 0, eye: 0, mouth: 0, legs: 0 };
		for (let y = 0; y < MASCOT_ROWS; y++) for (let x = 0; x < MASCOT_COLS; x++) count[regionOf(x, y, species)]! += 1;
		expect(count.eye).toBe(9);
		expect(count.mouth).toBe(10);
		expect(count.legs).toBe(s.limbs.w * s.limbs.h);
		expect(regionOf(s.eye.x + 1, s.eye.y + 1, species)).toBe("eye");
		expect(regionOf(s.mouth.x, s.mouth.y + 1, species)).toBe("mouth");
		expect(regionOf(s.limbs.x, s.limbs.y, species)).toBe("legs");
		expect(socketOf(species)).toEqual({ x: s.eye.x, y: s.eye.y, size: 3 });
		// The limb frames really animate: run-a and run-b differ in the legs layer only.
		const style = STYLES[0];
		expect(layerKey(poseLayers("run-a", style, species).legs)).not.toBe(layerKey(poseLayers("run-b", style, species).legs));
		expect(layerKey(poseLayers("jump", style, species).legs)).not.toBe(layerKey(poseLayers("idle", style, species).legs));
	});

	test(`${species}: the mark socket sits on the mark pupil`, () => {
		const { cx, cy } = SPECIES[species].mark.pupil;
		const socket = markSocketOf(species);
		expect(socket.x + socket.size / 2).toBeCloseTo(cx, 6);
		expect(socket.y + socket.size / 2).toBeCloseTo(cy, 6);
		// The socket is paper (the 2x2 '.' cells around the pupil) in the mark bitmap.
		const rows = SPECIES[species].mark.rows;
		for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) expect(rows[cy + dy]?.[cx + dx]).toBe(".");
	});
}

test("pterodactyl: the wing is the animated 'legs' region", () => {
	expect(regionOf(0, 0, "ptero")).toBe("legs");
	expect(regionOf(15, 17, "ptero")).toBe("legs");
	expect(regionOf(16, 17, "ptero")).toBe("base");
	expect(regionOf(0, 0, "rex")).toBe("base");
});

test("Dino and DinoMark draw the provided species, an explicit species wins, the default is rex", () => {
	const render = (el: ReturnType<typeof createElement>, species?: SpeciesId) =>
		renderToStaticMarkup(species ? createElement(DinoSpeciesProvider, { species, children: el }) : el);
	expect(render(createElement(Dino, { state: "idle" }))).toContain('data-species="rex"');
	expect(render(createElement(Dino, { state: "running" }), "ptero")).toContain('data-species="ptero"');
	expect(render(createElement(Dino, { pose: "idle", species: "brachio" }), "ptero")).toContain('data-species="brachio"');
	const ptero = render(createElement(DinoMark, {}), "ptero");
	expect(ptero).toContain('data-species="ptero"');
	const s = markSocketOf("ptero");
	expect(ptero).toContain(`x="${s.x}" y="${s.y}"`);
	// Body colors follow the species stops.
	expect(render(createElement(Dino, { pose: "idle", size: 120 }), "brachio")).toContain(SPECIES.brachio.stops[2]);
	expect(render(createElement(Dino, { pose: "idle", size: 120 }), "brachio")).not.toContain(SPECIES.rex.stops[2]);
});

test("choreographies use known poses and rest on a pose of their own", () => {
	for (const state of DINO_STATES) {
		const c = CHOREOGRAPHY[state];
		for (const list of [c.eye, c.mouth, c.legs]) {
			expect(list.length).toBeGreaterThan(0);
			for (const p of list) expect(POSE_NAMES).toContain(p);
		}
		expect(POSE_NAMES).toContain(REST_POSE[state]);
	}
});

test("dino.css animates exactly the layers the choreography renders", () => {
	const css = readFileSync(new URL("../src/styles/dino.css", import.meta.url), "utf8");
	const animated = [...css.matchAll(/data-state="(\w+)"\] \[data-layer="([\w:-]+)"\]/g)].map((m) => `${m[1]} ${m[2]}`);
	// The layer keys are pose names, so the same rules animate every species.
	const rendered = new Set(DINO_STATES.flatMap((s) => (["eye", "mouth", "legs"] as const).flatMap((r) => CHOREOGRAPHY[s][r].map((p) => `${s} ${r}:${p}`))));
	for (const a of animated) expect(rendered).toContain(a);
	// Every non-rest variant must be animated, or it would stay invisible forever.
	for (const s of DINO_STATES)
		for (const r of ["eye", "mouth", "legs"] as const)
			for (const p of CHOREOGRAPHY[s][r].slice(1)) expect(animated).toContain(`${s} ${r}:${p}`);
});
