import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ArtifactContent, ArtifactStat } from "../bridge-types.ts";
import { imageMime } from "./images.ts";

/**
 * Files the Artifacts panel may show: HTML pages and images the agent made. Only these extensions, only regular
 * files, never inside the daemon's data folder, and bounded sizes. The renderer shows HTML in a sandboxed iframe.
 */
export const HTML_EXTENSIONS: ReadonlySet<string> = new Set([".html", ".htm"]);
export const RASTER_EXTENSIONS: ReadonlySet<string> = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_SVG_BYTES = 5 * 1024 * 1024;
export const MAX_RASTER_BYTES = 25 * 1024 * 1024;
/** Paths checked per stat call. */
export const MAX_STAT_PATHS = 200;

export interface ArtifactPolicy {
	/** Folders never served (the daemon's dataDir: its database and logs). */
	blockedDirs: readonly string[];
	home?: string;
}

type Kind = "html" | "image";
function kindOf(path: string): Kind | undefined {
	const ext = extname(path).toLowerCase();
	if (HTML_EXTENSIONS.has(ext)) return "html";
	if (RASTER_EXTENSIONS.has(ext) || ext === ".svg") return "image";
	return undefined;
}

const inside = (child: string, dir: string): boolean => {
	const rel = relative(resolve(dir), child);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** `~` expanded and normalized; undefined for relative or empty input. */
export function absoluteArtifactPath(input: string, home = homedir()): string | undefined {
	const trimmed = input.trim();
	if (trimmed === "") return undefined;
	const expanded = trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\") ? resolve(home, trimmed.slice(2)) : trimmed;
	if (!isAbsolute(expanded)) return undefined;
	return resolve(expanded);
}

type Checked = { path: string; kind: Kind; bytes: number; mtimeMs: number } | { error: string };

/** The real file behind `input` when the policy allows it. */
export async function checkArtifact(input: unknown, policy: ArtifactPolicy): Promise<Checked> {
	if (typeof input !== "string") return { error: "not a path" };
	const path = absoluteArtifactPath(input, policy.home);
	if (path === undefined) return { error: "not an absolute path" };
	if (kindOf(path) === undefined) return { error: "not an HTML page or image" };
	let real: string;
	try {
		real = await realpath(path);
	} catch {
		return { error: "missing" };
	}
	const kind = kindOf(real);
	if (kind === undefined) return { error: "not an HTML page or image" };
	if (policy.blockedDirs.some((dir) => inside(real, dir) || inside(path, dir))) return { error: "blocked folder" };
	try {
		const info = await stat(real);
		if (!info.isFile()) return { error: "not a file" };
		if (info.size === 0) return { error: "empty file" };
		return { path: real, kind, bytes: info.size, mtimeMs: info.mtimeMs };
	} catch {
		return { error: "missing" };
	}
}

export async function statArtifacts(paths: unknown, policy: ArtifactPolicy): Promise<ArtifactStat[]> {
	if (!Array.isArray(paths)) return [];
	return Promise.all(
		paths.slice(0, MAX_STAT_PATHS).map(async (input): Promise<ArtifactStat> => {
			const requested = typeof input === "string" ? input : "";
			const checked = await checkArtifact(input, policy);
			return "error" in checked ? { requested, ok: false, error: checked.error } : { requested, ok: true, ...checked };
		}),
	);
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export async function readArtifact(input: unknown, policy: ArtifactPolicy): Promise<ArtifactContent | { error: string }> {
	const checked = await checkArtifact(input, policy);
	if ("error" in checked) return checked;
	const { path, kind, mtimeMs } = checked;
	const ext = extname(path).toLowerCase();
	const limit = kind === "html" ? MAX_HTML_BYTES : ext === ".svg" ? MAX_SVG_BYTES : MAX_RASTER_BYTES;
	if (checked.bytes > limit) return { error: `${mb(checked.bytes)} is over the ${mb(limit)} preview limit` };
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch {
		return { error: "unreadable" };
	}
	if (bytes.byteLength > limit) return { error: `${mb(bytes.byteLength)} is over the ${mb(limit)} preview limit` };
	if (kind === "html") return { kind: "html", path, text: bytes.toString("utf8"), bytes: bytes.byteLength, mtimeMs };
	if (ext === ".svg") {
		const text = bytes.toString("utf8");
		if (!/<svg[\s>]/i.test(text)) return { error: "not an SVG image" };
		return { kind: "image", path, mimeType: "image/svg+xml", data: bytes.toString("base64"), bytes: bytes.byteLength, mtimeMs };
	}
	const mimeType = imageMime(bytes);
	if (mimeType === undefined) return { error: "not a png/jpeg/gif/webp image" };
	return { kind: "image", path, mimeType, data: bytes.toString("base64"), bytes: bytes.byteLength, mtimeMs };
}
