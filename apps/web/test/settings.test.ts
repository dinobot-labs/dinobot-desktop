import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SPECIES_IDS } from "@dinobot/ui/brand";
import { loadSettings } from "../src/lib/settings.ts";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let saved: Map<string, string>;
beforeEach(() => {
	saved = new Map();
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
		getItem: (key: string) => saved.get(key) ?? null,
		setItem: (key: string, value: string) => { saved.set(key, value); },
	} });
});
afterEach(() => {
	if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
	else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("thinking expansion setting", () => {
	test("thinking blocks start collapsed by default", () => {
		expect(loadSettings().thinkingExpanded).toBe(false);
	});
	test("the legacy showThinking: true saved by older builds no longer expands them", () => {
		saved.set("dn-settings", JSON.stringify({ showThinking: true, theme: "dark" }));
		const s = loadSettings();
		expect(s.thinkingExpanded).toBe(false);
		expect(s.theme).toBe("dark");
		expect("showThinking" in s).toBe(false);
	});
	test("an explicit Ctrl+E choice persists", () => {
		saved.set("dn-settings", JSON.stringify({ thinkingExpanded: true }));
		expect(loadSettings().thinkingExpanded).toBe(true);
	});
});

describe("work panel setting", () => {
	test("the right work panel starts collapsed by default", () => {
		expect(loadSettings().panelOpen).toBe(false);
	});
	test("an explicit open choice persists", () => {
		saved.set("dn-settings", JSON.stringify({ panelOpen: true }));
		expect(loadSettings().panelOpen).toBe(true);
	});
});

describe("DAG view setting", () => {
	test("the work panel shows the DAG as a graph by default", () => {
		expect(loadSettings().dagLayout).toBe("graph");
	});
	test("the legacy dagView: \"rail\" saved by older builds no longer forces the list", () => {
		saved.set("dn-settings", JSON.stringify({ dagView: "rail", theme: "dark" }));
		const s = loadSettings();
		expect(s.dagLayout).toBe("graph");
		expect(s.theme).toBe("dark");
		expect("dagView" in s).toBe(false);
	});
	test("an explicit list choice persists", () => {
		saved.set("dn-settings", JSON.stringify({ dagLayout: "rail" }));
		expect(loadSettings().dagLayout).toBe("rail");
	});
});

describe("dinosaur theme setting (ADR 0100)", () => {
	test("defaults to the T-rex", () => {
		expect(loadSettings().dino).toBe("rex");
	});
	test("a saved species persists", () => {
		saved.set("dn-settings", JSON.stringify({ dino: "ptero" }));
		expect(loadSettings().dino).toBe("ptero");
		saved.set("dn-settings", JSON.stringify({ dino: "brachio", theme: "dark" }));
		expect(loadSettings()).toMatchObject({ dino: "brachio", theme: "dark" });
	});
	test("invalid saved values fall back to the T-rex", () => {
		for (const dino of ["stego", "", 3, null, ["ptero"], { id: "ptero" }, "PTERO", "__proto__"]) {
			saved.set("dn-settings", JSON.stringify({ dino }));
			expect(loadSettings().dino).toBe("rex");
		}
	});
	test("setting it persists the choice and the early-paint key", async () => {
		const { useSettings } = await import("../src/lib/settings.ts");
		useSettings.getState().set({ dino: "brachio" });
		expect(useSettings.getState().dino).toBe("brachio");
		expect(JSON.parse(saved.get("dn-settings") ?? "{}").dino).toBe("brachio");
		expect(saved.get("dn-dino")).toBe("brachio");
		expect(loadSettings().dino).toBe("brachio");
		useSettings.getState().set({ dino: "rex" });
	});
});

test("index.html applies the saved dinosaur theme before the first paint and knows every species", () => {
	const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
	expect(html).toContain('localStorage.getItem("dn-dino")');
	expect(html).toContain("documentElement.dataset.dino");
	for (const id of SPECIES_IDS) expect(html).toContain(`"${id}"`);
});
