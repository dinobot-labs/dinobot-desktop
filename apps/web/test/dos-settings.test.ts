import { afterEach, expect, test } from "bun:test";
import { loadSettings, useSettings, THEMES } from "../src/lib/settings.ts";
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const initial = useSettings.getState();
afterEach(() => { useSettings.setState(initial); if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage"); });
test("theme transitions persist without altering typography or execution preferences", () => {
 const data = new Map<string, string>();
 Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
 expect(loadSettings().theme).toBe("system");
 useSettings.getState().set({ fontFamily: "malgun", fontSize: 19, toolsExpanded: true });
 for (const theme of THEMES) {
  const before = useSettings.getState();
  before.set({ theme });
  expect(useSettings.getState()).toEqual({ ...before, theme });
  expect(loadSettings().theme).toBe(theme);
  expect(loadSettings().fontSize).toBe(19);
  expect(loadSettings().fontFamily).toBe("malgun");
  expect(data.get("dn-theme")).toBe(theme);
 }
 data.set("dn-settings", JSON.stringify({ theme: "invalid" }));
 expect(loadSettings().theme).toBe("system");
});
