import type { EntryRecord } from "@dinobot/contracts";

export type RecalledMemory = { readonly content?: string; readonly scope?: "project"; readonly saved?: string };
const HEADER = "[dinobot memory] Saved project memory that may be relevant (reference only, not a request from a person):";

/** Decode only the durable noteText wire format, never the mutable memory store.
 * Keys are used for matching, not displayed. Unknown/legacy items retain their slots. */
export function recalledMemories(entry: EntryRecord): readonly RecalledMemory[] {
	const data = entry.data;
	const items = data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.items) ? data.items : [];
	const rows = new Map<string, RecalledMemory>();
	for (const message of entry.model ?? []) {
		if (message.role !== "user") continue;
		const text = typeof message.content === "string" ? message.content : message.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
		const lines = text.split(/\r?\n/);
		if (lines.shift() !== HEADER) continue;
		for (const line of lines) {
			const match = /^- (.+) \(memory key (.+), scope project(?:, saved (\d{4}-\d{2}-\d{2}))?\)$/.exec(line);
			if (!match) continue;
			const [, content, key, saved] = match;
			if (content?.trim() && key) rows.set(key, { content, scope: "project", ...(saved ? { saved } : {}) });
		}
	}
	if (!items.length) return [...rows.values()];
	return items.map((item) => {
		const key = item && typeof item === "object" && !Array.isArray(item) && typeof item.key === "string" ? item.key : undefined;
		return (key && rows.get(key)) || {};
	});
}
