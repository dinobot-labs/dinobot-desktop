/**
 * OKLCH <-> sRGB hex (Björn Ottosson's OKLab). Pure: no DOM. Used by the dinosaur theme palette generator
 * (scripts/dino-palette.ts) and its tests: every species neutral keeps the T-rex lightness and takes the species hue.
 */
export interface Oklch {
	l: number;
	c: number;
	h: number;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): Oklch {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) throw new Error(`not a #rrggbb color: ${hex}`);
	const n = Number.parseInt(m[1] as string, 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255)) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
	const h = (Math.atan2(B, A) * 180) / Math.PI;
	return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
	const A = c * Math.cos((h * Math.PI) / 180);
	const B = c * Math.sin((h * Math.PI) / 180);
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** The hex of an OKLCH color; chroma is reduced (lightness and hue kept) until it fits sRGB. */
export function oklchToHex(color: Oklch): string {
	let c = color.c;
	let rgb = oklchToLinear({ ...color, c });
	while (!inGamut(rgb) && c > 0) {
		c = Math.max(0, c - 0.001);
		rgb = oklchToLinear({ ...color, c });
	}
	return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Shortest angular distance between two hues, in degrees. */
export const hueDistance = (a: number, b: number) => {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
};
