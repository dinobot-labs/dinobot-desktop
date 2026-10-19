import { expect, test } from "bun:test";
import { request } from "node:http";
import { BrowserController, type HostReply, type HostResult } from "../../src/features/browser/controller.ts";
import { startBrowserServer } from "../../src/features/browser/server.ts";

function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
class ObservingController extends BrowserController {
 readonly admitted = deferred<AbortSignal | undefined>();
 readonly aborted = deferred();
 readonly finished = deferred<HostReply>();
 override async agent(id: number, action: unknown, value: unknown, signal?: AbortSignal): Promise<HostReply> {
  const pending = super.agent(id, action, value, signal);
  if (id === 2) {
   if (signal?.aborted) this.aborted.resolve();
   else signal?.addEventListener("abort", () => this.aborted.resolve(), { once: true });
   this.admitted.resolve(signal);
  }
  const reply = await pending;
  if (id === 2) this.finished.resolve(reply);
  return reply;
 }
}

test("a completed request body does not cancel a pending or normally completed response", async () => {
 const calls: string[] = []; const release = deferred();
 const c = new ObservingController({ async call(cmd): Promise<HostResult> { calls.push(cmd); await release.promise; return { text: "done" }; }, async close() {} });
 const endpoint = await startBrowserServer(c);
 const response = fetch(`http://127.0.0.1:${endpoint.port}/action`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body: JSON.stringify({ id: 2, cmd: "open", args: { url: "https://example.org" } }) });
 try {
  const signal = await c.admitted.promise;
  expect(signal).toBeInstanceOf(AbortSignal);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(signal!.aborted).toBe(false); expect(calls).toEqual(["open"]);
  release.resolve();
  expect(await (await response).json()).toEqual({ id: 2, ok: true, result: { text: "done" } });
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(signal!.aborted).toBe(false);
 } finally { release.resolve(); await response; await c.close(); await endpoint.close(); }
});

test("a disconnected queued HTTP action is cancelled server-side before FIFO dispatch", async () => {
 const calls: string[] = []; const entered = deferred(); const release = deferred();
 const c = new ObservingController({ async call(cmd): Promise<HostResult> { calls.push(cmd); if (cmd === "open") { entered.resolve(); await release.promise; } return { text: "done" }; }, async close() {} });
 const endpoint = await startBrowserServer(c);
 const first = c.agent(1, "open", { url: "https://example.org" }); await entered.promise;
 const client = request(`http://127.0.0.1:${endpoint.port}/action`, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" } });
 const clientClosed = new Promise<void>(resolve => client.once("close", resolve));
 client.on("error", () => {}); // Destroying this intentionally unanswered request may report ECONNRESET.
 client.end(JSON.stringify({ id: 2, cmd: "click", args: { ref: "e1" } }));
 try {
  const signal = await c.admitted.promise; // Admission is observed after super.agent has enqueued the click.
  client.destroy(); await clientClosed;
  expect(signal).toBeInstanceOf(AbortSignal);
  await c.aborted.promise; // The client abort alone is not evidence that the server observed it.
  expect(signal!.aborted).toBe(true); expect(calls).toEqual(["open"]);
  release.resolve(); expect((await first).ok).toBe(true);
  expect(await c.finished.promise).toEqual({ id: 2, ok: false, error: "BrowserCancelled: the request was cancelled before the browser action started." });
  expect((await c.agent(3, "status", {})).ok).toBe(true);
  expect(calls).toEqual(["open", "status"]);
 } finally { client.destroy(); release.resolve(); await first; await c.close(); await endpoint.close(); }
});

test("loopback broker authenticates every request, refuses browser origins and enforces the public action boundary", async () => {
 const calls: string[] = [];
 const c = new BrowserController({ async call(cmd): Promise<HostResult> { calls.push(cmd); return { text: "done", ui: { ok: true } }; }, async close() {} });
 const endpoint = await startBrowserServer(c);
 const url = `http://127.0.0.1:${endpoint.port}/action`;
 const headers = { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" };
 const body = JSON.stringify({ id: 42, cmd: "status", args: {} });
 try {
  expect(endpoint.token).toMatch(/^[a-f0-9]{64}$/);
  const missing = await fetch(url, { method: "POST", body }); expect(missing.status).toBe(401);
  const wrong = await fetch(url, { method: "POST", headers: { ...headers, authorization: `Bearer ${"a".repeat(64)}` }, body }); expect(wrong.status).toBe(401);
  for (const origin of ["null", "http://127.0.0.1", "https://example.org"]) { const res = await fetch(url, { method: "POST", headers: { ...headers, origin }, body }); expect(res.status).toBe(403); expect(res.headers.get("access-control-allow-origin")).toBeNull(); }
  expect((await fetch(url, { method: "OPTIONS", headers })).status).toBe(403);
  expect((await fetch(url.replace("/action", "/else"), { method: "POST", headers, body })).status).toBe(403);
  expect((await fetch(url, { method: "POST", headers: { ...headers, host: "localhost" }, body })).status).toBe(403);
  expect((await fetch(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body })).status).toBe(415);
  expect((await fetch(url, { method: "POST", headers, body: "x".repeat(128 * 1024 + 1) })).status).toBe(413);
  const chunks = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new Uint8Array(65536)); stream.enqueue(new Uint8Array(65537)); stream.close(); } });
  expect((await fetch(url, { method: "POST", headers, body: chunks } as RequestInit)).status).toBe(413);
  expect((await fetch(url, { method: "POST", headers, body: "bad json" })).status).toBe(400);
  expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({ id: -1, cmd: "status", args: {} }) })).status).toBe(400);
  expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({ id: 1, cmd: "status", args: {}, extra: 1 }) })).status).toBe(400);
  for (const cmd of ["ui_state", "ui_import", "takeover"]) { const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ id: 2, cmd, args: {} }) }); expect((await res.json() as { ok: boolean }).ok).toBe(false); }
  expect(calls).toEqual([]);
  const ok = await fetch(url, { method: "POST", headers, body });
  expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ id: 42, ok: true, result: { text: "done" } }); expect(calls).toEqual(["status"]);
  await c.ui("takeover");
  const blocked = await fetch(url, { method: "POST", headers, body }); expect((await blocked.json() as { error: string }).error).toContain("UserControl");
 } finally { await c.close(); await endpoint.close(); }
 await expect(fetch(url, { method: "POST", headers, body })).rejects.toThrow();
});
