import { afterEach, beforeEach, expect, test } from "bun:test";
import { loadSettings, setProjectHidden, useSettings } from "../src/lib/settings.ts";
import { GENERAL_ID, groupProjects } from "../src/state/projects.ts";
import type { ThreadEntry } from "../src/state/app.ts";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalSettings = useSettings.getState();
let saved: Map<string, string>;
beforeEach(() => {
 saved = new Map();
 Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } } });
 useSettings.setState({ hiddenProjects: [] });
});
afterEach(() => {
 useSettings.setState(originalSettings);
 if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
 else Reflect.deleteProperty(globalThis, "localStorage");
});

const threads: ThreadEntry[] = [
 { key: "tui:a", channel: "tui", cwd: "C:/work/Alpha", draft: true },
 { key: "tui:b", channel: "tui", cwd: "C:/work/Beta" },
 { key: "tui:g", channel: "tui" },
];
const layout = (all = false) => groupProjects(threads, { cwdOf: (t) => t.cwd, activeKey: "tui:a", hiddenProjects: new Set(useSettings.getState().hiddenProjects), all });

test("remove survives reload, overrides sticky rows, preserves threads, other folders and general; explicit add restores", () => {
 const before = structuredClone(threads);
 saved.set("dn-thread-cwd", JSON.stringify({ "tui:a": "C:/work/Alpha" }));
 setProjectHidden("C:/work/ALPHA/", true);
 setProjectHidden("c:/work/alpha", true);
 expect(useSettings.getState().hiddenProjects).toEqual(["c:/work/alpha"]);
 expect(layout().projects.map((p) => p.name)).toEqual(["Beta"]);
 expect(layout().general?.threads).toEqual([threads[2]!]);
 useSettings.setState(loadSettings());
 expect(layout().projects.map((p) => p.name)).toEqual(["Beta"]);
 expect(layout().moreProjects).toEqual([]);
 expect(threads).toEqual(before);
 expect(saved.get("dn-thread-cwd")).toBe(JSON.stringify({ "tui:a": "C:/work/Alpha" }));
 expect(layout(true).projects.flatMap((p) => p.threads)).toContain(threads[0]!);
 setProjectHidden("C:/work/Alpha", false);
 expect(layout().projects.map((p) => p.name).sort()).toEqual(["Alpha", "Beta"]);
 expect(loadSettings().hiddenProjects).toEqual([]);
});

test("invalid persisted preferences are ignored and Windows paths normalized", () => {
 for (const hiddenProjects of [null, false, {}, "bad"]) {
  saved.set("dn-settings", JSON.stringify({ hiddenProjects }));
  expect(loadSettings().hiddenProjects).toEqual([]);
 }
 saved.set("dn-settings", JSON.stringify({ hiddenProjects: [null, 3, "", GENERAL_ID, "C:/Repo/", "c:/repo"] }));
 expect(loadSettings().hiddenProjects).toEqual(["c:/repo"]);
 setProjectHidden(GENERAL_ID, true);
 setProjectHidden("", true);
 expect(useSettings.getState().hiddenProjects).toEqual([]);
});
