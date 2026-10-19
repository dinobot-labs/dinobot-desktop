import type { BrowserReply, BrowserViewState } from "../../browser-types.ts";
import { BrowserFault, publicError, validateCall } from "./validation.ts";

export interface HostResult { text: string; image?: { mimeType: string; data: string }; ui?: BrowserReply }
export type HostReply = { id: number; ok: true; result: HostResult } | { id: number; ok: false; error: string };
export interface BrowserTransport { call(cmd: string, args: Record<string, unknown>): Promise<HostResult>; close(): Promise<void> }
/** Preserve the original browser tool's stable recovery instructions, never raw errors in renderer IPC. */
function agentError(error: unknown): string {
 if (error instanceof BrowserFault) return publicError(error);
 const message = error instanceof Error ? error.message : "";
 if (!/^(?:InvalidArguments|StaleRef|NoPage|NotOwnTab|RemoteDebuggingOff|PermissionPending|TimeoutError|TargetClosedError|page\.[\w]+|locator\.[\w]+|browserType\.[\w]+):/.test(message) && !/(?:^|\n)Fallback:/.test(message)) return publicError(error);
 return message.slice(0, 8192).replace(/\b(?:Set-Cookie|Cookie):[^\r\n]*/gi, "Cookie: [redacted]").replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]");
}
const READ_ONLY = new Set(["state", "frame", "profiles"]);
const UI_HOST: Record<string, string> = { state: "ui_state", frame: "ui_frame", input: "ui_input", profiles: "ui_profiles", import: "ui_import" };

/** One FIFO is the sole owner of control transitions AND all child calls, including read-only frame requests.
 * A transition can never overtake an in-flight agent command or user input. Ownership is checked again at execution. */
export class BrowserController {
 #tail: Promise<unknown> = Promise.resolve();
 #control: "agent" | "user" = "agent";
 #closed = false;
 #pending = 0;
 #closing: Promise<void> | undefined;
 constructor(private readonly host: BrowserTransport) {}
 get control(): "agent" | "user" { return this.#control; }
 #enqueue<T>(run: () => Promise<T>): Promise<T> {
  if (this.#closed) return Promise.reject(new BrowserFault("Closed"));
  if (this.#pending >= 128) return Promise.reject(new BrowserFault("Busy"));
  this.#pending++;
  const next = this.#tail.then(run);
  this.#tail = next.catch(() => {}).finally(() => { this.#pending--; });
  return next;
 }
 async ui(action: unknown, value: unknown = {}): Promise<BrowserReply> {
  try {
   const call = validateCall("ui", action, value);
   return await this.#enqueue(async () => {
    if (call.action === "takeover" || call.action === "resume") {
     this.#control = call.action === "takeover" ? "user" : "agent";
     return this.#reply(await this.host.call("ui_state", {}), call.action);
    }
    if (!READ_ONLY.has(call.action) && this.#control !== "user") throw new BrowserFault("AgentControl");
    const result = await this.host.call(UI_HOST[call.action] ?? call.action, call.args);
    if (UI_HOST[call.action]) return this.#reply(result, call.action);
    // Navigation executes exactly once. A failed state refresh is never a reason to replay it.
    let view = await this.host.call("ui_state", {});
    if (call.action === "close_tab" && view.ui?.ok && view.ui.state?.current === -1) {
     // UI close selects another owned tab; never select an attached user tab or change agent close semantics.
     const next = view.ui.state.tabs.find(tab => tab.owned);
     if (next) { await this.host.call("tab", { index: next.index }); view = await this.host.call("ui_state", {}); }
    }
    return this.#reply(view, call.action);
   });
  } catch (error) { return { ok: false, error: publicError(error, typeof action === "string" ? action : undefined) }; }
 }
 async agent(id: number, action: unknown, value: unknown, signal?: AbortSignal): Promise<HostReply> {
  try {
   const call = validateCall("agent", action, value);
   if (signal?.aborted) throw new BrowserFault("Cancelled");
   if (this.#control === "user") throw new BrowserFault("UserControl");
   const result = await this.#enqueue(async () => {
    if (this.#control === "user") throw new BrowserFault("UserControl");
    // Dispatch is the cancellation boundary. Once sent, keep the FIFO occupied
    // until the host settles; racing an abort would allow early takeover/replay.
    if (signal?.aborted) throw new BrowserFault("Cancelled");
    return this.host.call(call.action, call.args);
   });
   // ui replies are private to the trusted renderer, never part of the agent wire protocol.
   return { id, ok: true, result: { text: result.text, ...(result.image ? { image: result.image } : {}) } };
  } catch (error) { return { id, ok: false, error: agentError(error) }; }
 }
 #reply(result: HostResult, action: string): BrowserReply {
  const ui = result.ui;
  if (!ui || typeof ui.ok !== "boolean") throw new BrowserFault("Protocol");
  if (!ui.ok) return { ok: false, error: publicError(new Error(ui.error ?? ""), action) };
  let state: BrowserViewState | undefined;
  if (ui.state) {
   const s = ui.state;
   // Construct the allowlisted public shape; a child cannot accidentally leak transport/cookie fields.
   state = { connected: s.connected === true, mode: "dedicated", control: this.#control,
    tabs: (Array.isArray(s.tabs) ? s.tabs : []).slice(0, 1000).map(t => ({ index: t.index, title: String(t.title).slice(0, 8192), url: String(t.url).slice(0, 32768), owned: t.owned === true })),
    current: s.current, url: String(s.url).slice(0, 32768), title: String(s.title).slice(0, 8192), width: s.width, height: s.height,
    ...(typeof s.frame === "string" && s.frame.length <= 8 * 1024 * 1024 ? { frame: s.frame } : {}),
    ...(s.dialog ? { dialog: { type: String(s.dialog.type).slice(0, 128), message: String(s.dialog.message).slice(0, 8192) } } : {}),
   };
  }
  return { ok: true, ...(state ? { state } : {}),
   ...(ui.profiles ? { profiles: ui.profiles.slice(0, 100).map(p => ({ id: p.id, name: String(p.name).slice(0, 256) })) } : {}),
   ...(typeof ui.imported === "number" ? { imported: ui.imported } : {}),
   ...(typeof ui.skipped === "number" ? { skipped: ui.skipped } : {}),
  };
 }
 close(): Promise<void> {
  if (this.#closing) return this.#closing;
  this.#closed = true;
  this.#closing = this.#tail.then(() => this.host.close());
  return this.#closing;
 }
}
