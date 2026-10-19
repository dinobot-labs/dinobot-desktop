/**
 * Artifacts: HTML pages and images the agent made or pointed at in a thread. The reducer records every path it sees in
 * a settled assistant message (the answer text, write/edit calls, `tools.write` inside codemode) and in image_gen
 * results; the panel asks the desktop main process which of them exist and shows those. Pure functions; no I/O.
 */

export type ArtifactKind = "html" | "image";
/** How the path showed up: a file the agent wrote, a generated image, or a path named in the answer. */
export type ArtifactSource = "write" | "image" | "mention";

export interface ArtifactMention {
	readonly raw: string;
	readonly at: number;
	readonly source: ArtifactSource;
}

export interface ArtifactCandidate {
	/** Absolute (or `~/`) path, resolved against the thread's working folder. */
	readonly path: string;
	readonly name: string;
	readonly kind: ArtifactKind;
	readonly at: number;
	readonly source: ArtifactSource;
}

const EXT = "html?|png|jpe?g|gif|webp|svg";
const KIND = new RegExp(`\\.(${EXT})$`, "i");
/** Most recent candidates kept per thread. */
export const MAX_ARTIFACTS = 100;

export function artifactKind(path: string): ArtifactKind | undefined {
	const ext = KIND.exec(path)?.[1]?.toLowerCase();
	if (!ext) return undefined;
	return ext === "html" || ext === "htm" ? "html" : "image";
}

