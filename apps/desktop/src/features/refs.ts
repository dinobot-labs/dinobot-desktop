/**
 * `@` context references, the same contract as the TUI's composer:
 * `@file:path[:a-b]`, `@folder:path`, `@diff`, `@staged` and `@git:N` stay inline where the user typed them; their
 * content is appended under `--- Attached Context ---` before the message is sent.
 *
 * Everything here runs in the Electron main process, so every file and process access is asynchronous and the loops
 * that may see tens of thousands of entries yield to the event loop every few milliseconds.
 */
import { createReadStream } from "node:fs";
import { lstat, open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runGit, runQuiet } from "./exec.ts";

export type ReferenceKind = "diff" | "staged" | "file" | "folder" | "git";

export type ContextReference = {
	readonly raw: string;
	readonly kind: ReferenceKind;
	readonly target: string;
	readonly start: number;
	readonly end: number;
	readonly lineStart?: number;
	readonly lineEnd?: number;
};

export type RefItem = { insert: string; label: string; description?: string; kind: "kind" | "file" | "folder" };

export type RefsExpansion = { text: string; warnings: string[]; blocked?: string };

export type ExpandOptions = {
	readonly contextWindow?: number;
	/** Extra directories that must never be attached (dinobot's data dir: auth.json, sqlite). */
	readonly blockedDirs?: readonly string[];
	readonly home?: string;
};

