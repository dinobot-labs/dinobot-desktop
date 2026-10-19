import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserController } from "../../src/features/browser/controller.ts";
import { JsonlBrowserHost } from "../../src/features/browser/process.ts";
import { browserEnvironment, removeOwnedDescriptor } from "../../src/features/browser/runtime.ts";
import { trustedBrowserSender } from "../../src/features/browser/trust.ts";

const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });
function host(timeout = 5000) {
 let starts = 0;
 const transport = new JsonlBrowserHost(async () => { starts++; return { file: process.execPath, script: join(import.meta.dir, "fixture-host.ts"), env: { ...process.env, DINOBOT_BROWSER_CONFIG: JSON.stringify({ mode: "dedicated", profile: "fixture-only" }) } }; }, timeout, 200);
 return { transport, starts: () => starts };
}

test("JSONL child starts lazily, correlates replies and exits on cleanup", async () => {
 const h = host(); expect(h.starts()).toBe(0);
 const c = new BrowserController(h.transport); expect((await c.ui("state")).ok).toBe(true); expect(h.starts()).toBe(1);
 const result = await c.agent(15, "open", { url: "https://example.org" });
 expect(result.ok).toBe(true); if (result.ok) expect(JSON.parse(result.result.text)).toEqual({ cmd: "open", args: { url: "https://example.org" }, config: { mode: "dedicated", profile: "fixture-only" } });
 await c.close(); await c.close(); expect((await c.ui("state")).ok).toBe(false);
});

test("host failures are never replayed or replaced by a separate fallback child", async () => {
 const h = host();
 await expect(h.transport.call("fixture-exit", {})).rejects.toThrow();
 await expect(h.transport.call("status", {})).rejects.toThrow(); expect(h.starts()).toBe(1); await h.transport.close();
});

test("host timeout poisons the transport, so ownership cannot hide an ambiguous action or trigger a duplicate", async () => {
 const h = host(300);
 await expect(h.transport.call("fixture-hang", {})).rejects.toThrow("Timeout");
 await expect(h.transport.call("status", {})).rejects.toThrow(); expect(h.starts()).toBe(1); await h.transport.close();
});

test("child environment has no inherited provider secrets or attach setting", () => {
 const env = browserEnvironment({ PATH: "bin", SystemRoot: "system", OPENAI_API_KEY: "secret", DINOBOT_TOKEN: "secret", DINOBOT_BROWSER_CONFIG: "attach", DINOBOT_BROWSER_HOST: "hidden" }, "data", { path: "descriptor", port: 12345, token: "private" });
 expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.DINOBOT_TOKEN).toBeUndefined(); expect(env.SystemRoot).toBe("system"); expect(env.DINOBOT_BROWSER_HOST).toBeUndefined();
 expect(JSON.parse(env.DINOBOT_BROWSER_CONFIG!)).toMatchObject({ mode: "dedicated", browser: "chrome", profile: join("data", "browser", "profile"), humanize: false });
 expect(JSON.parse(env.DINOBOT_BROWSER_CONFIG!).userDataDir).toContain(process.platform === "win32" ? "User Data" : process.platform === "darwin" ? "Chrome" : "google-chrome");
 expect(JSON.parse(env.DINOBOT_BROWSER_DESKTOP!)).toEqual({ path: "descriptor", port: 12345, token: "private" });
});

test("cleanup removes only this host registry, not another owner", async () => {
 const root = await mkdtemp(join(import.meta.dir, ".registry-")); roots.push(root); const path = join(root, "desktop.json");
 await writeFile(path, JSON.stringify({ token: "other", port: 9 })); await removeOwnedDescriptor(path, "ours"); expect(JSON.parse(await readFile(path, "utf8")).token).toBe("other");
 await writeFile(path, JSON.stringify({ token: "ours", port: 9 })); await removeOwnedDescriptor(path, "ours"); await expect(readFile(path)).rejects.toThrow();
});

test("only the owned main frame and exact trusted app/dev origin can invoke browser IPC", () => {
 const frame = { url: "dinobot-app://app/" }; const window = { webContents: { mainFrame: frame } };
 expect(trustedBrowserSender({ sender: window.webContents, senderFrame: frame }, window)).toBe(true);
 expect(trustedBrowserSender({ sender: window.webContents, senderFrame: { ...frame } }, window)).toBe(false);
 expect(trustedBrowserSender({ sender: {}, senderFrame: frame }, window)).toBe(false);
 for (const url of ["about:srcdoc", "about:blank", "https://evil.example", "dinobot-app://app.evil/", "dinobot-app://user@app/"]) { frame.url = url; expect(trustedBrowserSender({ sender: window.webContents, senderFrame: frame }, window)).toBe(false); }
 frame.url = "http://127.0.0.1:5173/"; expect(trustedBrowserSender({ sender: window.webContents, senderFrame: frame }, window, "http://127.0.0.1:5173")).toBe(true);
 frame.url = "http://127.0.0.1:51730/"; expect(trustedBrowserSender({ sender: window.webContents, senderFrame: frame }, window, "http://127.0.0.1:5173")).toBe(false);
});
