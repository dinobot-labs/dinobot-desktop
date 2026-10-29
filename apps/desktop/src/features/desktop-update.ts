import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isNewerStableVersion } from "./update.ts";

/**
 * Updates of the desktop app itself, for copies installed by the installer (scripts/install). The installer
 * leaves ~/.dinobot/desktop/install.json with the download base URL (public or an older invite); without it (dev builds, hand-copied apps) both
 * calls are no-ops. The check never throws; apply starts the installer detached, which closes this app only after
 * the new build is downloaded and verified, then starts it again.
 */

export type DesktopUpdate = { current: string; latest: string; newer: boolean };
type Options = { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; platform?: NodeJS.Platform };

const TIMEOUT_MS = 5_000;
/** A download base: an origin (public installs, e.g. https://updates.example.test) or an invite base (`<origin>/i/<token>`). */
const BASE_RE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/i\/[A-Za-z0-9_-]{32,64})?$|^http:\/\/(127\.0\.0\.1|localhost):\d+(\/i\/[A-Za-z0-9_-]{32,64})?$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.DINOBOT_DESKTOP_HOME || join(homedir(), ".dinobot", "desktop");
}

/** The download base URL from install.json, or null when this copy was not installed by the installer. */
export function installBase(env: NodeJS.ProcessEnv = process.env): string | null {
	try {
		const state = JSON.parse(readFileSync(join(stateDir(env), "install.json"), "utf8")) as { base?: unknown };
		return typeof state.base === "string" && BASE_RE.test(state.base) ? state.base : null;
	} catch {
		return null;
	}
}

export async function checkDesktopUpdate(current: string, options: Options = {}): Promise<DesktopUpdate | null> {
	const env = options.env ?? process.env;
	if (env.DINOBOT_NO_UPDATE_CHECK === "1") return null;
	const base = installBase(env);
	if (!base || !VERSION_RE.test(current)) return null;
	try {
		const response = await (options.fetch ?? fetch)(`${base}/latest.json`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
		if (!response.ok) return null;
		const manifest = (await response.json()) as { version?: unknown } | null;
		const latest = manifest?.version;
		if (typeof latest !== "string" || !VERSION_RE.test(latest)) return null;
		return { current, latest, newer: isNewerStableVersion(current, latest) };
	} catch {
		return null;
	}
}

/** Starts the installer detached (it outlives this app). false when there is nothing to run it with. */
export function applyDesktopUpdate(options: Options = {}): boolean {
	const env = options.env ?? process.env;
	const base = installBase(env);
	if (!base) return false;
	const dir = stateDir(env);
	mkdirSync(dir, { recursive: true });
	const log = openSync(join(dir, "update.log"), "a");
	const childEnv = { ...env, DINOBOT_DESKTOP_HOME: dir };
	const platform = options.platform ?? process.platform;
	const child =
		platform === "win32"
			? spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm '${base}/install.ps1' | iex`], {
					detached: true,
					windowsHide: true,
					stdio: ["ignore", log, log],
					env: { ...childEnv, DINOBOT_DESKTOP_RELAUNCH: "1" },
				})
			: spawn("/bin/bash", ["-c", 'curl -fsSL "$1/install.sh" | bash -s -- --relaunch --no-modify-path', "dinobot-update", base], {
					detached: true,
					stdio: ["ignore", log, log],
					env: childEnv,
				});
	child.unref();
	return true;
}
