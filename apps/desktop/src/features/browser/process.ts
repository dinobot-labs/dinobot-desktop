import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { BrowserTransport, HostResult } from "./controller.ts";
import { BrowserFault, record } from "./validation.ts";

export interface HostLaunch { file: string; script: string; env: NodeJS.ProcessEnv }
/** Electron cannot run Bun APIs itself. Keep the real browser in the packaged Bun JSONL host, never in a renderer.
 * A failed/timed-out transport is terminal: no fallback host and no automatic replay after an ambiguous effect. */
export class JsonlBrowserHost implements BrowserTransport {
 #child: ChildProcessWithoutNullStreams | undefined;
 #starting: Promise<void> | undefined;
 #failure: Error | undefined;
 #closed = false;
 #nextId = 1;
 #buffer = "";
 #waiters = new Map<number, { resolve(value: HostResult): void; reject(error: Error): void }>();
 #exit: Promise<void> | undefined;
 #closing: Promise<void> | undefined;
 constructor(private readonly launch: () => Promise<HostLaunch>, private readonly timeoutMs = 55000, private readonly closeTimeoutMs = 10000) {}
 async #start(): Promise<void> {
  if (this.#failure) throw this.#failure;
  if (this.#closed) throw new BrowserFault("Closed");
  return this.#starting ??= (async () => {
   const launch = await this.launch();
   if (this.#closed) throw new BrowserFault("Closed");
   const child = spawn(launch.file, [launch.script], { stdio: ["pipe", "pipe", "pipe"], env: launch.env, windowsHide: true });
   this.#child = child;
   this.#exit = new Promise<void>(resolve => { child.once("exit", () => resolve()); child.once("error", () => resolve()); });
   child.once("error", () => this.#fail(new BrowserFault("HostExited")));
   child.once("exit", () => this.#fail(new BrowserFault("HostExited")));
   child.stdin.on("error", () => this.#fail(new BrowserFault("HostExited")));
   child.stdout.setEncoding("utf8");
   child.stdout.on("data", (chunk: string) => this.#read(chunk));
   // Drain without retaining or logging: browser stderr may contain user page content or credentials.
   child.stderr.resume();
  })().catch((error: unknown) => { const fault = error instanceof BrowserFault ? error : new BrowserFault("HostExited"); this.#failure = fault; throw fault; });
 }
 #fail(error: Error): void {
  this.#failure ??= error;
  for (const waiter of this.#waiters.values()) waiter.reject(this.#failure);
  this.#waiters.clear();
 }
 #read(chunk: string): void {
  this.#buffer += chunk;
  if (this.#buffer.length > 12 * 1024 * 1024) { this.#fail(new BrowserFault("Protocol")); this.#child?.kill(); return; }
  let end: number;
  while ((end = this.#buffer.indexOf("\n")) >= 0) {
   const line = this.#buffer.slice(0, end);
   this.#buffer = this.#buffer.slice(end + 1);
   let reply: unknown;
   try { reply = JSON.parse(line); } catch { continue; }
   if (!record(reply) || !Number.isSafeInteger(reply.id)) continue;
   const waiter = this.#waiters.get(reply.id as number);
   if (!waiter) continue;
   if (reply.ok === true && record(reply.result) && typeof reply.result.text === "string") waiter.resolve(reply.result as unknown as HostResult);
   else if (reply.ok === false) waiter.reject(new Error(typeof reply.error === "string" ? reply.error : "HostError"));
   else waiter.reject(new BrowserFault("Protocol"));
  }
 }
 async call(cmd: string, args: Record<string, unknown>): Promise<HostResult> {
  await this.#start();
  if (this.#failure) throw this.#failure;
  if (this.#closed) throw new BrowserFault("Closed");
  const child = this.#child!;
  const id = this.#nextId++;
  return new Promise<HostResult>((resolve, reject) => {
   const finish = () => { clearTimeout(timer); this.#waiters.delete(id); };
   const timer = setTimeout(() => {
    // Do not advance control ownership while an unobserved child action might still be running.
    this.#fail(new BrowserFault("Timeout"));
    child.stdin.end();
    void this.close();
   }, this.timeoutMs);
   this.#waiters.set(id, { resolve: result => { finish(); resolve(result); }, reject: error => { finish(); reject(error); } });
   try { child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`); } catch { this.#fail(new BrowserFault("HostExited")); }
  });
 }
 close(): Promise<void> {
  if (this.#closing) return this.#closing;
  this.#closed = true;
  this.#closing = (async () => {
   await this.#starting?.catch(() => {});
   const child = this.#child;
   if (!child) return;
   child.stdin.end(); // host closes only its dedicated profile and removes its private descriptor
   let timer: ReturnType<typeof setTimeout> | undefined;
   const done = await Promise.race([this.#exit!.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), this.closeTimeoutMs); })]);
   clearTimeout(timer);
   if (!done) { child.kill(); await this.#exit; }
   this.#fail(new BrowserFault("Closed"));
  })();
  return this.#closing;
 }
}
