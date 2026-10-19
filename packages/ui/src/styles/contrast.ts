/**
 * WCAG 2.x contrast for the token themes (adapted from the landing's styleguide/contrast.ts). Pure: no DOM.
 * resolveTheme() reads tokens.css the way the browser cascades it on the root element for one theme.
 */
export type ContrastKind = "text" | "large" | "ui";
export interface ContrastPair {
	fg: string;
	bg: string;
	kind: ContrastKind;
	use: string;
}
export const MIN_RATIO: Record<ContrastKind, number> = { text: 4.5, large: 3, ui: 3 };

const SURFACES = ["bg", "surface", "bg-band", "surface-sunken"] as const;
const SIGNALS = ["mint", "teal", "cyan", "blue", "indigo", "red", "amber"] as const;
const STATUSES = ["running", "waiting", "success", "failed"] as const;
const BRANDS = ["brand-1", "brand-2", "brand-3", "brand-4", "brand-5"] as const;

export const CONTRAST_PAIRS: ContrastPair[] = [
	...SURFACES.flatMap((bg): ContrastPair[] => [
		{ fg: "text-1", bg, kind: "text", use: "Body text" },
		{ fg: "text-2", bg, kind: "text", use: "Secondary text" },
		{ fg: "text-3", bg, kind: "text", use: "Captions, meta, placeholders" },
		{ fg: "line-ui", bg, kind: "ui", use: "Control boundary" },
		{ fg: "focus", bg, kind: "ui", use: "Focus ring" },
		{ fg: "surface-inverse", bg, kind: "ui", use: "Primary (ink) button shape" },
		{ fg: "status-idle", bg, kind: "ui", use: "Pending mark" },
		{ fg: "status-cancelled", bg, kind: "ui", use: "Skipped / cancelled mark" },
		...STATUSES.flatMap((s): ContrastPair[] => [
			{ fg: `status-${s}`, bg, kind: "ui", use: `${s} mark` },
			{ fg: `status-${s}-fg`, bg, kind: "text", use: `${s} word` },
		]),
		...SIGNALS.map((s): ContrastPair => ({ fg: `${s}-deep`, bg, kind: "text", use: `${s} text` })),
		...BRANDS.map((s): ContrastPair => ({ fg: `${s}-deep`, bg, kind: "text", use: `${s} text (code tokens)` })),
	]),
	{ fg: "text-1", bg: "surface-hover", kind: "text", use: "Text on hover fill" },
	{ fg: "text-2", bg: "surface-hover", kind: "text", use: "Secondary text on hover fill, neutral badge" },
	{ fg: "text-3", bg: "surface-hover", kind: "text", use: "Meta on hover fill, inactive tab" },
	{ fg: "text-1", bg: "surface-pressed", kind: "text", use: "Text on selected row" },
	{ fg: "text-2", bg: "surface-pressed", kind: "text", use: "Secondary text on pressed fill" },
	{ fg: "text-inverse", bg: "surface-inverse", kind: "text", use: "Primary button label, tooltip" },
	{ fg: "text-1", bg: "selection", kind: "text", use: "Selected text" },
	// The theme accent (ADR 0100): the T-rex mint, the pterodactyl orchid or the brachiosaurus leaf.
	...SURFACES.map((bg): ContrastPair => ({ fg: "accent-deep", bg, kind: "text", use: "Accent text, links" })),
	{ fg: "accent-deep", bg: "accent-tint", kind: "text", use: "Accent badge label" },
	{ fg: "text-1", bg: "accent-tint", kind: "text", use: "Ink on accent tint" },
	{ fg: "text-1", bg: "accent-soft", kind: "text", use: "Ink on accent soft fill" },
	...SIGNALS.flatMap((s): ContrastPair[] => [
		{ fg: `${s}-deep`, bg: `${s}-tint`, kind: "text", use: `${s} badge label` },
		{ fg: "text-1", bg: `${s}-tint`, kind: "text", use: `Ink on ${s} tint` },
	]),
	...STATUSES.flatMap((s): ContrastPair[] => [
		{ fg: `status-${s}-fg`, bg: `status-${s}-tint`, kind: "text", use: `${s} chip` },
		{ fg: `status-${s}`, bg: `status-${s}-tint`, kind: "ui", use: `${s} mark on its chip` },
		{ fg: "text-1", bg: `status-${s}-tint`, kind: "text", use: `Ink on ${s} tint (ask card)` },
	]),
];

