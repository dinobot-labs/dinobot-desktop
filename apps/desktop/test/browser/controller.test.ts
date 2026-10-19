import { describe, expect, test } from "bun:test";
import type { BrowserViewState } from "../../src/browser-types.ts";
import { BrowserController, type BrowserTransport, type HostResult } from "../../src/features/browser/controller.ts";
import { publicError, validateCall } from "../../src/features/browser/validation.ts";

function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const state: BrowserViewState = { connected: false, mode: "dedicated", control: "agent", tabs: [], current: 0, url: "", title: "", width: 1000, height: 700 };
class FakeHost implements BrowserTransport {
 calls: { cmd: string; args: Record<string, unknown> }[] = [];
 closed = 0;
 onCall?: (cmd: string) => Promise<void>;
 async call(cmd: string, args: Record<string, unknown>): Promise<HostResult> {
  this.calls.push({ cmd, args }); await this.onCall?.(cmd);
  return { text: "ok", ui: { ok: true, state: { ...state }, ...(cmd === "ui_profiles" ? { profiles: [{ id: "Default", name: "Default" }] } : {}), ...(cmd === "ui_import" ? { imported: 2, skipped: 1 } : {}) } };
 }
 async close() { this.closed++; }
}

describe("desktop browser controller", () => {
 test("state/frame/profiles are non-mutating and route to private UI host operations", async () => {
  const host = new FakeHost(); const c = new BrowserController(host);
  expect((await c.ui("state")).state?.control).toBe("agent");
  await c.ui("frame"); expect((await c.ui("profiles")).profiles?.[0]?.id).toBe("Default");
  expect(host.calls.map(x => x.cmd)).toEqual(["ui_state", "ui_frame", "ui_profiles"]);
  await c.close();
 });
 test("UI navigation/input/import need takeover, and import must be explicitly confirmed", async () => {
  const host = new FakeHost(); const c = new BrowserController(host);
  for (const [action, args] of [["open", { url: "https://example.org" }], ["input", { kind: "text", text: "hi" }], ["import", { profile: "Default", confirmed: true }]] as const) expect((await c.ui(action, args)).error).toContain("AgentControl");
  expect(host.calls).toEqual([]);
  expect((await c.ui("takeover")).state?.control).toBe("user");
  expect((await c.ui("import", { profile: "Default", confirmed: false })).error).toContain("InvalidArguments");
  expect((await c.ui("import", { profile: "../Cookies", confirmed: true })).ok).toBe(false);
  expect((await c.ui("import", { profile: "Default", confirmed: true })).imported).toBe(2);
  await c.ui("input", { kind: "click", x: 12, y: 34 });
  await c.ui("open", { url: "https://example.org", newTab: true });
  expect(host.calls.slice(-3).map(x => x.cmd)).toEqual(["ui_input", "open", "ui_state"]);
  await c.close();
 });
 test("takeover waits for prior agent action; agent requests queued behind takeover are denied", async () => {
  const host = new FakeHost(); const c = new BrowserController(host); const entered = deferred(); const release = deferred();
  host.onCall = async cmd => { if (cmd === "open") { entered.resolve(); await release.promise; } };
  const agent = c.agent(8, "open", { url: "https://example.org" }); await entered.promise;
  const takeover = c.ui("takeover"); const laterAgent = c.agent(9, "click", { ref: "e1" });
  expect(c.control).toBe("agent"); expect(host.calls.map(x => x.cmd)).toEqual(["open"]);
  release.resolve(); expect((await agent).ok).toBe(true); expect((await takeover).state?.control).toBe("user");
  expect((await laterAgent).ok).toBe(false); expect(host.calls.map(x => x.cmd)).toEqual(["open", "ui_state"]);
  expect((await c.agent(10, "status", {})).ok).toBe(false); await c.close();
 });
 test("pre-aborted and same-turn aborted agent actions never dispatch or expose the abort reason", async () => {
  const host = new FakeHost(); const c = new BrowserController(host);
  const cancelled = new AbortController(); cancelled.abort(new Error("Cookie: secret-session"));
  const sameTurn = new AbortController();
  const queued = c.agent(21, "click", { ref: "e1" }, sameTurn.signal);
  sameTurn.abort(new Error("Bearer secret-token"));
  const expected = "BrowserCancelled: the request was cancelled before the browser action started.";
  expect(await c.agent(20, "click", { ref: "e1" }, cancelled.signal)).toEqual({ id: 20, ok: false, error: expected });
  expect(await queued).toEqual({ id: 21, ok: false, error: expected });
  expect(host.calls).toEqual([]);
  expect((await c.agent(22, "status", {})).ok).toBe(true); await c.close();
 });
 test("cancelling a queued action drops it at the FIFO boundary without dropping its live successor", async () => {
  const host = new FakeHost(); const c = new BrowserController(host); const entered = deferred(); const release = deferred();
  host.onCall = async cmd => { if (cmd === "open") { entered.resolve(); await release.promise; } };
  const first = c.agent(23, "open", { url: "https://example.org" }); await entered.promise;
  const cancelled = new AbortController();
  const click = c.agent(24, "click", { ref: "e1" }, cancelled.signal);
  const later = c.agent(25, "status", {});
  try {
   cancelled.abort();
   expect(host.calls.map(x => x.cmd)).toEqual(["open"]);
   release.resolve(); expect((await first).ok).toBe(true);
   expect(await click).toEqual({ id: 24, ok: false, error: "BrowserCancelled: the request was cancelled before the browser action started." });
   expect((await later).ok).toBe(true);
   expect(host.calls.map(x => x.cmd)).toEqual(["open", "status"]);
  } finally { release.resolve(); await c.close(); }
 });
 for (const fails of [false, true]) test(`in-flight abort retains FIFO ownership until the host ${fails ? "rejects" : "finishes"}, without replay`, async () => {
  const host = new FakeHost(); const c = new BrowserController(host); const entered = deferred(); const release = deferred();
  host.onCall = async cmd => { if (cmd === "open") { entered.resolve(); await release.promise; if (fails) throw new Error("host failed after abort"); } };
  const cancelled = new AbortController(); let settled = false; let transferred = false;
  const first = c.agent(26, "open", { url: "https://example.org" }, cancelled.signal).then(reply => { settled = true; return reply; });
  await entered.promise;
  const takeover = c.ui("takeover").then(reply => { transferred = true; return reply; });
  const later = c.agent(27, "click", { ref: "e1" }); const closing = c.close();
  try {
   cancelled.abort();
   await new Promise<void>(resolve => setImmediate(resolve));
   expect(settled).toBe(false); expect(transferred).toBe(false); expect(c.control).toBe("agent");
   expect(host.closed).toBe(0); expect(host.calls.map(x => x.cmd)).toEqual(["open"]);
   release.resolve(); expect((await first).ok).toBe(!fails);
   expect((await takeover).state?.control).toBe("user"); expect((await later).ok).toBe(false);
   await closing; expect(host.closed).toBe(1);
   expect(host.calls.map(x => x.cmd)).toEqual(["open", "ui_state"]);
  } finally { release.resolve(); await c.close(); }
 });
 test("resume waits for input, and requests received while user owns stay denied", async () => {
  const host = new FakeHost(); const c = new BrowserController(host); await c.ui("takeover");
  const entered = deferred(); const release = deferred();
  host.onCall = async cmd => { if (cmd === "ui_input") { entered.resolve(); await release.promise; } };
  const input = c.ui("input", { kind: "text", text: "draft" }); await entered.promise; const resume = c.ui("resume");
  expect((await c.agent(3, "reload", {})).ok).toBe(false); expect(c.control).toBe("user");
  release.resolve(); await input; expect((await resume).state?.control).toBe("agent");
  expect((await c.agent(4, "reload", {})).ok).toBe(true); await c.close();
 });
 test("failure has no fallback/replay and renderer errors never include secrets", async () => {
  const host = new FakeHost(); const c = new BrowserController(host); await c.ui("takeover");
  host.onCall = async cmd => { if (cmd === "open") throw new Error("Cookie: session=super-secret Bearer abc123"); };
  const reply = await c.ui("open", { url: "https://example.org" });
  expect(reply.ok).toBe(false); expect(reply.error).not.toContain("super-secret"); expect(reply.error).not.toContain("abc123");
  expect(host.calls.map(x => x.cmd)).toEqual(["ui_state", "open"]); await c.close();
 });
 test("navigation is not replayed if the subsequent state refresh fails", async () => {
  const host = new FakeHost(); const c = new BrowserController(host); await c.ui("takeover");
  host.onCall = async cmd => { if (cmd === "ui_state") throw new Error("refresh failed"); };
  expect((await c.ui("reload")).ok).toBe(false); expect(host.calls.map(x => x.cmd)).toEqual(["ui_state", "reload", "ui_state"]); await c.close();
 });
 test("bounded FIFO rejects excess polling without losing accepted actions", async () => {
  const host = new FakeHost(); const c = new BrowserController(host); const entered = deferred(); const release = deferred();
  host.onCall = async () => { entered.resolve(); await release.promise; };
  const accepted = Array.from({ length: 128 }, () => c.ui("frame")); await entered.promise;
  expect((await c.ui("frame")).error).toContain("BrowserBusy"); release.resolve();
  expect((await Promise.all(accepted)).every(reply => reply.ok)).toBe(true); expect(host.calls.length).toBe(128); await c.close();
 });
 test("close drains accepted work, rejects new work and closes child once", async () => {
  const host = new FakeHost(); const c = new BrowserController(host); const entered = deferred(); const release = deferred();
  host.onCall = async () => { entered.resolve(); await release.promise; };
  const frame = c.ui("frame"); await entered.promise; const close = c.close();
  expect((await c.ui("state")).ok).toBe(false); expect(host.closed).toBe(0);
  release.resolve(); await frame; await close; await c.close(); expect(host.closed).toBe(1);
 });
});

