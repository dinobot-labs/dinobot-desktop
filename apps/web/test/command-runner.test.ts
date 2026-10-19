import { afterEach, expect, test } from "bun:test";
import { closeRun, startCommand, useRunner } from "../src/state/command-runner.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { closeRun(); globalThis.fetch = originalFetch; });

test("late cancellation response must not abort a newly opened model picker", async () => {
 const signals: AbortSignal[] = [];
 let resolveCancel!: (response: Response) => void;
 globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
  if (String(_url).includes("/prompts/")) return await new Promise<Response>(resolve => { resolveCancel = resolve; });
  signals.push(init.signal!);
  return new Response(new ReadableStream({ start(c) {
   c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({type:"started",runId:"run-" + signals.length})}\n\ndata: ${JSON.stringify({type:"prompt",id:"p1",prompt:{type:"select",message:"Model",options:[]}})}\n\n`));
   init.signal!.addEventListener("abort", () => c.close());
  } }), { headers: { "content-type": "text/event-stream" } });
 }) as typeof fetch;
 startCommand("tui:test", "model");
 await new Promise(resolve => setTimeout(resolve, 0));
 expect(useRunner.getState().run?.prompt?.id).toBe("p1");
 closeRun();
 expect(useRunner.getState().run).toBeNull();
 startCommand("tui:test", "model");
 await new Promise(resolve => setTimeout(resolve, 0));
 resolveCancel(new Response("{}"));
 await new Promise(resolve => setTimeout(resolve, 0));
 expect(signals[0]!.aborted).toBe(true);
 expect(signals[1]!.aborted).toBe(false);
 expect(useRunner.getState().run?.state).toBe("running");
});

test("a clean /model switch closes the dialog by itself and still reports onDone", async () => {
 globalThis.fetch = (async () => new Response([
  {type:"started",runId:"r"},{type:"output",level:"success",text:"model switched to a/b"},{type:"done"},
 ].map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
 let done: unknown;
 startCommand("tui:test", "model", "a/b", { onDone: (r) => { done = r; } });
 for (let i = 0; i < 20 && !done; i++) await new Promise(resolve => setTimeout(resolve, 5));
 expect(useRunner.getState().run).toBeNull();
 expect((done as { state: string }).state).toBe("done");
});
