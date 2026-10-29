import { runQuiet } from "./exec.ts";

/**
 * Which daemon the app is actually connected to. The update banner tells the user to run `dinobot update`, which only
 * helps for a daemon installed outside the app; the bundled daemon is updated with the app instead. What the app would
 * start (`DaemonConfig.bundled`) does not say which daemon answers: a CLI-installed daemon started from a terminal
 * takes the port first, and the app then connects to it.
 */
export type DaemonRuntime = "bundled" | "external" | "unknown";

const TIMEOUT_MS = 3_000;

/** `pid`'s full command line, or null when it cannot be read (no such process, no permission, no tool). Never rejects. */
export async function processCommandLine(pid: number, platform: NodeJS.Platform = process.platform): Promise<string | null> {
	if (!Number.isSafeInteger(pid) || pid <= 0) return null;
	const argv =
		platform === "win32"
			? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]
			: ["ps", "-ww", "-o", "command=", "-p", String(pid)];
	try {
		const result = await runQuiet(argv, process.cwd(), TIMEOUT_MS);
		const line = result.stdout.trim();
		return result.code === 0 && !result.timedOut && line !== "" ? line : null;
	} catch {
		return null;
	}
}

const normalize = (path: string, platform: NodeJS.Platform) => {
	const slashes = path.replaceAll("\\", "/");
	return platform === "win32" || platform === "darwin" ? slashes.toLowerCase() : slashes;
};

/** Classify a daemon command line against the bundled daemon's main.js (null when the app ships none). */
export function classifyDaemonCommand(commandLine: string | null, bundledMain: string | null, platform: NodeJS.Platform = process.platform): DaemonRuntime {
	if (commandLine === null) return "unknown";
	if (bundledMain === null) return "external";
	return normalize(commandLine, platform).includes(normalize(bundledMain, platform)) ? "bundled" : "external";
}

/** The connected daemon's runtime, from its pid. */
export async function daemonRuntime(pid: number, bundledMain: string | null, read: (pid: number) => Promise<string | null> = processCommandLine): Promise<DaemonRuntime> {
	return classifyDaemonCommand(await read(pid), bundledMain);
}

/**
 * Whether the `dinobot update` check applies to the connected daemon: yes for an external daemon, no for the bundled
 * one. When the process cannot be inspected, fall back to what the app would start.
 */
export function shouldCheckDaemonUpdate(runtime: DaemonRuntime, appStartsBundled: boolean): boolean {
	return runtime === "external" || (runtime === "unknown" && !appStartsBundled);
}
