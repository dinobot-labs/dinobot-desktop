import type { BrowserUiAction } from "../../browser-types.ts";

export const MAX_BODY = 128 * 1024;
const TARGET = { ref: "string", selector: "string" } as const;
type Spec = { args: Record<string, "string" | "number" | "boolean" | "strings">; required?: string[]; target?: "required" | "optional" };
/** Keep this closed set aligned with the public browser_use contract; ui_* is never an agent command. */
const AGENT: Record<string, Spec> = {
 status: { args: {} }, open: { args: { url: "string", newTab: "boolean" }, required: ["url"] },
 snapshot: { args: { maxChars: "number" } }, click: { args: { ...TARGET, button: "string", double: "boolean" }, target: "required" },
 fill: { args: { ...TARGET, text: "string" }, required: ["text"], target: "required" },
 type: { args: { ...TARGET, text: "string", submit: "boolean" }, required: ["text"], target: "optional" },
 press: { args: { key: "string" }, required: ["key"] }, select: { args: { ...TARGET, values: "strings" }, required: ["values"], target: "required" },
 hover: { args: TARGET, target: "required" }, scroll: { args: { ...TARGET, dy: "number", dx: "number" }, target: "optional" },
 upload: { args: { ...TARGET, paths: "strings" }, required: ["paths"], target: "required" }, screenshot: { args: { fullPage: "boolean" } },
 tabs: { args: {} }, tab: { args: { index: "number" }, required: ["index"] }, close_tab: { args: { index: "number" } },
 back: { args: {} }, forward: { args: {} }, reload: { args: {} }, wait: { args: { ms: "number", text: "string", url: "string" } },
 text: { args: TARGET, target: "optional" }, eval: { args: { js: "string" }, required: ["js"] },
 dialog: { args: { accept: "boolean", promptText: "string" }, required: ["accept"] }, window: { args: {} }, close: { args: {} },
};
const UI: Record<BrowserUiAction, Spec> = {
 state: { args: {} }, frame: { args: {} }, takeover: { args: {} }, resume: { args: {} }, profiles: { args: {} },
 open: AGENT.open!, back: AGENT.back!, forward: AGENT.forward!, reload: AGENT.reload!, tab: AGENT.tab!, close_tab: AGENT.close_tab!, dialog: AGENT.dialog!, close: AGENT.close!,
 input: { args: { kind: "string", x: "number", y: "number", dx: "number", dy: "number", button: "string", key: "string", text: "string" }, required: ["kind"] },
 import: { args: { profile: "string", confirmed: "boolean" }, required: ["profile", "confirmed"] },
};
export class BrowserFault extends Error { constructor(readonly code: string) { super(code); } }
export function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function invalid(): never { throw new BrowserFault("InvalidArguments"); }

