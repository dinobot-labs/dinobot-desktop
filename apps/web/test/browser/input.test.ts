import { describe, expect, test } from "bun:test";
import { browserKey, browserWheel, framePoint, jpegSource, type BrowserKey } from "../../src/panel/browser-input.ts";

describe("mirrored browser coordinates", () => {
	test("wide page in a tall frame excludes top/bottom letterbox", () => {
		const box = { left: 10, top: 20, width: 400, height: 500 };
		expect(framePoint(box, 1200, 600, 210, 270)).toEqual({ x: 600, y: 300 });
		expect(framePoint(box, 1200, 600, 10, 170)).toEqual({ x: 0, y: 0 });
		expect(framePoint(box, 1200, 600, 210, 169)).toBeNull();
		expect(framePoint(box, 1200, 600, 210, 370)).toBeNull();
		expect(framePoint(box, 1200, 600, 410, 270)).toBeNull();
	});
	test("tall page excludes side letterbox and uses CSS, not device, pixels", () => {
		const box = { left: 50, top: 100, width: 600, height: 400 };
		expect(framePoint(box, 300, 600, 350, 300)).toEqual({ x: 150, y: 300 });
		expect(framePoint(box, 300, 600, 249, 300)).toBeNull();
		expect(framePoint(box, 300, 600, 450, 300)).toBeNull();
	});
	test("fractional points floor into the viewport, including its last pixel", () => {
		const box = { left: 0, top: 0, width: 100, height: 50 };
		expect(framePoint(box, 1000, 500, 99.99, 49.99)).toEqual({ x: 999, y: 499 });
		expect(framePoint(box, 1000, 500, -0.01, 0)).toBeNull();
	});
	test("undecoded/zero/non-finite geometry is rejected", () => {
		const box = { left: 0, top: 0, width: 400, height: 200 };
		for (const bad of [0, -1, NaN, Infinity]) expect(framePoint(box, bad, 100, 1, 1)).toBeNull();
		expect(framePoint({ ...box, height: 0 }, 100, 100, 1, 1)).toBeNull();
		expect(framePoint(box, 100, 100, Infinity, 1)).toBeNull();
	});
});

const key = (value: string, extras: Partial<BrowserKey> = {}) => browserKey({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extras });
describe("browser keyboard and wheel boundaries", () => {
	test("text, Unicode, dead keys and IME use textarea input only", () => {
		for (const value of ["a", "한", "🦖", "Dead", "Process", "Unidentified", "Control"]) expect(key(value)).toBeNull();
		expect(key("Enter", { isComposing: true })).toBeNull();
		expect(key("q", { altGraph: true, ctrlKey: true, altKey: true })).toBeNull();
	});
	test("special keys and selection shortcuts use Playwright names", () => {
		expect(key("Enter")).toBe("Enter");
		expect(key("Tab", { shiftKey: true })).toBe("Shift+Tab");
		expect(key("A", { ctrlKey: true })).toBe("Control+a");
		expect(key("ArrowLeft", { metaKey: true, shiftKey: true })).toBe("Meta+Shift+ArrowLeft");
		expect(key("ArrowLeft", { altKey: true })).toBe("Alt+ArrowLeft");
	});
	test("paste shortcuts are handled only by the focused paste event", () => {
		expect(key("v", { ctrlKey: true })).toBeNull();
		expect(key("V", { metaKey: true, shiftKey: true })).toBeNull();
		expect(key("Insert", { shiftKey: true })).toBeNull();
	});
	test("wheel converts line/page deltas and clamps both axes", () => {
		expect(browserWheel(2, -3, 1, 900)).toEqual({ kind: "wheel", dx: 32, dy: -48 });
		expect(browserWheel(0, 1, 2, 900)).toEqual({ kind: "wheel", dx: 0, dy: 900 });
		expect(browserWheel(1e12, -1e12, 0, 900)).toEqual({ kind: "wheel", dx: 1024, dy: -1024 });
		expect(browserWheel(0, 0, 0, 900)).toBeNull();
		expect(browserWheel(NaN, 1, 0, 900)).toBeNull();
		expect(browserWheel(0, 1, 8, 900)).toBeNull();
	});
});

describe("local JPEG source boundary", () => {
	test("accepts raw or prefixed JPEG only", () => {
		expect(jpegSource("/9j/AA==")).toBe("data:image/jpeg;base64,/9j/AA==");
		expect(jpegSource("data:image/jpeg;base64,/9j/AA==")).toBe("data:image/jpeg;base64,/9j/AA==");
		for (const bad of [undefined, "", "https://x/frame.jpg", "data:image/svg+xml,<svg/>", "data:image/png;base64,AAAA", "/9j/<script>"]) expect(jpegSource(bad)).toBeNull();
	});
});
