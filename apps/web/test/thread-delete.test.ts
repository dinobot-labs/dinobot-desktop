import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as ui from "@dinobot/ui";
import * as usage from "../src/state/usage.ts";
import { applySessions, connect, deleteThread, newThread, selectThread, sessionFor, useApp } from "../src/state/app.ts";
import type { SessionsEvent } from "@dinobot/contracts";

// Real store, API client and ChatSession; only HTTP and the stream worker are synthetic.
const originalFetch = globalThis.fetch;
const originalWorker = globalThis.Worker;
const originalDocument = globalThis.document;
const persisted = new Set<string>();
let deletes: string[] = [];
let events: string[] = [];
let responseStatus = 200;
let outcome = "deleted";
let workspaceGate: Promise<void> | undefined;
let threadsGate: Promise<void> | undefined;
let workspaceFailed = false;
let toast: ReturnType<typeof spyOn>;
let polling: ReturnType<typeof spyOn>;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const row = (key: string) => useApp.getState().threads.find((t) => t.key === key);
function snapshot(key?: string, extra = {}) {
 applySessions({ type: "sessions", sessions: key ? [{ thread: key, busy: false, queued: 0, subagents: [], ...extra }] : [] } as unknown as SessionsEvent);
}

beforeEach(() => {
 persisted.clear(); deletes = []; events = []; responseStatus = 200; outcome = "deleted"; workspaceGate = undefined; threadsGate = undefined; workspaceFailed = false;
 toast = spyOn(ui, "toast").mockImplementation(() => () => {});
 polling = spyOn(usage, "startUsagePolling").mockImplementation(() => {});
 globalThis.document = { baseURI: "http://synthetic.invalid/" } as Document;
 globalThis.Worker = class {
  postMessage(message: { type: string; key: string }) { events.push(message.type + ":" + message.key); }
 } as unknown as typeof Worker;
 globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const path = String(input);
  const parts = path.split("/v1/threads/")[1]?.split("/");
  const key = parts ? decodeURIComponent(parts[0]!) + ":" + decodeURIComponent(parts[1]!) : "";
  if (init?.method === "DELETE") {
   deletes.push(key); events.push("delete:" + key);
   if (responseStatus === 200 && (outcome === "deleted" || outcome === "not_found")) persisted.delete(key);
   return Response.json(responseStatus === 500 ? { error: "synthetic failure" } : { status: outcome }, { status: responseStatus });
  }
  if (path.endsWith("/workspace")) {
   await workspaceGate; persisted.add(key); events.push("bound:" + key);
   if (workspaceFailed) return Response.json({ error: "lost binding response" }, { status: 500 });
   return Response.json({ cwd: "/synthetic" });
  }
  if (path.endsWith("/events")) return new Response(new ReadableStream({ start(controller) {
   init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
  } }));
  if (path.endsWith("/v1/threads")) {
   const threads = [...persisted].map((key) => ({ key }));
   await threadsGate; return Response.json({ threads });
  }
  if (path.endsWith("/commands")) return Response.json({ commands: [] });
  return Response.json({});
 }) as typeof fetch;
 useApp.setState({ threads: [], activeKey: null, config: undefined, unseen: [] });
 snapshot();
});
afterEach(() => {
 for (const entry of useApp.getState().threads) sessionFor(entry.key).stop();
 globalThis.fetch = originalFetch; globalThis.Worker = originalWorker; globalThis.document = originalDocument;
 toast.mockRestore(); polling.mockRestore();
});

for (const withSnapshot of [false, true]) test("workspace-persisted draft sends DELETE " + (withSnapshot ? "after" : "before") + " idle snapshot and stays gone", async () => {
 await connect();
 const key = newThread("bound-" + withSnapshot, "/synthetic"); await tick();
 expect(persisted.has(key)).toBe(true);
 if (withSnapshot) snapshot(key);
 expect(await deleteThread(key)).toBe(true);
 expect(deletes).toEqual([key]);
 expect(events.indexOf("close:" + key)).toBeLessThan(events.indexOf("delete:" + key));
 snapshot(persisted.has(key) ? key : undefined); await tick();
 expect(row(key)).toBeUndefined(); expect(persisted.has(key)).toBe(false);
});

