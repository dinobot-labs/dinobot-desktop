import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SPECIES, SPECIES_IDS } from "../src/brand/species.ts";
import { CONTRAST_PAIRS, evaluate, resolveTheme } from "../src/styles/contrast.ts";
import { hexToOklch, hueDistance } from "../src/styles/oklch.ts";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

for (const theme of ["light", "dark"] as const) {
	describe(`${theme} theme contrast`, () => {
		const tokens = resolveTheme(css, theme);
		const results = evaluate(tokens);
		test("every pair resolves to hex colors", () => {
			const unresolved = results.filter((r) => r.ratio === null).map((r) => `${r.fg}=${r.fgValue} on ${r.bg}=${r.bgValue}`);
			expect(unresolved).toEqual([]);
		});
		test(`all ${CONTRAST_PAIRS.length} pairs pass (text >= 4.5, ui >= 3)`, () => {
			const failing = results.filter((r) => !r.pass).map((r) => `${r.fg} on ${r.bg}: ${r.ratio?.toFixed(2)} < ${r.kind} (${r.use})`);
			expect(failing).toEqual([]);
		});
	});
}

test("dark theme really overrides the light primitives", () => {
	const light = resolveTheme(css, "light");
	const dark = resolveTheme(css, "dark");
	expect(light.get("bg")).toBe("#f9fbfa");
	expect(dark.get("bg")).toBe("#141615");
	expect(dark.get("text-1")).toBe("#ecf0ee");
	expect(dark.get("surface")).toBe("#1b1e1d");
});

// Dinosaur themes (ADR 0100): every species passes the same rules in both themes.
for (const dino of SPECIES_IDS) {
	for (const theme of ["light", "dark"] as const) {
		describe(`${dino} ${theme} contrast`, () => {
			const results = evaluate(resolveTheme(css, theme, dino));
			test("every pair resolves", () => {
				expect(results.filter((r) => r.ratio === null).map((r) => `${r.fg}=${r.fgValue} on ${r.bg}=${r.bgValue}`)).toEqual([]);
			});
			test(`all ${CONTRAST_PAIRS.length} pairs pass (text >= 4.5, ui >= 3)`, () => {
				expect(results.filter((r) => !r.pass).map((r) => `${r.fg} on ${r.bg}: ${r.ratio?.toFixed(2)} < ${r.kind} (${r.use})`)).toEqual([]);
			});
		});
	}
}

test("tokens.css accents match the species accents (brand/species.ts)", () => {
	for (const dino of SPECIES_IDS) {
		for (const theme of ["light", "dark"] as const) {
			const tokens = resolveTheme(css, theme, dino);
			const accent = SPECIES[dino].accent[theme];
			expect({ dino, theme, solid: tokens.get("accent"), deep: tokens.get("accent-deep"), tint: tokens.get("accent-tint"), soft: tokens.get("accent-soft"), selection: tokens.get("selection") }).toEqual({
				dino,
				theme,
				solid: accent.solid,
				deep: accent.deep,
				tint: accent.tint,
				soft: accent.soft,
				selection: accent.soft,
			});
		}
	}
});

test("the T-rex theme is the default theme, value for value", () => {
	for (const theme of ["light", "dark"] as const) {
		const base = resolveTheme(css, theme);
		const rex = resolveTheme(css, theme, "rex");
		const changed = [...base.keys()].filter((k) => rex.get(k) !== base.get(k));
		expect({ theme, changed }).toEqual({ theme, changed: [] });
	}
});

test("a dinosaur theme never changes status colors or the fixed hue families", () => {
	// Status meaning is fixed (running amber, done green, failed coral, waiting indigo); idle/cancelled are the
	// theme's own grays and follow the neutrals.
	const fixed = /^(status-(running|waiting|success|failed)|mark-|(amber|red|mint|teal|cyan|blue|indigo)(-|$))/;
	for (const theme of ["light", "dark"] as const) {
		const base = resolveTheme(css, theme);
		for (const dino of SPECIES_IDS) {
			const themed = resolveTheme(css, theme, dino);
			const changed = [...base.keys()].filter((k) => fixed.test(k) && themed.get(k) !== base.get(k));
			expect({ dino, theme, changed }).toEqual({ dino, theme, changed: [] });
		}
	}
});

test("every other species repaints the whole theme: surfaces, ink, hairlines, focus and brand signals", () => {
	const roles = ["bg", "bg-band", "surface", "surface-sunken", "surface-hover", "surface-pressed", "line", "line-strong", "line-ui", "text-1", "text-2", "text-3", "surface-inverse", "focus", "accent", "brand-1", "brand-5", "brand-1-deep"];
	for (const theme of ["light", "dark"] as const) {
		const base = resolveTheme(css, theme);
		for (const dino of ["ptero", "brachio", "tricera"] as const) {
			const themed = resolveTheme(css, theme, dino);
			const same = roles.filter((k) => themed.get(k) === base.get(k));
			expect({ dino, theme, same }).toEqual({ dino, theme, same: [] });
		}
	}
});

test("brand signals are the species body stops; light text variants are the species AA stops", () => {
	for (const dino of SPECIES_IDS) {
		for (const theme of ["light", "dark"] as const) {
			const tokens = resolveTheme(css, theme, dino);
			expect([1, 2, 3, 4, 5].map((i) => tokens.get(`brand-${i}`))).toEqual([...SPECIES[dino].stops]);
			if (theme === "light") expect([1, 2, 3, 4, 5].map((i) => tokens.get(`brand-${i}-deep`))).toEqual([...SPECIES[dino].stopsDeep]);
		}
	}
});

test("species neutrals keep the T-rex lightness and take the species hue", () => {
	for (const theme of ["light", "dark"] as const) {
		const rex = resolveTheme(css, theme, "rex");
		for (const dino of ["ptero", "brachio", "tricera"] as const) {
			const tokens = resolveTheme(css, theme, dino);
			const hue = hexToOklch(SPECIES[dino].accent.light.solid).h;
			const off = Array.from({ length: 12 }, (_, i) => `n-${i + 1}`).filter((k) => {
				const a = hexToOklch(tokens.get(k) as string);
				const b = hexToOklch(rex.get(k) as string);
				return Math.abs(a.l - b.l) > 0.01 || hueDistance(a.h, hue) > 12 || a.c < 0.006;
			});
			expect({ dino, theme, off }).toEqual({ dino, theme, off: [] });
		}
	}
});

test("species surfaces resolve to the nearest theme: dark blocks outrank light ones", () => {
	for (const dino of SPECIES_IDS) {
		for (const sel of [`.dark[data-dino="${dino}"]`, `.dark [data-dino="${dino}"]`, `[data-dino="${dino}"] .dark`, `[data-dino="${dino}"] .light`]) expect(css).toContain(sel);
		expect(css.indexOf(`.dark[data-dino="${dino}"]`)).toBeGreaterThan(css.indexOf(`[data-dino="${dino}"] .light {`));
	}
});

test("nested .light/.dark frames inside a [data-dino] keep its accent", () => {
	for (const dino of ["ptero", "brachio", "tricera"] as const) {
		expect(css).toContain(`[data-dino="${dino}"] .light`);
		expect(css).toContain(`[data-dino="${dino}"] .dark`);
	}
});
