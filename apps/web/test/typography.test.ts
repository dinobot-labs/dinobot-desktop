import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadSettings, useSettings } from "../src/lib/settings.ts";
import { applyTypography, canvasMeasure, FONT_OPTIONS, fontLabel, isFontInstalled, type MeasureText, normalizeTypography } from "../src/lib/typography.ts";
import { startTypographySync } from "../src/lib/typography-sync.ts";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const initialState = useSettings.getState();
let saved: Map<string, string>;
beforeEach(() => {
	saved = new Map();
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
		getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => { saved.set(key, value); },
	} });
	useSettings.setState(initialState, true);
});
afterEach(() => {
	useSettings.setState(initialState, true);
	if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
	else Reflect.deleteProperty(globalThis, "localStorage");
});

function styleFixture() {
	const values = new Map<string, string>([["--font-code", "monospace"]]);
	return { values, style: {
		setProperty: (key: string, value: string | null) => { values.set(key, value ?? ""); },
		removeProperty: (key: string) => { const previous = values.get(key) ?? ""; values.delete(key); return previous; },
	} };
}

describe("typography settings", () => {
	test("defaults and legacy settings retain current appearance", () => {
		expect(loadSettings()).toMatchObject({ fontFamily: "default", fontSize: 14 });
		saved.set("dn-settings", JSON.stringify({ theme: "dark", userName: "tester" }));
		expect(loadSettings()).toMatchObject({ fontFamily: "default", fontSize: 14, theme: "dark", userName: "tester" });
	});
	test("malformed stored values cannot inject CSS or non-finite sizes", () => {
		for (const raw of ["{", "null", "[]", "42", '"string"', '{"fontFamily":"evil; color:red", "fontSize":"20"}', '{"fontFamily":{}, "fontSize":null}', '{"fontSize":1e999}']) {
			saved.set("dn-settings", raw);
			expect(loadSettings()).toMatchObject({ fontFamily: "default", fontSize: 14 });
		}
	});
	test("finite sizes are rounded and clamped at both boundaries", () => {
		for (const [input, expected] of [[-1, 12], [12, 12], [16.6, 17], [20, 20], [999, 20], [NaN, 14], [Infinity, 14], [-Infinity, 14]] as const) {
			expect(normalizeTypography({ fontSize: input }).fontSize).toBe(expected);
		}
		for (const font of FONT_OPTIONS) expect(normalizeTypography({ fontFamily: font.value }).fontFamily).toBe(font.value);
	});
	test("the existing setter persists normalized preferences and reload restores them", () => {
		useSettings.getState().set({ fontFamily: "pretendard", fontSize: 18, userName: "tester" });
		expect(loadSettings()).toMatchObject({ fontFamily: "pretendard", fontSize: 18, userName: "tester" });
		expect(JSON.parse(saved.get("dn-settings")!).set).toBeUndefined();
		useSettings.getState().set({ fontSize: 100 });
		expect(loadSettings().fontSize).toBe(20);
		useSettings.getState().set({ fontSize: NaN });
		expect(loadSettings().fontSize).toBe(14);
	});
	test("stored finite out-of-range values are normalized on load", () => {
		for (const [input, expected] of [[-4, 12], [100, 20]] as const) {
			saved.set("dn-settings", JSON.stringify({ fontSize: input }));
			expect(loadSettings().fontSize).toBe(expected);
		}
	});
	test("unavailable storage does not block immediate settings", () => {
		Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("denied"); } });
		expect(loadSettings().fontSize).toBe(14);
		useSettings.getState().set({ fontSize: 18 });
		expect(useSettings.getState().fontSize).toBe(18);
	});
	test("application changes UI font and root scale but never the code font", () => {
		const { style, values } = styleFixture();
		applyTypography(style, { fontFamily: "pretendard", fontSize: 20 });
		expect(values.get("--font-ui")).toContain("Pretendard Variable");
		expect(parseFloat(values.get("font-size")!) * 0.875).toBeCloseTo(20);
		expect(values.get("--font-code")).toBe("monospace");
		applyTypography(style, { fontFamily: "default", fontSize: 14 });
		expect(values.has("--font-ui")).toBe(false);
		expect(values.has("font-size")).toBe(false);
	});
	test("startup restores settings, updates synchronously and unsubscribes cleanly", () => {
		saved.set("dn-settings", JSON.stringify({ fontFamily: "noto-sans", fontSize: 16 }));
		useSettings.setState(loadSettings());
		const { style, values } = styleFixture();
		const stop = startTypographySync(style);
		try {
			expect(values.get("--font-ui")).toContain("Noto Sans KR");
			expect(parseFloat(values.get("font-size")!) * 0.875).toBeCloseTo(16);
			useSettings.getState().set({ fontFamily: "pretendard", fontSize: 18 });
			expect(values.get("--font-ui")).toStartWith('"Pretendard Variable"');
			expect(parseFloat(values.get("font-size")!) * 0.875).toBeCloseTo(18);
			useSettings.getState().set({ fontFamily: "default", fontSize: 14 });
			expect(values.has("font-size")).toBe(false);
		} finally { stop(); }
		useSettings.getState().set({ fontSize: 20 });
		expect(values.has("font-size")).toBe(false);
	});
});

/** Simulates a renderer: each family in the font list falls through until an installed one (or the generic base) is hit. */
function fakeMeasure(installed: Record<string, number>): MeasureText {
	const bases: Record<string, number> = { monospace: 600, serif: 500, "sans-serif": 400 };
	return (font) => {
		for (const raw of font.replace(/^\d+px\s+/, "").split(",")) {
			const name = raw.trim().replace(/^"|"$/g, "");
			if (name in installed) return installed[name]!;
			if (name in bases) return bases[name]!;
		}
		throw new Error("no base in " + font);
	};
}

describe("font install detection", () => {
	const apple = FONT_OPTIONS.find((font) => font.value === "apple-gothic")!;
	const noto = FONT_OPTIONS.find((font) => font.value === "noto-sans")!;
	test("an installed system font is not labeled as needing install", () => {
		const measure = fakeMeasure({ "Apple SD Gothic Neo": 450 });
		expect(isFontInstalled(apple.local!, measure)).toBe(true);
		expect(fontLabel(apple, measure)).toBe("Apple SD Gothic Neo (macOS) · 설치됨");
		expect(fontLabel(noto, measure)).toBe("Noto Sans KR · 설치 필요");
	});
	test("a font that equals one generic default is still detected through the other bases", () => {
		expect(isFontInstalled(apple.local!, fakeMeasure({ "Apple SD Gothic Neo": 400 }))).toBe(true);
	});
	test("any alias counts, e.g. Noto Sans CJK KR for Noto Sans KR", () => {
		expect(fontLabel(noto, fakeMeasure({ "Noto Sans CJK KR": 420 }))).toBe("Noto Sans KR · 설치됨");
	});
	test("bundled options and unknown state make no install claim", () => {
		expect(fontLabel(FONT_OPTIONS[1], fakeMeasure({}))).toBe("Pretendard (내장)");
		expect(fontLabel(apple, null)).toBe("Apple SD Gothic Neo (macOS)");
		expect(canvasMeasure(undefined)).toBeNull();
		for (const font of FONT_OPTIONS) expect(font.label).not.toContain("설치 필요");
	});
});
