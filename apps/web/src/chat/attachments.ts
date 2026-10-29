import { MESSAGE_IMAGE_LIMITS } from "@dinobot/contracts";
import type { StagedAttachment } from "../lib/bridge.ts";

/**
 * How a composer attachment travels. Models take only still png/jpeg/gif/webp images as input, within the daemon's
 * message bounds (MESSAGE_IMAGE_LIMITS); those go inline. Everything else (a video, a PDF, an oversized or fifth
 * image) is staged by the desktop main process and travels as a path in the message text, which the agent opens with
 * its tools.
 */

export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The message bound `file` would break next to the inline images already staged, or undefined when it fits. */
export type InlineRejection = "type" | "empty" | "size" | "count" | "total";

export function inlineRejection(file: { type: string; size: number }, staged: readonly { bytes: number }[]): InlineRejection | undefined {
	if (!INLINE_IMAGE_TYPES.has(file.type)) return "type";
	if (file.size <= 0) return "empty";
	if (file.size > MESSAGE_IMAGE_LIMITS.maxBytesPerImage) return "size";
	if (staged.length >= MESSAGE_IMAGE_LIMITS.maxImages) return "count";
	const total = staged.reduce((sum, image) => sum + image.bytes, 0);
	if (total + file.size > MESSAGE_IMAGE_LIMITS.maxTotalBytes) return "total";
	return undefined;
}

export const fitsInline = (file: { type: string; size: number }, staged: readonly { bytes: number }[]): boolean => inlineRejection(file, staged) === undefined;

export const sizeLabel = (bytes: number): string =>
	bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

/**
 * A path in double quotes. Staged file names are already safe there (no quote, `$`, backtick, backslash or control
 * character); a folder keeps its own name, so a path with a quote or control character is JSON-escaped instead and can
 * never break the line or the quoting.
 */
export const quotedPath = (path: string): string => (/["\u0000-\u001f\u007f]/.test(path) ? JSON.stringify(path) : `"${path}"`);

/** The note listing path attachments: one quoted absolute path per line. */
export function attachmentNote(files: readonly StagedAttachment[]): string {
	const lines = files.map((file) => (file.kind === "folder" ? `- ${quotedPath(file.path)} (폴더)` : `- ${quotedPath(file.path)} (${sizeLabel(file.bytes)})`));
	return [`[첨부 ${files.length}개 — 도구로 열 수 있는 경로예요]`, ...lines].join("\n");
}

/** The message text sent to the daemon: the person's text, then the attachment note. Unchanged without attachments. */
export function withAttachments(text: string, files: readonly StagedAttachment[]): string {
	if (files.length === 0) return text;
	const note = attachmentNote(files);
	return text.trim() ? `${text}\n\n${note}` : note;
}

/**
 * The absolute path a single-line paste names, or undefined: a quoted path, one with backslash-escaped spaces (what
 * terminals put on the clipboard), or a `file://` URL (percent-decoded; `file:///C:/x` gives `C:/x`). Plain text such
 * as a bare file name is not a path, so it pastes as text.
 */
export function pastedPath(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed === "" || /[\r\n]/.test(trimmed)) return undefined;
	let path = trimmed;
	if (path.startsWith("file://")) {
		try {
			const url = new URL(path);
			if (url.host !== "" && url.host !== "localhost") return undefined;
			path = decodeURIComponent(url.pathname);
		} catch {
			return undefined;
		}
		if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
	} else {
		const quote = path[0];
		if ((quote === '"' || quote === "'") && path.length >= 2 && path.endsWith(quote)) path = path.slice(1, -1);
		else path = path.replace(/\\ /g, " ");
	}
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) ? path : undefined;
}

/** Decoded bytes of canonical base64 (clipboard images arrive this way). */
export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
