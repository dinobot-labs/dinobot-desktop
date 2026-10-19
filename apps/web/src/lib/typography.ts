/** Bundled faces work offline; other choices fall back when not installed. */
const KOREAN_FALLBACK = '"Pretendard Variable", "Pretendard", system-ui, sans-serif';
/** `local` lists the family names of a system font; its install state is detected at runtime, never assumed. */
export const FONT_OPTIONS = [
	{ value: "default", label: "Geist + Pretendard (기본 · 내장)", family: null, local: null },
	{ value: "pretendard", label: "Pretendard (내장)", family: KOREAN_FALLBACK, local: null },
	{ value: "system", label: "시스템 기본", family: `system-ui, ${KOREAN_FALLBACK}`, local: null },
	{ value: "noto-sans", label: "Noto Sans KR", family: `"Noto Sans KR", "Noto Sans CJK KR", ${KOREAN_FALLBACK}`, local: ["Noto Sans KR", "Noto Sans CJK KR"] },
	{ value: "nanum-gothic", label: "나눔고딕", family: `"Nanum Gothic", "나눔고딕", ${KOREAN_FALLBACK}`, local: ["Nanum Gothic", "나눔고딕"] },
	{ value: "malgun", label: "맑은 고딕 (Windows)", family: `"Malgun Gothic", ${KOREAN_FALLBACK}`, local: ["Malgun Gothic", "맑은 고딕"] },
	{ value: "apple-gothic", label: "Apple SD Gothic Neo (macOS)", family: `"Apple SD Gothic Neo", ${KOREAN_FALLBACK}`, local: ["Apple SD Gothic Neo"] },
	{ value: "noto-serif", label: "Noto Serif KR (명조)", family: `"Noto Serif KR", "Noto Serif CJK KR", ${KOREAN_FALLBACK}`, local: ["Noto Serif KR", "Noto Serif CJK KR"] },
] as const;
export type FontFamilySetting = (typeof FONT_OPTIONS)[number]["value"];
export type FontOption = (typeof FONT_OPTIONS)[number];

/** Width of `text` rendered with a CSS font shorthand. */
export type MeasureText = (font: string, text: string) => number;

const PROBE_TEXT = "가나다라마바사 mmmmmmmmmmlli WwQq 0123456789";
const PROBE_BASES = ["monospace", "serif", "sans-serif"] as const;

/** A family is installed when it changes the rendered width against at least one generic base; a missing
 * family falls through to that base and measures identically. Comparing three bases avoids a false
 * negative when the font happens to be the system default for one of them. */
export function isFontInstalled(families: readonly string[], measure: MeasureText): boolean {
	return families.some((name) => PROBE_BASES.some((base) => {
		const quoted = `"${name.replace(/["\\]/g, "")}"`;
		return measure(`72px ${quoted}, ${base}`, PROBE_TEXT) !== measure(`72px ${base}`, PROBE_TEXT);
	}));
}

/** Canvas-backed measurer, or null outside a DOM (tests, SSR). */
export function canvasMeasure(doc: Document | undefined = globalThis.document): MeasureText | null {
	const context = doc?.createElement?.("canvas").getContext?.("2d");
	if (!context) return null;
	return (font, text) => { context.font = font; return context.measureText(text).width; };
}

/** Select label: system fonts show their detected state; unknown state (no measurer) shows no claim. */
export function fontLabel(font: FontOption, measure: MeasureText | null): string {
	if (!font.local || !measure) return font.label;
	return `${font.label} · ${isFontInstalled(font.local, measure) ? "설치됨" : "설치 필요"}`;
}
export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 20;

export function normalizeTypography(value: { fontFamily?: unknown; fontSize?: unknown }) {
	return {
		fontFamily: FONT_OPTIONS.find((font) => font.value === value.fontFamily)?.value ?? "default",
		fontSize: typeof value.fontSize === "number" && Number.isFinite(value.fontSize)
			? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(value.fontSize)))
			: DEFAULT_FONT_SIZE,
	};
}

/** Scale rem-based UI and prose together without changing the code font token. */
export function applyTypography(style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">, value: { fontFamily?: unknown; fontSize?: unknown }): void {
	const settings = normalizeTypography(value);
	const family = FONT_OPTIONS.find((font) => font.value === settings.fontFamily)?.family;
	if (family) style.setProperty("--font-ui", family);
	else style.removeProperty("--font-ui");
	if (settings.fontSize === DEFAULT_FONT_SIZE) style.removeProperty("font-size");
	else style.setProperty("font-size", `${16 * settings.fontSize / DEFAULT_FONT_SIZE}px`);
}
