import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { MAX_IN_MEMORY_ATTACHMENT_BYTES, type StagedAttachment } from "../bridge-types.ts";

/**
 * Path attachments of the composer. Only in-limit png/jpeg/gif/webp images can go inline as model vision input; any
 * other file (a video, a PDF, an oversized screenshot) is copied here and the message carries the copy's path, so the
 * agent opens it with its tools. The daemon runs on this machine (README), so the path is valid for it.
 *
 * Layout: `<root>/<yyyymmdd>-<hhmmss>-<8 hex>/<safe name>`, one fresh folder (mode 0700) per attachment so equal
 * names never collide. A failed copy removes its folder, so a folder exists only for a complete copy. Folders older
 * than {@link RETENTION_MS} are pruned once per app run; nothing outside that name pattern is ever removed. The root
 * must be a real folder only this user can write (Linux shares /tmp between users), or nothing is staged.
 */

export const ATTACHMENT_FOLDER = "dinobot-attachments";
/** The only names {@link pruneAttachments} removes. */
export const STAGE_DIR_RE = /^\d{8}-\d{6}-[0-9a-f]{8}$/;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NAME_BYTES = 200;
const MAX_EXTENSION_BYTES = 32;

export type StageResult = StagedAttachment | { error: string };

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
const reason = (error: unknown) => codeOf(error) ?? (error instanceof Error ? error.message : String(error));
const utf8 = (text: string) => Buffer.byteLength(text, "utf8");
const lastSegment = (name: string) => name.split(/[\\/]/).pop() ?? "";

/** The longest prefix of `text` (whole code points) that fits in `budget` UTF-8 bytes. */
function fitBytes(text: string, budget: number): string {
	let out = "";
	let used = 0;
	for (const char of text) {
		const size = utf8(char);
		if (used + size > budget) break;
		out += char;
		used += size;
	}
	return out;
}

/**
 * The staged file name: the last path segment in NFC with control characters, characters Windows forbids and the ones
 * special inside a double-quoted shell word (double quote, dollar, backtick, backslash) replaced by `_`, so the
 * quoted path in the message is safe to paste into a shell; no leading dots or spaces, no trailing dots or spaces, no
 * Windows device name, at most 200 UTF-8 bytes with a short extension kept. Never empty.
 */
export function safeAttachmentName(name: string): string {
	let safe = lastSegment(name)
		.normalize("NFC")
		.replace(/[\u0000-\u001f\u007f"$`\\:*?<>|]/g, "_")
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "");
	if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(safe)) safe = `_${safe}`;
	if (safe === "") safe = "attachment";
	if (utf8(safe) <= MAX_NAME_BYTES) return safe;
	const dot = safe.lastIndexOf(".");
	const extension = dot > 0 && utf8(safe.slice(dot)) <= MAX_EXTENSION_BYTES ? safe.slice(dot) : "";
	const stem = extension ? safe.slice(0, dot) : safe;
	return fitBytes(stem, MAX_NAME_BYTES - utf8(extension)) + extension;
}

/** Create the root (mode 0700) and check it is a real folder, not a symlink, that no other user can write. */
export async function ensureAttachmentRoot(root: string): Promise<void> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	const info = await lstat(root);
	const uid = process.getuid?.();
	if (!info.isDirectory()) throw new Error(`${root} is not a folder`);
	if (uid !== undefined && (info.uid !== uid || (info.mode & 0o022) !== 0)) throw new Error(`${root} is writable by another user`);
}

async function freshDir(root: string, now: Date): Promise<string> {
	for (let attempt = 0; ; attempt++) {
		const dir = join(root, `${stamp(now)}-${randomBytes(4).toString("hex")}`);
		try {
			await mkdir(dir, { mode: 0o700 });
			return dir;
		} catch (error) {
			if (codeOf(error) !== "EEXIST" || attempt >= 4) throw error;
		}
	}
}

/** Remove attachment folders older than `retentionMs` (by mtime); returns how many were removed. Never throws. */
export async function pruneAttachments(root: string, now = new Date(), retentionMs = RETENTION_MS): Promise<number> {
	let names: string[];
	try {
		names = await readdir(root);
	} catch {
		return 0;
	}
	let removed = 0;
	for (const name of names) {
		if (!STAGE_DIR_RE.test(name)) continue;
		const dir = join(root, name);
		try {
			const info = await lstat(dir);
			if (!info.isDirectory() || now.getTime() - info.mtimeMs <= retentionMs) continue;
			await rm(dir, { recursive: true, force: true });
			removed++;
		} catch {}
	}
	return removed;
}

const prunedRoots = new Set<string>();

async function intoFreshDir(root: string, now: Date, name: string, write: (dest: string) => Promise<void>): Promise<StageResult> {
	try {
		await ensureAttachmentRoot(root);
	} catch (error) {
		return { error: `${name}: cannot use the attachment folder (${reason(error)})` };
	}
	if (!prunedRoots.has(root)) {
		prunedRoots.add(root);
		await pruneAttachments(root, now);
	}
	let dir: string;
	try {
		dir = await freshDir(root, now);
	} catch (error) {
		return { error: `${name}: cannot create the attachment folder (${reason(error)})` };
	}
	const dest = join(dir, safeAttachmentName(name));
	try {
		await write(dest);
		const { size } = await stat(dest);
		return { kind: "file", path: dest, name, bytes: size };
	} catch (error) {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
		return { error: `${name}: cannot copy it (${reason(error)})` };
	}
}

/**
 * Stage the file at absolute path `source`: a copy-on-write clone where the file system can (APFS, Btrfs), a plain
 * copy otherwise. A folder is not copied; it is referenced in place. Anything else (a socket, a FIFO) is refused,
 * since reading it could block.
 */
export async function stageAttachmentPath(source: string, root: string, now = new Date()): Promise<StageResult> {
	const name = basename(source) || source;
	let info;
	try {
		info = await stat(source);
	} catch (error) {
		return { error: `${name}: cannot read it (${reason(error)})` };
	}
	if (info.isDirectory()) return { kind: "folder", path: source, name, bytes: 0 };
	if (!info.isFile()) return { error: `${name}: not a regular file` };
	return intoFreshDir(root, now, name, (dest) => copyFile(source, dest, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE));
}

/** Stage in-memory file data (a file with no path on disk) under `name`. */
export async function stageAttachmentData(name: string, data: Uint8Array, root: string, now = new Date()): Promise<StageResult> {
	const label = lastSegment(name) || "attachment";
	if (data.byteLength > MAX_IN_MEMORY_ATTACHMENT_BYTES) {
		return { error: `${label}: a file without a path on disk can be up to ${MAX_IN_MEMORY_ATTACHMENT_BYTES / 1024 / 1024} MB` };
	}
	return intoFreshDir(root, now, label, (dest) => writeFile(dest, data, { flag: "wx" }));
}