export function validateCall(source: "ui" | "agent", action: unknown, value: unknown = {}): { action: string; args: Record<string, unknown> } {
 const specs = source === "ui" ? UI : AGENT;
 if (typeof action !== "string" || !Object.hasOwn(specs, action) || !record(value)) return invalid();
 const spec = specs[action as keyof typeof specs] as Spec;
 let encoded: string;
 try { encoded = JSON.stringify(value); } catch { return invalid(); }
 if (Buffer.byteLength(encoded) > MAX_BODY) return invalid();
 const args: Record<string, unknown> = {};
 for (const [key, item] of Object.entries(value)) {
  const type = spec.args[key];
  if (!type) return invalid();
  if (item === undefined) continue;
  if (type === "strings") {
   const list = typeof item === "string" ? [item] : item;
   if (!Array.isArray(list) || list.length > 64 || list.some(x => typeof x !== "string" || x.length > 8192 || x.includes("\0"))) return invalid();
   args[key] = [...list];
  } else {
   if (typeof item !== type || (type === "number" && !Number.isFinite(item)) || (type === "string" && ((item as string).length > (key === "js" ? 64000 : key === "text" ? 20000 : 8192) || (item as string).includes("\0")))) return invalid();
   args[key] = item;
  }
 }
 for (const key of spec.required ?? []) if (args[key] === undefined) return invalid();
 const targets = ["ref", "selector"].filter(key => args[key] !== undefined);
 if (targets.length > 1 || (spec.target === "required" && targets.length !== 1)) return invalid();
 if (args.ref !== undefined && !/^@?e\d+$/.test(args.ref as string)) return invalid();
 if (args.selector !== undefined && !(args.selector as string).trim()) return invalid();
 if (args.button !== undefined && !["left", "right", "middle"].includes(args.button as string)) return invalid();
 if (args.index !== undefined && (!Number.isSafeInteger(args.index) || (args.index as number) < 0 || (args.index as number) > 10000)) return invalid();
 if (args.maxChars !== undefined && (!Number.isInteger(args.maxChars) || (args.maxChars as number) < 1 || (args.maxChars as number) > 100000)) return invalid();
 if (args.ms !== undefined && ((args.ms as number) < 0 || (args.ms as number) > 30000)) return invalid();
 for (const key of ["dx", "dy"]) if (args[key] !== undefined && Math.abs(args[key] as number) > 10000) return invalid();
 if (action === "wait" && ["ms", "text", "url"].filter(key => args[key] !== undefined).length !== 1) return invalid();
 if (action === "open") {
  const raw = (args.url as string).trim();
  if (!raw) return invalid();
  // The agent host already validates its public URL contract and supplies https for bare hostnames.
  // UI navigation is narrower: never allow script/data schemes or URL-embedded credentials.
  if (source === "ui") {
   try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw);
    if (!["http:", "https:", "file:"].includes(url.protocol) && url.href !== "about:blank") return invalid();
    if (url.username || url.password) return invalid();
    args.url = url.href;
   } catch { return invalid(); }
  }
 }
 if (source === "ui" && action === "import" && (args.confirmed !== true || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,255}$/.test(args.profile as string) || (args.profile as string).includes(".."))) return invalid();
 if (source === "ui" && action === "input") {
  const allowed: Record<string, string[]> = { click: ["kind", "x", "y", "button"], wheel: ["kind", "dx", "dy"], key: ["kind", "key"], text: ["kind", "text"] };
  if (!Object.hasOwn(allowed, args.kind as string)) return invalid();
  const fields = allowed[args.kind as string]!;
  if (Object.keys(args).some(key => !fields.includes(key))) return invalid();
  if (args.kind === "click") for (const key of ["x", "y"]) if (typeof args[key] !== "number" || (args[key] as number) < 0 || (args[key] as number) > 16384) return invalid();
  if (args.kind === "key" && (typeof args.key !== "string" || !args.key || args.key.length > 128)) return invalid();
  if (args.kind === "text" && typeof args.text !== "string") return invalid();
  if (args.kind === "wheel" && args.dx === undefined && args.dy === undefined) return invalid();
 }
 return { action, args };
}

/** Never forward browser stack traces, URLs, credentials or arbitrary child text as renderer errors. */
export function publicError(error: unknown, action?: string): string {
 const code = error instanceof BrowserFault ? error.code : error instanceof Error ? error.message : "";
 if (/^InvalidArguments: unknown action ["']?ui_(?:state|frame|input|profiles|import)/.test(code)) return "BrowserHostOutdated: update the bundled dinobot host to a version that supports shared browsing.";
 if (code === "InvalidArguments") return "InvalidArguments: unsupported browser action or arguments.";
 if (code === "UserControl") return "UserControl: resume agent control before running browser_use.";
 if (code === "AgentControl") return "AgentControl: take control before navigating, typing or importing logins.";
 if (code === "Closed") return "BrowserClosed: the desktop browser is shutting down.";
 if (code === "Busy") return "BrowserBusy: too many pending browser actions; wait for them to finish.";
 if (code === "Cancelled") return "BrowserCancelled: the request was cancelled before the browser action started.";
 if (code === "DataDir") return "BrowserUnavailable: set bot.dataDir in the dinobot configuration before using the browser.";
 if (code === "HostMissing") return "BrowserUnavailable: install a desktop daemon bundle with browser-host.js; developers may set DINOBOT_BROWSER_HOST to its explicit entry path.";
 if (code === "BunMissing") return "BrowserUnavailable: the Bun runtime is missing; reinstall the desktop daemon bundle or add Bun to PATH.";
 if (code === "Timeout") return "BrowserTimeout: the action may already have happened. Inspect the browser before retrying; no automatic retry was made.";
 if (code === "Protocol") return "BrowserUnavailable: the bundled browser host does not support the desktop protocol; update its bundle.";
 if (action === "import") return "LoginImportFailed: open Chrome, enable remote debugging and allow the connection, then retry. Protected logins may require signing in again; passwords and passkeys are not imported.";
 return "BrowserUnavailable: the browser host could not complete the action. Check that Chrome is installed and the dedicated profile is not in use. No automatic retry was made.";
}
