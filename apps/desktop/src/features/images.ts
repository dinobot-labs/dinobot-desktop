import { stat, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

/** The daemon's message image bounds (per image). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type LoadedImage = { mimeType: ImageMime; data: string; bytes: number };

const humanSize = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

/** The image MIME type the magic bytes identify, or undefined; PNG/JPEG/GIF/WebP only. */
export function imageMime(bytes: Uint8Array): ImageMime | undefined {
	const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
	if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
	if (["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6))) return "image/gif";
	if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
	return undefined;
}

/** A dropped or pasted path: surrounding quotes and `file://` URLs are accepted. */
export function normalizeImagePath(input: string): string {
	let path = input.trim();
	const quote = path[0];
	if ((quote === "'" || quote === '"') && path.length >= 2 && path.endsWith(quote)) path = path.slice(1, -1);
	if (path.startsWith("file://")) {
		try {
			path = fileURLToPath(path);
		} catch {}
	}
	return path;
}

/** An image file attached by path (paste or drop): png/jpg/jpeg/gif/webp up to the per-image limit, checked by magic bytes. */
export async function readImageFile(input: string): Promise<LoadedImage | { error: string }> {
	const path = normalizeImagePath(input);
	const unreadable = { error: `${path} is not a readable png/jpeg/gif/webp image` };
	if (path === "" || !IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) return unreadable;
	let size: number;
	try {
		const info = await stat(path);
		if (!info.isFile()) return unreadable;
		size = info.size;
	} catch {
		return unreadable;
	}
	if (size === 0) return unreadable;
	if (size > MAX_IMAGE_BYTES) return { error: `image is ${humanSize(size)}; the per-image limit is ${humanSize(MAX_IMAGE_BYTES)}` };
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch {
		return unreadable;
	}
	const mimeType = imageMime(bytes);
	if (mimeType === undefined) return unreadable;
	return { mimeType, data: bytes.toString("base64"), bytes: bytes.byteLength };
}
