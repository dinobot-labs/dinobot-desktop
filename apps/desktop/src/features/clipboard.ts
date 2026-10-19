import { fileURLToPath } from "node:url";
import { clipboard } from "electron";
import { imageMime } from "./images.ts";

export type ClipboardImage = { mimeType: "image/png"; data: string; bytes: number };

/** A raw platform clipboard format, through the asynchronous clipboard API. */
const rawFormat = (format: string) => `electron application/osclipboard;format="${format}"`;

async function readType(type: string): Promise<Blob | undefined> {
	for (const item of await clipboard.read()) {
		if (!item.types.includes(type)) continue;
		const value = await item.getType(type).catch(() => undefined);
		if (value instanceof Blob) return value;
	}
	return undefined;
}

/** The clipboard image as PNG, or null when it holds none. Uses the asynchronous clipboard API, so nothing blocks the main process. */
export async function clipboardImage(): Promise<ClipboardImage | null> {
	if (!(await clipboard.has("image/png").catch(() => false))) return null;
	const blob = await readType("image/png");
	if (blob === undefined || blob.size === 0) return null;
	const png = Buffer.from(await blob.arrayBuffer());
	if (imageMime(png) !== "image/png") return null;
	return { mimeType: "image/png", data: png.toString("base64"), bytes: png.byteLength };
}

const fileUrls = (list: string): string[] =>
	list
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("file://"))
		.flatMap((line) => {
			try {
				return [fileURLToPath(line)];
			} catch {
				return [];
			}
		});

/** Files copied in the system file manager, best effort per platform; [] when there are none. */
export async function clipboardFilePaths(): Promise<string[]> {
	try {
		if (process.platform === "win32") {
			const blob = await readType(rawFormat("FileNameW"));
			if (blob === undefined) return [];
			const path = Buffer.from(await blob.arrayBuffer()).toString("utf16le").split("\0")[0] ?? "";
			return path === "" ? [] : [path];
		}
		const type = process.platform === "darwin" ? rawFormat("public.file-url") : "text/uri-list";
		const blob = await readType(type);
		return blob === undefined ? [] : fileUrls(await blob.text());
	} catch {
		return [];
	}
}