describe("closed browser argument contracts", () => {
 test("agent may use public actions but never UI control/import operations or extra args", () => {
  for (const action of ["ui_state", "ui_input", "takeover", "resume", "import", "constructor", "__proto__"]) expect(() => validateCall("agent", action, {})).toThrow();
  expect(() => validateCall("agent", "open", { url: "https://example.org", token: "secret" })).toThrow();
  expect(() => validateCall("ui", "eval", { js: "1" })).toThrow();
  expect(validateCall("agent", "eval", { js: "document.title" }).args.js).toBe("document.title");
 });
 test("reject malformed, oversized, unbounded, ambiguous, and path-injecting input", () => {
  for (const args of [null, [], { kind: "key", key: "" }, { kind: "click", x: -1, y: 2 }, { kind: "click", x: NaN, y: 2 }, { kind: "text", text: "a".repeat(20001) }, { kind: "key", key: "Enter", text: "extra" }, { kind: "wheel", dy: 10001 }, { kind: "__proto__" }]) expect(() => validateCall("ui", "input", args)).toThrow();
  for (const url of ["javascript:alert(1)", "data:text/html,x", "https://user:password@example.org", ""]) expect(() => validateCall("ui", "open", { url })).toThrow();
  expect(() => validateCall("agent", "click", { ref: "e1", selector: "a" })).toThrow();
  expect(() => validateCall("agent", "tab", { index: 0.5 })).toThrow();
  expect(() => validateCall("agent", "wait", { ms: 40000 })).toThrow();
  expect(() => validateCall("agent", "upload", { selector: "input", paths: ["x".repeat(8193)] })).toThrow();
  expect(validateCall("ui", "open", { url: "about:blank" }).action).toBe("open");
  expect(publicError(new Error("private Cookie value"))).not.toContain("private");
 });
});
