import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { BrowserReply } from "../../browser-types.ts";
import { cachedConfig, daemonLaunch, findOnPath, readDaemonConfig } from "../../daemon.ts";
import { BrowserController } from "./controller.ts";
import { JsonlBrowserHost, type HostLaunch } from "./process.ts";
import { startBrowserServer, type BrowserEndpoint } from "./server.ts";
import { BrowserFault, publicError, record } from "./validation.ts";

const ENV_NAMES = new Set(["HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TZ", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP", "XDG_DATA_DIRS", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "DBUS_SESSION_BUS_ADDRESS", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "OS", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "USERNAME", "HOMEDRIVE", "HOMEPATH", "COMPUTERNAME", "TEMP", "TMP", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "PROGRAMDATA", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]);
export function browserEnvironment(parent: NodeJS.ProcessEnv, dataDir: string, endpoint: { path: string; port: number; token: string }): NodeJS.ProcessEnv {
 const env: NodeJS.ProcessEnv = {};
 for (const [key, value] of Object.entries(parent)) if (value !== undefined && ENV_NAMES.has(key.toUpperCase())) env[key] = value;
 const userDataDir = process.platform === "win32" ? join(parent.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Google", "Chrome", "User Data") : process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Google", "Chrome") : join(parent.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "google-chrome");
 env.DINOBOT_BROWSER_CONFIG = JSON.stringify({ mode: "dedicated", browser: "chrome", profile: join(dataDir, "browser", "profile"), userDataDir, humanize: false });
 env.DINOBOT_BROWSER_DESKTOP = JSON.stringify(endpoint);
 return env;
}

/** Resolve from the actual app/bundled daemon or its runtime copy; never guess another checkout or user path. */
export async function browserHostLaunch(appPath: string, dataDir: string, endpoint: { path: string; port: number; token: string }): Promise<HostLaunch> {
 const config = cachedConfig() ?? await readDaemonConfig();
 const launch = config.command ? await daemonLaunch(config.command) : undefined;
 const explicit = process.env.DINOBOT_BROWSER_HOST;
 let script: string | undefined;
 if (explicit) {
  if (!isAbsolute(explicit) || !existsSync(explicit)) throw new BrowserFault("HostMissing");
  script = resolve(explicit);
 } else {
  const main = launch?.prefix[0] ?? config.command;
  const candidates = [
   ...(main && /[\\/]main\.js$/i.test(main) ? [join(dirname(main), "browser-host.js")] : []),
   join(appPath, "node_modules", "dinobot", "browser-host.js"),
  ];
  script = candidates.find(path => existsSync(path));
 }
 if (!script) throw new BrowserFault("HostMissing");
 const bun = launch && /^bun(?:\.exe)?$/i.test(launch.file.split(/[\\/]/).at(-1) ?? "") ? launch.file : await findOnPath("bun", process.platform === "win32" ? [".exe"] : [""]);
 const homeBun = join(process.env.BUN_INSTALL || join(homedir(), ".bun"), "bin", process.platform === "win32" ? "bun.exe" : "bun");
 const file = bun ?? (existsSync(homeBun) ? homeBun : undefined);
 if (!file) throw new BrowserFault("BunMissing");
 return { file, script, env: browserEnvironment(process.env, dataDir, endpoint) };
}

export async function removeOwnedDescriptor(path: string, token: string): Promise<void> {
 try {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  if (record(raw) && raw.token === token) await rm(path, { force: true });
 } catch { /* absent, protected, malformed or replaced: never remove another desktop owner */ }
}

/** Created only after Electron is ready. Even state starts only the JSONL host, never Chrome. */
export class DesktopBrowser {
 #start: Promise<{ controller: BrowserController; endpoint: BrowserEndpoint; path: string }> | undefined;
 #closed = false;
 #closing: Promise<void> | undefined;
 constructor(private readonly appPath: string) {}
 async #init() {
  if (this.#closed) throw new BrowserFault("Closed");
  return this.#start ??= (async () => {
   const config = cachedConfig() ?? await readDaemonConfig();
   if (!config.dataDir) throw new BrowserFault("DataDir");
   const dataDir = config.dataDir;
   const path = join(dataDir, "browser", "desktop.json");
   let endpoint: BrowserEndpoint;
   const host = new JsonlBrowserHost(() => browserHostLaunch(this.appPath, dataDir, { path, port: endpoint.port, token: endpoint.token }));
   const controller = new BrowserController(host);
   endpoint = await startBrowserServer(controller);
   return { controller, endpoint, path };
  })();
 }
 async call(action: unknown, args: unknown = {}): Promise<BrowserReply> {
  try { return await (await this.#init()).controller.ui(action, args); }
  catch (error) { return { ok: false, error: publicError(error, typeof action === "string" ? action : undefined) }; }
 }
 close(): Promise<void> {
  if (this.#closing) return this.#closing;
  this.#closed = true;
  this.#closing = (async () => {
   const state = await this.#start?.catch(() => undefined);
   if (!state) return;
   try { await state.controller.close(); }
   finally { await state.endpoint.close(); await removeOwnedDescriptor(state.path, state.endpoint.token); }
  })();
  return this.#closing;
 }
}
