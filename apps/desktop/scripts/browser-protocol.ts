import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** A passive JSONL probe runs on the build host, even when staging a different target OS/architecture.
 * No desktop descriptor or real Chrome profile is supplied, and ui_state must never start Chrome. */
export function assertSharedBrowserHost(directory: string, environment: NodeJS.ProcessEnv = process.env): void {
 const script = join(directory, "node_modules", "dinobot", "browser-host.js");
 const unused = join(directory, ".browser-protocol-unused");
 // Windows environment names are case-insensitive; remove every spelling before supplying isolated config.
 const env = Object.fromEntries(Object.entries(environment).filter(([key]) => !key.toUpperCase().startsWith("DINOBOT_BROWSER_")));
 const result = spawnSync(process.execPath, [script], { cwd: directory, input: JSON.stringify({ id: 1, cmd: "ui_state", args: {} }) + "\n", encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 512 * 1024,
  env: { ...env, DINOBOT_BROWSER_CONFIG: JSON.stringify({ mode: "dedicated", browser: "chrome", profile: unused, userDataDir: unused, humanize: false }) } });
 let compatible = false;
 try {
  const reply = JSON.parse(result.stdout.toString());
  compatible = result.status === 0 && reply.id === 1 && reply.ok === true && reply.result?.ui?.ok === true && reply.result.ui.state?.connected === false && reply.result.ui.state?.mode === "dedicated";
 } catch { /* Never echo untrusted child output or environment into build logs. */ }
 if (!compatible) throw new Error("Bundled dinobot does not support the shared-browser protocol. Release the updated browser host and update dinobotDaemon.dinobot before packaging this desktop app.");
}
