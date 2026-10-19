import type { CodemodeCallReceipt } from "@dinobot/contracts";
import type { ToolBlock } from "./model.ts";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim() ?? "";

/** The one-line summary of a tool call shown next to its name. */
export function toolSummary(tool: ToolBlock): string {
	const a = tool.args;
	const calls = codemodeCalls(tool);
	if (tool.name === "codemode") {
		if (calls.length) {
			const names = [...new Set(calls.map((c) => c.name))];
			return `${calls.length}개 호출 · ${names.slice(0, 4).join(", ")}${names.length > 4 ? " …" : ""}`;
		}
		return firstLine(str(a.code) ?? "");
	}
	return (
		str(a.command) ??
		str(a.path) ??
		str(a.file_path) ??
		str(a.query) ??
		str(a.url) ??
		str(a.pattern) ??
		str(a.description) ??
		(Object.keys(a).length ? firstLine(JSON.stringify(a)) : "")
	);
}

export function codemodeCalls(tool: ToolBlock): CodemodeCallReceipt[] {
	const d = tool.details as { codemodeCalls?: unknown } | undefined;
	return Array.isArray(d?.codemodeCalls) ? (d.codemodeCalls as CodemodeCallReceipt[]) : [];
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
	const m = Math.floor(ms / 60_000);
	return `${m}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}