export function baseName(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

// Windows absolute path: C:\a\b.png or C:/a/b.png (no spaces; backticks below cover paths with spaces).
const WINDOWS = new RegExp(`(?<![\\w])([A-Za-z]:[\\\\/][^\\s"'\`<>|*?:()\\[\\]]*?\\.(?:${EXT}))(?![\\w.])`, "gi");
// POSIX absolute, ~/, ./, ../ or plain relative path, starting after a delimiter so URLs (scheme:) never match.
const OTHER = new RegExp(`(?:^|[\\s"'(\\[<\`=])((?:~|\\.{1,2})?[\\\\/]?(?:[^\\s"'\`<>|*?:()\\[\\]]+[\\\\/])*[^\\s"'\`<>|*?:()\\[\\]\\\\/]+\\.(?:${EXT}))(?![\\w.])`, "gim");
// A whole inline code span that is a path (may contain spaces).
const CODE_SPAN = new RegExp(`\`([^\`\\n]+?\\.(?:${EXT}))\``, "gi");
const FILE_URL = /file:\/\/\/[^\s"'`<>()]+/gi;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;

function clean(raw: string): string | undefined {
	let p = raw.trim();
	if (p.startsWith("file:///")) {
		try {
			p = decodeURIComponent(p.slice("file://".length));
		} catch {
			return undefined;
		}
		if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
	}
	if (p === "" || URL_LIKE.test(p) || p.startsWith("//") || p.includes("*")) return undefined;
	return artifactKind(p) ? p : undefined;
}

/** Artifact-looking paths named in free text (an answer), in order of appearance, without duplicates. */
export function pathsInText(text: string): string[] {
	const out: string[] = [];
	const add = (raw: string | undefined) => {
		const p = raw === undefined ? undefined : clean(raw);
		if (p && !out.includes(p)) out.push(p);
	};
	// Code spans and file:// URLs are taken whole, then blanked so the plain passes do not see their pieces.
	const masked = text
		.replace(CODE_SPAN, (whole, span: string) => {
			if (/^(?:[A-Za-z]:[\\/]|file:\/\/\/|~?[\\/]|\.{1,2}[\\/])/.test(span) || !/\s/.test(span)) add(span);
			return " ".repeat(whole.length);
		})
		.replace(FILE_URL, (url) => {
			add(url);
			return " ".repeat(url.length);
		});
	for (const m of masked.matchAll(WINDOWS)) add(m[1]);
	for (const m of masked.matchAll(OTHER)) add(m[1]);
	return out;
}

const PATH_ARGS = ["path", "file_path", "filePath"] as const;
const CODE_WRITE = /tools\.(?:write|edit)\(\s*\{[^}]*?\bpath\s*:\s*(["'`])((?:(?!\1).)+)\1/g;

/** Paths written by a tool call: write/edit arguments, or `tools.write({path: "..."})` literals inside codemode. */
export function pathsInToolCall(name: string, args: Record<string, unknown>): string[] {
	const out: string[] = [];
	if (name === "write" || name === "edit") {
		for (const key of PATH_ARGS) {
			const v = args[key];
			const p = typeof v === "string" ? clean(v) : undefined;
			if (p) out.push(p);
		}
	} else if (name === "codemode" && typeof args.code === "string") {
		for (const m of args.code.matchAll(CODE_WRITE)) {
			const raw = (m[2] ?? "").replace(/\\\\/g, "\\");
			const p = m[1] === "`" && raw.includes("${") ? undefined : clean(raw);
			if (p && !out.includes(p)) out.push(p);
		}
	}
	return out;
}

const SAVED_IMAGE = /Saved generated image to (.+?)\s*(?:\r?\n|$)/g;

/** Images an image_gen call saved (directly or inside codemode): "Saved generated image to <path>". */
export function pathsInToolResult(name: string, text: string): string[] {
	if (name !== "image_gen_generate" && name !== "codemode") return [];
	const out: string[] = [];
	for (const m of text.matchAll(SAVED_IMAGE)) {
		const p = clean((m[1] ?? "").replace(/^["']|["']$/g, ""));
		if (p && !out.includes(p)) out.push(p);
	}
	return out;
}

const isWindowsPath = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");

/**
 * An absolute path for a raw path seen in the thread, or undefined when it cannot be placed. Relative paths resolve
 * against the thread's working folder; MSYS `/c/Users/...` becomes `C:/Users/...` when that folder is a Windows path.
 * `~/` stays for the main process to expand.
 */
export function resolveArtifactPath(raw: string, cwd: string | undefined): string | undefined {
	if (isWindowsPath(raw)) return raw;
	const msys = /^\/([A-Za-z])\/(.*)$/.exec(raw);
	if (msys && cwd !== undefined && isWindowsPath(cwd)) return `${msys[1]?.toUpperCase()}:/${msys[2]}`;
	if (raw.startsWith("/") || raw.startsWith("~/") || raw.startsWith("~\\")) return raw;
	if (cwd === undefined || cwd === "") return undefined;
	const sep = isWindowsPath(cwd) ? "\\" : "/";
	const rel = raw.replace(/^\.[\\/]/, "");
	return `${cwd.replace(/[\\/]+$/, "")}${sep}${rel}`;
}

/** Identity of a path for de-duplication: separators unified, case folded on Windows drives. */
export function artifactKey(path: string): string {
	const unified = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
	return isWindowsPath(path) ? unified.toLowerCase() : unified;
}

/** Record paths into the per-thread map (latest mention wins and moves to the end). Returns whether anything changed. */
export function recordArtifacts(map: Map<string, ArtifactMention>, paths: readonly string[], source: ArtifactSource, at: number): boolean {
	let changed = false;
	// Reverse, so within one message the first path named ends up newest (listed first).
	for (const raw of [...paths].reverse()) {
		const previous = map.get(raw);
		// A written file stays "write" even when the answer mentions it later.
		const kept: ArtifactSource = previous && previous.source !== "mention" && source === "mention" ? previous.source : source;
		if (previous && previous.at === at && previous.source === kept) continue;
		map.delete(raw);
		map.set(raw, { raw, at, source: kept });
		changed = true;
	}
	while (map.size > MAX_ARTIFACTS * 2) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
	return changed;
}

/** Candidates newest first, resolved against `cwd`, one per file. */
export function artifactCandidates(map: ReadonlyMap<string, ArtifactMention>, cwd: string | undefined): ArtifactCandidate[] {
	const out: ArtifactCandidate[] = [];
	const seen = new Set<string>();
	for (const mention of [...map.values()].reverse()) {
		const path = resolveArtifactPath(mention.raw, cwd);
		const kind = path === undefined ? undefined : artifactKind(path);
		if (path === undefined || kind === undefined) continue;
		const key = artifactKey(path);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ path, name: baseName(path), kind, at: mention.at, source: mention.source });
		if (out.length >= MAX_ARTIFACTS) break;
	}
	return out;
}
