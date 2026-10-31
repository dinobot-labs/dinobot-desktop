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

 test("cancelled prompt ignores late daemon error/apply before cancel HTTP resolves", async () => {
  const { cancelCommand } = await import("../src/state/command-runner.ts");
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let resolveCancel!: (r: Response) => void;
  const emit = (event: unknown) => stream.enqueue(new TextEncoder().encode("data: " + JSON.stringify(event) + "\n\n"));
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
   if(String(url).includes("/prompts/")) return new Promise<Response>(r => {resolveCancel=r;});
   return new Response(new ReadableStream({start(c){stream=c;emit({type:"started",runId:"r"});emit({type:"prompt",id:"p",prompt:{type:"secret",message:"Token"}});init.signal!.addEventListener("abort",()=>c.close());}}));
  }) as typeof fetch;
  startCommand("tui:test","setup",undefined,{surface:"slack"});
  await new Promise(r=>setTimeout(r,0));
  const cancelled=cancelCommand();
  emit({type:"error",message:"cancelled"});
  emit({type:"apply",request:{candidate:"must not apply"}});
  await new Promise(r=>setTimeout(r,0));
  const result=useRunner.getState().run;
  resolveCancel(new Response("{}"));await cancelled;
  expect(result?.state).toBe("cancelled");expect(result?.apply).toBeUndefined();
 });