test("unbound draft uses authoritative not_found rather than assuming local-only", async () => {
 const key = newThread("unbound"); await tick(); outcome = "not_found";
 expect(await deleteThread(key)).toBe(true); expect(deletes).toEqual([key]); expect(row(key)).toBeUndefined();
});
for (const active of [{ busy: true }, { queued: 1 }, { subagents: [{}] }]) test("active work blocks deletion: " + JSON.stringify(active), async () => {
 const key = newThread("busy", "/synthetic"); await tick(); snapshot(key, active);
 expect(await deleteThread(key)).toBe(false); expect(deletes).toEqual([]); expect(row(key)).toBeDefined();
 expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "error" }));
});
for (const result of ["http-error", "busy", "moved", "quarantined"]) test("failed DELETE preserves row and restores stream: " + result, async () => {
 const key = newThread("failure-" + result, "/synthetic"); await tick(); snapshot(key);
 if (result === "http-error") responseStatus = 500; else outcome = result;
 const before = events.length;
 expect(await deleteThread(key)).toBe(false); expect(deletes).toEqual([key]); expect(row(key)).toBeDefined();
 expect(events.slice(before)).toEqual(["close:" + key, "delete:" + key, "open:" + key]);
 expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "error" }));
});

test("failed workspace response does not prove the draft was never persisted", async () => {
 workspaceFailed = true;
 const key = newThread("failed-bind", "/synthetic"); await tick();
 expect(persisted.has(key)).toBe(true);
 expect(await deleteThread(key)).toBe(true); expect(deletes).toEqual([key]); expect(persisted.has(key)).toBe(false);
});

test("missing and non-local rows cannot be deleted", async () => {
 useApp.setState({ threads: [{ key: "slack:external", channel: "slack" }] });
 expect(await deleteThread("tui:absent")).toBe(false);
 expect(await deleteThread("slack:external")).toBe(false); expect(deletes).toEqual([]);
});

test("a stale thread-list response cannot resurrect a successful deletion", async () => {
 const key = newThread("stale", "/synthetic"); await tick();
 let release!: () => void; threadsGate = new Promise<void>((r) => { release = r; });
 snapshot("tui:missing"); // Starts refresh with the soon-to-be-deleted row.
 expect(await deleteThread(key)).toBe(true);
 release(); await tick();
 expect(row(key)).toBeUndefined();
});

test("work becoming busy during binding refuses deletion and restores the selected stream", async () => {
 let release!: () => void; workspaceGate = new Promise<void>((r) => { release = r; });
 const key = newThread("pending-busy", "/synthetic");
 const deleting = deleteThread(key);
 snapshot(key, { busy: true }); release();
 expect(await deleting).toBe(false); expect(deletes).toEqual([]); expect(row(key)).toBeDefined();
 expect(events).toContain("open:" + key);
});

test("deletion waits for pending workspace binding and prevents late stream restart", async () => {
 let release!: () => void; workspaceGate = new Promise<void>((r) => { release = r; });
 const key = newThread("pending", "/synthetic");
 const deleting = deleteThread(key); await tick();
 expect(await deleteThread(key)).toBe(false); // One in-flight delete per key.
 expect(deletes).toEqual([]);
 // Do not await: the old implementation may issue a second pending binding.
 const selecting = selectThread(key);
 release(); expect(await deleting).toBe(true); await selecting; await tick();
 expect(deletes).toEqual([key]); expect(persisted.has(key)).toBe(false); expect(row(key)).toBeUndefined();
 const deletion = events.indexOf("delete:" + key);
 expect(events.indexOf("bound:" + key)).toBeLessThan(deletion);
 expect(events.slice(deletion + 1)).not.toContain("open:" + key);
 snapshot(persisted.has(key) ? key : undefined); await tick(); expect(row(key)).toBeUndefined();
});