export function parseHex(value: string): [number, number, number] | null {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
	if (!m) return null;
	const raw = m[1] as string;
	const hex = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw;
	return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
export function relativeLuminance([r, g, b]: [number, number, number]): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(a: string, b: string): number | null {
	const x = parseHex(a);
	const y = parseHex(b);
	if (!x || !y) return null;
	const [hi, lo] = [relativeLuminance(x), relativeLuminance(y)].sort((p, q) => q - p) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/** Top-level rules (selector, body) of a stylesheet, skipping at-rules such as @media. */
function topLevelRules(css: string): { selectors: string[]; body: string }[] {
	const s = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules: { selectors: string[]; body: string }[] = [];
	let i = 0;
	while (i < s.length) {
		const open = s.indexOf("{", i);
		if (open < 0) break;
		const prelude = s.slice(i, open).trim();
		let depth = 1;
		let j = open + 1;
		for (; j < s.length && depth > 0; j++) {
			if (s[j] === "{") depth++;
			else if (s[j] === "}") depth--;
		}
		if (!prelude.startsWith("@")) rules.push({ selectors: prelude.split(",").map((p) => p.trim()), body: s.slice(open + 1, j - 1) });
		i = j;
	}
	return rules;
}

/**
 * Resolved custom properties of the root element in one theme (":root" for light, ":root.dark" for dark), optionally
 * under a dinosaur theme (`<html data-dino="ptero">`, ADR 0100). Rules apply in file order; tokens.css keeps every
 * more specific block (.dark[data-dino]) after the blocks it overrides, so file order equals the cascade here.
 */
export function resolveTheme(css: string, theme: "light" | "dark", dino?: string): Map<string, string> {
	const applies = (sel: string) =>
		sel === ":root" ||
		(theme === "dark" && sel === ".dark") ||
		(dino !== undefined && (sel === "[data-dino]" || sel === `[data-dino="${dino}"]` || (theme === "dark" && sel === `.dark[data-dino="${dino}"]`)));
	const raw = new Map<string, string>();
	for (const rule of topLevelRules(css)) {
		if (!rule.selectors.some(applies)) continue;
		for (const m of rule.body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) raw.set(m[1] as string, (m[2] as string).trim());
	}
	const out = new Map<string, string>();
	const resolve = (name: string, seen: Set<string>): string | undefined => {
		if (out.has(name)) return out.get(name);
		const v = raw.get(name);
		if (v === undefined || seen.has(name)) return undefined;
		seen.add(name);
		const ref = /^var\(--([\w-]+)\)$/.exec(v);
		const r = ref ? resolve(ref[1] as string, seen) : v;
		if (r !== undefined) out.set(name, r);
		return r;
	};
	for (const k of raw.keys()) resolve(k, new Set());
	return out;
}

export interface PairResult extends ContrastPair {
	fgValue: string;
	bgValue: string;
	ratio: number | null;
	pass: boolean;
}
export function evaluate(tokens: Map<string, string>, pairs: ContrastPair[] = CONTRAST_PAIRS): PairResult[] {
	return pairs.map((p) => {
		const fgValue = tokens.get(p.fg) ?? "";
		const bgValue = tokens.get(p.bg) ?? "";
		const ratio = contrastRatio(fgValue, bgValue);
		return { ...p, fgValue, bgValue, ratio, pass: ratio !== null && Math.floor(ratio * 100) / 100 >= MIN_RATIO[p.kind] };
	});
}
