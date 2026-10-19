/**
 * Generates the dinosaur theme surfaces (ADR 0100, "whole theme" follow-up) for tokens.css.
 *
 *   bun packages/ui/scripts/dino-palette.ts
 *
 * Every species neutral keeps the T-rex lightness (OKLCH L) of the same step and takes the species accent hue with
 * the chroma of CHROMA below, so contrast stays where the T-rex palette put it while the paper, ink and hairlines
 * read as the species. The brand signals are the species body stops; their dark text variants are lifted to
 * L 0.84 (the T-rex dark -deep lightness).
 *
 *   bun packages/ui/scripts/dino-palette.ts --write   rewrites the species blocks in tokens.css
 *
 * test/contrast.test.ts checks the result (contrast, lightness, hue) and qa/dino-theme.mjs pins the rendered colors.
 */
import { SPECIES } from "../src/brand/species.ts";
import { hexToOklch, oklchToHex } from "../src/styles/oklch.ts";

const REX = {
	light: ["#f9fbfa", "#f3f6f5", "#ecefee", "#e3e7e5", "#d7dcda", "#c7ccca", "#a9aeac", "#838785", "#676b6a", "#505352", "#303231", "#141515"],
	dark: ["#141615", "#191c1b", "#222625", "#2a2f2e", "#2e3433", "#3b4241", "#5a6461", "#7a8582", "#909d99", "#b7c0bd", "#d4dad8", "#ecf0ee"],
	surface: { light: "#ffffff", dark: "#1b1e1d" },
};

/** Chroma per neutral step n-1..n-12: visible on paper and night, quieter on ink. */
export const CHROMA = {
	light: [0.013, 0.017, 0.019, 0.021, 0.022, 0.022, 0.022, 0.022, 0.021, 0.019, 0.015, 0.011],
	dark: [0.014, 0.017, 0.019, 0.021, 0.022, 0.024, 0.025, 0.025, 0.024, 0.02, 0.015, 0.01],
	surface: { light: 0.006, dark: 0.018 },
};

export const DARK_DEEP_L = 0.84;

export function palette(id: "ptero" | "brachio" | "tricera", theme: "light" | "dark") {
	const hue = hexToOklch(SPECIES[id].accent.light.solid).h;
	const n = REX[theme].map((hex, i) => oklchToHex({ l: hexToOklch(hex).l, c: CHROMA[theme][i] as number, h: hue }));
	const surfaceL = theme === "light" ? 0.995 : hexToOklch(REX.surface.dark).l;
	const surface = oklchToHex({ l: surfaceL, c: CHROMA.surface[theme], h: hue });
	const deep = theme === "light" ? [...SPECIES[id].stopsDeep] : SPECIES[id].stops.map((s) => {
		const o = hexToOklch(s);
		return oklchToHex({ l: DARK_DEEP_L, c: Math.min(o.c, 0.13), h: o.h });
	});
	return { n, surface, brand: [...SPECIES[id].stops], deep };
}

/** The light and dark tokens.css blocks of one species; rex repeats the defaults so a T-rex frame resets. */
export function blocks(id: "rex" | "ptero" | "brachio" | "tricera"): string {
	const out: string[] = [];
	for (const theme of ["light", "dark"] as const) {
		const sel = theme === "light" ? [`[data-dino="${id}"]`, `[data-dino="${id}"] .light`] : [`.dark[data-dino="${id}"]`, `.dark [data-dino="${id}"]`, `[data-dino="${id}"] .dark`];
		const lines: string[] = [];
		if (id === "rex") {
			REX[theme].forEach((v, i) => lines.push(`--n-${i + 1}: ${v};`));
			lines.push(`--surface: ${theme === "light" ? "var(--white)" : REX.surface.dark};`);
		} else {
			const p = palette(id, theme);
			p.n.forEach((v, i) => lines.push(`--n-${i + 1}: ${v};`));
			lines.push(`--surface: ${p.surface};`);
			p.brand.forEach((v, i) => lines.push(`--brand-${i + 1}: ${v};`));
			p.deep.forEach((v, i) => lines.push(`--brand-${i + 1}-deep: ${v};`));
			lines.push("--focus: var(--brand-5-deep);");
		}
		if (theme === "light") lines.push("--surface-sunken: var(--n-2);", "--text-inverse-2: var(--n-6);", "--dino-socket: var(--white);");
		else lines.push("--surface-sunken: var(--n-1);", "--text-inverse-2: var(--n-7);", "--dino-socket: var(--n-12);");
		out.push(`${sel.join(",\n")} {\n${lines.map((l) => `\t${l}`).join("\n")}\n}`);
	}
	return out.join("\n");
}

const BEGIN = "/* @generated dino-palette begin */";
const END = "/* @generated dino-palette end */";

if (import.meta.main) {
	const css = (["rex", "ptero", "brachio", "tricera"] as const).map(blocks).join("\n");
	if (process.argv.includes("--write")) {
		const path = new URL("../src/styles/tokens.css", import.meta.url);
		const file = await Bun.file(path).text();
		const a = file.indexOf(BEGIN);
		const b = file.indexOf(END);
		if (a < 0 || b < a) throw new Error("tokens.css has no @generated dino-palette markers");
		await Bun.write(path, `${file.slice(0, a + BEGIN.length)}\n${css}\n${file.slice(b)}`);
		console.log("tokens.css species blocks rewritten");
	} else console.log(css);
}
