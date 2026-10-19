import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Passive "a newer dinobot is published" check, the same contract as the TUI's: npm registry, silent on any failure,
 * cached, off with DINOBOT_NO_UPDATE_CHECK=1. It never installs anything.
 */
export const REGISTRY_URL = "https://registry.npmjs.org/dinobot/latest";
export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 5_000;

export type UpdateCheck = { latest: string; newer: boolean };
export type UpdateOptions = { cachePath: string; fetch?: typeof fetch; now?: () => number; env?: NodeJS.ProcessEnv };

const numeric = "(?:0|[1-9][0-9]*)";
const prerelease = "(?:" + numeric + "|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const semver = new RegExp("^(" + numeric + ")\\.(" + numeric + ")\\.(" + numeric + ")(?:-(" + prerelease + "(?:\\." + prerelease + ")*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$");

function parseVersion(value: unknown): RegExpExecArray | null {
	if (typeof value !== "string") return null;
	const match = semver.exec(value);
	return match?.[0] === value ? match : null;
}

const stableVersion = (value: unknown): value is string => {
	const parsed = parseVersion(value);
	return parsed !== null && parsed[4] === undefined;
};

/** Only stable targets count; build metadata never changes precedence. */
export function isNewerStableVersion(current: string, latest: string): boolean {
	const a = parseVersion(current);
	const b = parseVersion(latest);
	if (!a || !b || b[4] !== undefined) return false;
	for (let i = 1; i <= 3; i++) {
		const left = a[i]!;
		const right = b[i]!;
		if (left !== right) return left.length !== right.length ? right.length > left.length : right > left;
	}
	return a[4] !== undefined;
}

async function fetchLatest(fetcher: typeof fetch): Promise<string> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error("update check timed out"));
		}, TIMEOUT_MS);
	});
	try {
		// The race covers the body too, so a fetch that ignores the signal cannot hold the check.
		return await Promise.race([timeout, (async () => {
			const response = await fetcher(REGISTRY_URL, { signal: controller.signal, redirect: "error", headers: { accept: "application/json" } });
			if (!response.ok || response.redirected) throw new Error("registry request failed");
			const metadata = (await response.json()) as { name?: unknown; version?: unknown } | null;
			if (!metadata || metadata.name !== "dinobot" || !stableVersion(metadata.version)) throw new Error("invalid registry metadata");
			return metadata.version;
		})()]);
	} finally {
		clearTimeout(timer);
	}
}

async function cachedLatest(path: string, now: number): Promise<string | null> {
	try {
		const cache = JSON.parse(await readFile(path, "utf8")) as { schemaVersion?: unknown; latest?: unknown; checkedAt?: unknown } | null;
		const checkedAt = cache?.checkedAt;
		if (cache?.schemaVersion === 1 && stableVersion(cache.latest) && typeof checkedAt === "number" && Number.isSafeInteger(checkedAt) && checkedAt >= 0 && checkedAt <= now && now - checkedAt < UPDATE_CACHE_TTL_MS) return cache.latest;
	} catch {}
	return null;
}

async function cacheLatest(path: string, latest: string, checkedAt: number): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(temporary, JSON.stringify({ schemaVersion: 1, latest, checkedAt }), { flag: "wx", mode: 0o600 });
		await rename(temporary, path);
	} catch {
	} finally {
		await rm(temporary, { force: true }).catch(() => {});
	}
}

/** `{ latest, newer }` for the installed `current` version; null when disabled, offline or anything else goes wrong. Never rejects. */
export async function checkUpdate(current: string, options: UpdateOptions): Promise<UpdateCheck | null> {
	try {
		if ((options.env ?? process.env).DINOBOT_NO_UPDATE_CHECK === "1") return null;
		if (!parseVersion(current)) return null;
		const now = (options.now ?? Date.now)();
		if (!Number.isSafeInteger(now) || now < 0) return null;
		let latest = await cachedLatest(options.cachePath, now);
		if (latest === null) {
			latest = await fetchLatest(options.fetch ?? globalThis.fetch);
			await cacheLatest(options.cachePath, latest, now);
		}
		return { latest, newer: isNewerStableVersion(current, latest) };
	} catch {
		return null;
	}
}
