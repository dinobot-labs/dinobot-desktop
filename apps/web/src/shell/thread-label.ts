import { localeTag } from "@dinobot/ui/i18n";
import type { SessionStatus } from "@dinobot/contracts";
import { createdAtOf } from "../state/app.ts";

/**
 * The sessions index keeps the latest message as one raw line: plain text, or the JSON of a content array. Pull the
 * readable text out and drop the `<from .../>` header.
 */
export function cleanPreview(raw: string | undefined): string {
	if (!raw) return "";
	let text = raw.trim();
	if (text.startsWith("{") || text.startsWith("[")) {
		const found = [...text.matchAll(/"text":"((?:[^"\\]|\\.)*)/g)].map((m) => m[1] ?? "").join(" ");
		text = found ? found.replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : "";
	}
	return text.replace(/<from [^>]*\/>\s*/g, "").replace(/\s+/g, " ").trim();
}

/** User previews carry the sender (`local: ...`); drop it. */
export const withoutSender = (text: string) => text.replace(/^[^\s:]{1,40}: /, "");

/** Remembered title, else the latest user message, else the creation time. */
export function threadLabel(key: string, titles: Record<string, string>, status?: SessionStatus): string {
	const title = titles[key];
	if (title) return title;
	if (status?.lastRole === "user") {
		const preview = withoutSender(cleanPreview(status.lastText));
		if (preview) return preview;
	}
	const created = createdAtOf(key);
	if (created) return `${new Date(created).toLocaleString(localeTag(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} 스레드`;
	return key.slice(key.indexOf(":") + 1);
}