export const CHARS_PER_TOKEN = 4;
export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const MAX_REFERENCES = 16;
export const FOLDER_LIMIT = 200;
export const MAX_REFERENCE_ROWS = 50;
export const WORKSPACE_LIMIT = 20_000;
const WORKSPACE_TTL_MS = 30_000;
const GIT_TIMEOUT_MS = 30_000;
const LINE_COUNT_MAX_BYTES = 4 * 1024 * 1024;
const RANGE_READ_MAX_BYTES = 64 * 1024 * 1024;
const SLICE_MS = 4;
const TRAILING_PUNCTUATION = ",.;!?";
const OPENERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const QUOTED = "(?:`[^`\\n]+`|\"[^\"\\n]+\"|'[^'\\n]+')";
const REFERENCE_PATTERN = new RegExp(`(?<![\\w/])@(?:(?<simple>diff|staged)\\b|(?<kind>file|folder|git):(?<value>${QUOTED}(?::\\d+(?:-\\d+)?)?|\\S+))`, "g");
const FILE_VALUE = /^(?:(?<quote>[`"'])(?<qpath>.+?)\k<quote>|(?<path>.+?))(?::(?<start>\d+)(?:-(?<end>\d+))?)?$/;
const NEEDS_QUOTING = /[\s()[\]{}<>"'`]/;
const SENSITIVE_HOME_FILES = [
	".ssh/authorized_keys", ".ssh/id_rsa", ".ssh/id_ed25519", ".ssh/config", ".bashrc", ".zshrc",
	".profile", ".bash_profile", ".zprofile", ".netrc", ".pgpass", ".npmrc", ".pypirc",
];
const SENSITIVE_HOME_DIRS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure", ".config/gcloud", ".config/gh"];
/** Where the same tools keep their credentials on Windows (%APPDATA%). */
const SENSITIVE_APPDATA_DIRS = ["gcloud", "GitHub CLI"];
const TEXT_EXTENSIONS = new Set([".py", ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".js", ".ts", ".tsx", ".jsx", ".sh", ".css", ".html"]);
const BINARY_EXTENSIONS = new Set([
	".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".pdf", ".zip", ".gz", ".tgz", ".xz", ".bz2", ".7z",
	".tar", ".jar", ".so", ".dylib", ".dll", ".exe", ".bin", ".wasm", ".sqlite", ".db", ".mp3", ".mp4", ".mov", ".woff", ".woff2", ".ttf", ".otf",
]);
const FENCE_LANGUAGES: Record<string, string> = {
	".py": "python", ".js": "javascript", ".ts": "typescript", ".tsx": "tsx", ".jsx": "jsx",
	".json": "json", ".md": "markdown", ".sh": "bash", ".yml": "yaml", ".yaml": "yaml", ".toml": "toml",
};
const REFERENCE_KINDS: readonly { name: string; description: string; insert: string }[] = [
	{ name: "diff", description: "Unstaged changes (git diff)", insert: "@diff " },
	{ name: "staged", description: "Staged changes (git diff --staged)", insert: "@staged " },
	{ name: "file:", description: "File contents, optionally :start-end", insert: "@file:" },
	{ name: "folder:", description: "Directory tree listing", insert: "@folder:" },
	{ name: "git:", description: "Last N commits with patches (max 10)", insert: "@git:" },
];

const yieldNow = () => new Promise<void>((done) => setImmediate(done));

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatReferenceValue(value: string): string {
	if (!NEEDS_QUOTING.test(value)) return value;
	for (const quote of ["`", "\"", "'"]) if (!value.includes(quote)) return `${quote}${value}${quote}`;
	return value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fuzzy matching: every query character in order; consecutive and word-boundary hits score better (lower is better).

export type FuzzyResult = { readonly matches: boolean; readonly score: number };

function scoreSubsequence(query: string, text: string): FuzzyResult {
	if (query.length === 0) return { matches: true, score: 0 };
	if (query.length > text.length) return { matches: false, score: 0 };
	let score = 0;
	let last = -1;
	let run = 0;
	for (let q = 0; q < query.length; q++) {
		const at = text.indexOf(query[q]!, last + 1);
		if (at === -1) return { matches: false, score: 0 };
		if (last === at - 1) {
			run++;
			score -= run * 5;
		} else {
			run = 0;
			if (last >= 0) score += (at - last - 1) * 2;
		}
		if (at === 0 || /[\s\-_./:]/.test(text[at - 1]!)) score -= 10;
		score += at * 0.1;
		last = at;
	}
	if (query === text) score -= 100;
	return { matches: true, score };
}

export function fuzzyMatch(query: string, text: string): FuzzyResult {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	const primary = scoreSubsequence(q, t);
	if (primary.matches) return primary;
	// "abc12" also finds "12abc" and the other way round.
	const letterDigits = /^([a-z]+)([0-9]+)$/.exec(q);
	const digitLetters = /^([0-9]+)([a-z]+)$/.exec(q);
	const swapped = letterDigits ? `${letterDigits[2]}${letterDigits[1]}` : digitLetters ? `${digitLetters[2]}${digitLetters[1]}` : "";
	if (swapped === "") return primary;
	const second = scoreSubsequence(swapped, t);
	return second.matches ? { matches: true, score: second.score + 5 } : primary;
}

type Scored<T> = { readonly item: T; readonly score: number; readonly text: string };

const compareScored = <T>(a: Scored<T>, b: Scored<T>): number => a.score - b.score || a.text.localeCompare(b.text);

/**
 * The best `limit` items for `query` in rank order (score, then text). An empty query keeps the input order. Bounded
 * top-k insertion instead of a full sort, and the scan yields to the event loop every few milliseconds.
 */
export async function rankTop<T>(items: readonly T[], query: string, textOf: (item: T) => string, limit: number): Promise<T[]> {
	if (limit <= 0) return [];
	const trimmed = query.trim();
	if (trimmed === "") return items.slice(0, limit);
	const top: Scored<T>[] = [];
	let sliceStart = performance.now();
	for (let index = 0; index < items.length; index++) {
		if ((index & 255) === 0 && performance.now() - sliceStart > SLICE_MS) {
			await yieldNow();
			sliceStart = performance.now();
		}
		const item = items[index]!;
		const text = textOf(item);
		const match = fuzzyMatch(trimmed, text);
		if (!match.matches) continue;
		const hit: Scored<T> = { item, score: match.score, text };
		if (top.length === limit && compareScored(hit, top[limit - 1]!) >= 0) continue;
		let low = 0;
		let high = top.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (compareScored(top[mid]!, hit) <= 0) low = mid + 1;
			else high = mid;
		}
		top.splice(low, 0, hit);
		if (top.length > limit) top.pop();
	}
	return top.map((hit) => hit.item);
}

// ---------------------------------------------------------------------------------------------------------------------
// Completion

export type WorkspaceEntry = { readonly path: string; readonly dir: boolean; readonly size?: number };

const workspaceCache = new Map<string, { readonly at: number; readonly entries: Promise<WorkspaceEntry[]> }>();

/** Cached for 30 s per folder; concurrent callers share one listing. */
export function workspaceEntries(cwd: string, now = Date.now()): Promise<WorkspaceEntry[]> {
	const key = resolve(cwd);
	const hit = workspaceCache.get(key);
	if (hit !== undefined && now - hit.at < WORKSPACE_TTL_MS) return hit.entries;
	const entries = listWorkspaceEntries(key).catch(() => []);
	workspaceCache.set(key, { at: now, entries });
	for (const [path, entry] of workspaceCache) if (now - entry.at >= WORKSPACE_TTL_MS) workspaceCache.delete(path);
	return entries;
}

export function clearWorkspaceCache(): void {
	workspaceCache.clear();
}

/**
 * Completion candidates under `cwd`, relative to it with `/` separators: tracked and untracked-but-not-ignored files
 * from git, else a bounded walk; folders are derived from the file paths. Files carry their size.
 */
export async function listWorkspaceEntries(cwd: string): Promise<WorkspaceEntry[]> {
	let files: string[];
	const git = await runGit(["ls-files", "-co", "--exclude-standard", "-z"], cwd, 10_000).catch(() => undefined);
	if (git !== undefined && git.code === 0 && !git.timedOut) files = git.stdout.split("\0").filter((line) => line !== "").slice(0, WORKSPACE_LIMIT);
	else files = (await walk(cwd, WORKSPACE_LIMIT).catch(() => [])).filter((entry) => !entry.dir).map((entry) => relative(cwd, entry.path).split(sep).join("/"));
	const dirs = new Set<string>();
	let sliceStart = performance.now();
	for (let index = 0; index < files.length; index++) {
		if ((index & 511) === 0 && performance.now() - sliceStart > SLICE_MS) {
			await yieldNow();
			sliceStart = performance.now();
		}
		const file = files[index]!;
		for (let at = file.lastIndexOf("/"); at > 0; at = file.lastIndexOf("/", at - 1)) {
			const dir = file.slice(0, at);
			if (dirs.has(dir)) break;
			dirs.add(dir);
		}
	}
	const sized: WorkspaceEntry[] = [];
	const BATCH = 128;
	for (let index = 0; index < files.length; index += BATCH) {
		const batch = await Promise.all(files.slice(index, index + BATCH).map(async (file): Promise<WorkspaceEntry | undefined> => {
			try {
				return { path: file, dir: false, size: (await stat(isAbsolute(file) ? file : join(cwd, file))).size };
			} catch {
				return undefined;
			}
		}));
		for (const entry of batch) if (entry !== undefined) sized.push(entry);
	}
	return [...[...dirs].sort().map((path) => ({ path, dir: true })), ...sized];
}

/**
 * Rows for the text after `@`: the fixed kinds and workspace paths for a bare query; files only after `file:`, folders
 * only after `folder:`, nothing after `git:` (the value is a number). At most 50 rows.
 */
export async function refsComplete(cwd: string, token: string, entries: (cwd: string) => Promise<readonly WorkspaceEntry[]> = workspaceEntries): Promise<RefItem[]> {
	if (token.startsWith("git:")) return [];
	const only = token.startsWith("file:") ? "file" : token.startsWith("folder:") ? "folder" : undefined;
	const path = only === undefined ? token : token.slice(only.length + 1);
	const kinds: RefItem[] = only === undefined
		? (await rankTop(REFERENCE_KINDS, token, (kind) => kind.name, REFERENCE_KINDS.length)).map((kind) => ({ insert: kind.insert, label: `@${kind.name}`, description: kind.description, kind: "kind" }))
		: [];
	let listed: readonly WorkspaceEntry[];
	try {
		listed = await entries(cwd);
	} catch {
		listed = [];
	}
	const filtered = only === undefined ? listed : listed.filter((entry) => (only === "folder" ? entry.dir : !entry.dir));
	const paths = await rankTop(filtered, path, (entry) => entry.path, MAX_REFERENCE_ROWS - kinds.length);
	return [
		...kinds,
		...paths.map((entry): RefItem => ({
			insert: `@${entry.dir ? "folder" : "file"}:${formatReferenceValue(entry.path)} `,
			label: entry.dir ? `${entry.path}/` : entry.path,
			description: entry.dir ? "folder" : entry.size === undefined ? "" : formatBytes(entry.size),
			kind: entry.dir ? "folder" : "file",
		})),
	];
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing

function stripTrailingPunctuation(value: string): string {
	let stripped = value;
	while (stripped !== "" && TRAILING_PUNCTUATION.includes(stripped.at(-1)!)) stripped = stripped.slice(0, -1);
	// "(see @file:x.ts)" must not swallow the closer.
	for (let last = stripped.at(-1); last !== undefined && last in OPENERS; last = stripped.at(-1)) {
		const count = (char: string): number => stripped.split(char).length - 1;
		if (count(last) <= count(OPENERS[last]!)) break;
		stripped = stripped.slice(0, -1);
	}
	return stripped;
}

const unwrap = (value: string): string => (value.length >= 2 && value[0] === value.at(-1) && "`\"'".includes(value[0]!) ? value.slice(1, -1) : value);

export function parseContextReferences(message: string): ContextReference[] {
	const refs: ContextReference[] = [];
	for (const match of message.matchAll(REFERENCE_PATTERN)) {
		const groups = match.groups ?? {};
		const start = match.index;
		if (groups.simple !== undefined) {
			refs.push({ raw: match[0], kind: groups.simple as ReferenceKind, target: "", start, end: start + match[0].length });
			continue;
		}
		const kind = groups.kind as ReferenceKind;
		const value = stripTrailingPunctuation(groups.value ?? "");
		if (value === "") continue;
		const raw = `@${kind}:${value}`;
		const base = { raw, kind, start, end: start + raw.length };
		if (kind !== "file") {
			refs.push({ ...base, target: unwrap(value) });
			continue;
		}
		const parsed = FILE_VALUE.exec(value)?.groups;
		if (parsed?.start === undefined) refs.push({ ...base, target: unwrap(value) });
		else {
			const lineStart = Number(parsed.start);
			refs.push({ ...base, target: parsed.qpath ?? parsed.path ?? "", lineStart, lineEnd: Math.max(lineStart, Number(parsed.end ?? parsed.start)) });
		}
	}
	return refs;
}

// ---------------------------------------------------------------------------------------------------------------------
// Expansion

type Expansion = { readonly warning?: string; readonly block?: string };

/**
 * Expands the references in `text`. Per-reference problems become warnings (the rest still expands); an injection past
 * half the context window is refused as a whole: `blocked` carries the reason and `text` is the original message.
 */
export async function refsExpand(cwd: string, text: string, options: ExpandOptions = {}): Promise<RefsExpansion> {
	const references = parseContextReferences(text);
	if (references.length === 0) return { text, warnings: [] };
	const window = options.contextWindow !== undefined && Number.isFinite(options.contextWindow) && options.contextWindow > 0 ? options.contextWindow : DEFAULT_CONTEXT_WINDOW;
	let root: string;
	try {
		root = await realpath(resolve(cwd));
	} catch (error) {
		const reason = `@ references not expanded: the working folder ${cwd} is not readable (${error instanceof Error ? error.message : String(error)})`;
		return { text, warnings: [reason], blocked: reason };
	}
	const hardLimit = Math.max(1, Math.floor(window * 0.5));
	const softLimit = Math.max(1, Math.floor(window * 0.25));
	const guard = await pathGuard(root, options);
	const expanded = await Promise.all(references.slice(0, MAX_REFERENCES).map((ref) => expandReference(ref, root, guard, hardLimit)));
	const warnings = expanded.flatMap((entry) => (entry.warning === undefined ? [] : [entry.warning]));
	for (const ref of references.slice(MAX_REFERENCES)) warnings.push(`${ref.raw}: not expanded (maximum ${MAX_REFERENCES} @-references per message)`);
	const blocks = expanded.flatMap((entry) => (entry.block === undefined ? [] : [entry.block]));
	const injectedTokens = blocks.reduce((sum, block) => sum + estimateTokens(block), 0);
	if (injectedTokens > hardLimit) {
		const reason = `@ context injection refused: ${injectedTokens} tokens exceeds the 50% hard limit (${hardLimit}).`;
		warnings.push(reason);
		return { text, warnings, blocked: reason };
	}
	if (injectedTokens > softLimit) warnings.push(`@ context injection warning: ${injectedTokens} tokens exceeds the 25% soft limit (${softLimit}).`);
	let final = text;
	if (warnings.length > 0) final += `\n\n--- Context Warnings ---\n${warnings.map((warning) => `- ${warning}`).join("\n")}`;
	if (blocks.length > 0) final += `\n\n--- Attached Context ---\n\n${blocks.join("\n\n")}`;
	return { text: final.trim(), warnings };
}

async function expandReference(ref: ContextReference, cwd: string, guard: PathGuard, maxTokens: number): Promise<Expansion> {
	try {
		if (ref.kind === "file" || ref.kind === "folder") return await expandPath(ref, cwd, guard, maxTokens);
		const args = ref.kind === "diff" ? ["diff"] : ref.kind === "staged" ? ["diff", "--staged"] : ["log", `-${Math.max(1, Math.min(Number.parseInt(ref.target, 10) || 1, 10))}`, "-p"];
		return await expandGit(ref, cwd, args);
	} catch (error) {
		return { warning: `${ref.raw}: ${error instanceof Error ? error.message : String(error)}` };
	}
}

type PathGuard = { readonly root: string; readonly blockedFiles: ReadonlySet<string>; readonly blockedDirs: readonly string[] };

const caseless = process.platform === "win32" || process.platform === "darwin";
const fold = (path: string): string => (caseless ? path.toLowerCase() : path);

async function canonical(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return resolve(path);
	}
}

async function pathGuard(root: string, options: ExpandOptions): Promise<PathGuard> {
	const home = await canonical(options.home ?? homedir());
	const appData = process.platform === "win32" && options.home === undefined && process.env.APPDATA ? SENSITIVE_APPDATA_DIRS.map((dir) => join(process.env.APPDATA!, dir)) : [];
	const blockedDirs = await Promise.all([...SENSITIVE_HOME_DIRS.map((dir) => join(home, dir)), ...appData, ...(options.blockedDirs ?? [])].map(canonical));
	return { root, blockedFiles: new Set(SENSITIVE_HOME_FILES.map((file) => fold(join(home, file)))), blockedDirs };
}

const isUnder = (path: string, root: string): boolean => {
	const p = fold(path);
	const r = fold(root);
	return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
};

function isEnvFile(path: string): boolean {
	const name = basename(path);
	return (name === ".env" || name.startsWith(".env.")) && !/\.(example|sample|template)$/.test(name);
}

/** Lexical and symlink-resolved checks: the workspace root contains both, and neither is a credential path. */
async function resolveAllowed(target: string, cwd: string, guard: PathGuard): Promise<string> {
	const expanded = target === "~" || target.startsWith("~/") || target.startsWith("~\\") ? join(homedir(), target.slice(1)) : target;
	const lexical = resolve(cwd, expanded);
	const real = await canonical(lexical);
	for (const path of [lexical, real]) {
		if (!isUnder(path, guard.root)) throw new Error("path is outside the allowed workspace");
		if (guard.blockedFiles.has(fold(path)) || isEnvFile(path) || guard.blockedDirs.some((dir) => isUnder(path, dir))) {
			throw new Error("path is a sensitive credential file and cannot be attached");
		}
	}
	return real;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

async function expandPath(ref: ContextReference, cwd: string, guard: PathGuard, maxTokens: number): Promise<Expansion> {
	const path = await resolveAllowed(ref.target, cwd, guard);
	if (!(await exists(path))) return { warning: `${ref.raw}: ${ref.kind} not found` };
	const info = await stat(path);
	if (ref.kind === "folder") {
		if (!info.isDirectory()) return { warning: `${ref.raw}: path is not a folder` };
		const listing = await folderListing(path, cwd);
		return { block: `📁 ${ref.raw} (${estimateTokens(listing)} tokens)\n${listing}` };
	}
	if (!info.isFile()) return { warning: `${ref.raw}: path is not a file` };
	if (await isBinaryFile(path)) return { block: onDiskBlock(ref, path, info.size, "binary file", "binary file, not inlined as text.", "Use your tools to work with it; do not tell the user the file type is unsupported.") };
	const charBudget = maxTokens * CHARS_PER_TOKEN;
	if (info.size > (ref.lineStart === undefined ? charBudget : RANGE_READ_MAX_BYTES)) return { block: oversizedBlock(ref, path, info.size, Math.ceil(info.size / CHARS_PER_TOKEN)) };
	let text: string;
	if (ref.lineStart === undefined) {
		text = await readFile(path, "utf8");
		if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	} else text = await readLineRange(path, ref.lineStart, ref.lineEnd ?? ref.lineStart);
	const tokens = estimateTokens(text);
	if (tokens > maxTokens) return { block: oversizedBlock(ref, path, info.size, tokens) };
	return { block: `📄 ${ref.raw} (${tokens} tokens)\n\`\`\`${FENCE_LANGUAGES[extname(path).toLowerCase()] ?? ""}\n${text}\n\`\`\`` };
}

/** Lines `start..end` (1-based, inclusive), streamed so a large file is never held or split at once; the final newline is dropped. */
export async function readLineRange(path: string, start: number, end: number): Promise<string> {
	const parts: Buffer[] = [];
	let line = 1;
	const stream = createReadStream(path, { highWaterMark: 256 * 1024 });
	try {
		outer: for await (const chunk of stream as AsyncIterable<Buffer>) {
			let position = 0;
			while (position < chunk.length) {
				const newline = chunk.indexOf(10, position);
				const stop = newline === -1 ? chunk.length : newline + 1;
				if (line >= start && line <= end) parts.push(chunk.subarray(position, stop));
				if (newline === -1) break;
				position = stop;
				line++;
				if (line > end) break outer;
			}
		}
	} finally {
		stream.destroy();
	}
	let text = Buffer.concat(parts).toString("utf8");
	if (start === 1 && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	return text.replace(/\n$/, "");
}

function onDiskBlock(ref: ContextReference, path: string, size: number, descriptor: string, reason: string, guidance: string): string {
	return `📎 ${ref.raw} (${descriptor}, ${formatBytes(size)}) — ${reason} It is available on disk at \`${path}\`. ${guidance}`;
}

const oversizedBlock = (ref: ContextReference, path: string, size: number, tokens: number): string =>
	onDiskBlock(ref, path, size, `text file, approximately ${tokens} tokens`, "too large to inline safely.", "Read only the relevant line ranges or search it with your tools; do not load the entire file into context.");

async function isBinaryFile(path: string): Promise<boolean> {
	const ext = extname(path).toLowerCase();
	if (BINARY_EXTENSIONS.has(ext) && !TEXT_EXTENSIONS.has(ext)) return true;
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(4096);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		return buffer.subarray(0, bytesRead).includes(0);
	} finally {
		await handle.close();
	}
}

async function expandGit(ref: ContextReference, cwd: string, args: readonly string[]): Promise<Expansion> {
	const result = await runGit([...args, "--no-ext-diff", "--no-textconv", "--no-color"], cwd, GIT_TIMEOUT_MS);
	if (result.timedOut) return { warning: `${ref.raw}: git command timed out (30s)` };
	if (result.code !== 0) return { warning: `${ref.raw}: ${result.stderr.trim() || "git command failed"}` };
	const content = result.stdout.trim() || "(no output)";
	return { block: `🧾 git ${args.join(" ")} (${estimateTokens(content)} tokens)\n\`\`\`diff\n${content}\n\`\`\`` };
}

async function fileMetadata(path: string, size: number): Promise<string> {
	try {
		if (size > LINE_COUNT_MAX_BYTES || (await isBinaryFile(path))) return `${size} bytes`;
		const bytes = await readFile(path);
		let lines = 1;
		for (let at = bytes.indexOf(10); at !== -1; at = bytes.indexOf(10, at + 1)) lines++;
		return `${lines} lines`;
	} catch {
		return `${size} bytes`;
	}
}

type FolderEntry = { readonly path: string; readonly dir: boolean };

async function folderListing(path: string, cwd: string): Promise<string> {
	const entries = await visibleEntries(path, cwd, FOLDER_LIMIT);
	const lines = [`${relative(cwd, path) || "."}/`];
	for (const entry of entries) {
		const depth = relative(path, entry.path).split(sep).length - 1;
		const indent = "  ".repeat(Math.max(0, depth));
		if (entry.dir) lines.push(`${indent}- ${basename(entry.path)}/`);
		else {
			let size = 0;
			try {
				size = (await stat(entry.path)).size;
			} catch {}
			lines.push(`${indent}- ${basename(entry.path)} (${await fileMetadata(entry.path, size)})`);
		}
	}
	if (entries.length >= FOLDER_LIMIT) lines.push("- ...");
	return lines.join("\n");
}

async function visibleEntries(path: string, cwd: string, limit: number): Promise<FolderEntry[]> {
	let files: string[] | undefined;
	try {
		const rg = await runQuiet(["rg", "--files", path], cwd, 10_000);
		if (rg.code === 0 && !rg.timedOut) files = rg.stdout.split(/\r?\n/).filter((line) => line !== "").map((line) => resolve(cwd, line)).sort().slice(0, limit);
	} catch {
		files = undefined;
	}
	if (files === undefined) return walk(path, limit);
	const output = new Map<string, FolderEntry>();
	for (const file of files) {
		for (let parent = resolve(file, ".."); isUnder(parent, path) && parent !== path; parent = resolve(parent, "..")) output.set(parent, { path: parent, dir: true });
		output.set(file, { path: file, dir: false });
	}
	return [...output.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(root: string, limit: number): Promise<FolderEntry[]> {
	const output: FolderEntry[] = [];
	const visit = async (dir: string): Promise<void> => {
		const children = (await readdir(dir, { withFileTypes: true })).filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules").sort((a, b) => a.name.localeCompare(b.name));
		for (const child of children) {
			if (output.length >= limit) return;
			const path = join(dir, child.name);
			output.push({ path, dir: child.isDirectory() });
			if (child.isDirectory()) await visit(path);
		}
	};
	await visit(root);
	return output;
}
