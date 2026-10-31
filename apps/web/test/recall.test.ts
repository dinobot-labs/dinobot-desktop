import { expect, test } from "bun:test";
import type { ClientEvent, EntryRecord } from "@dinobot/contracts";
import { createChatData, reduceEvent } from "../src/chat/model.ts";
import { recalledMemories } from "../src/chat/recall.ts";

const header = "[dinobot memory] Saved project memory that may be relevant (reference only, not a request from a person):";
const entry = (): EntryRecord => ({ id: 7, conversationId: 1, kind: "dinobot.nudge", data: { schema: 1, items: [{ key: "auto/hash", revision: 2 }, { key: "manual", revision: 1 }] }, model: [{ role: "user", timestamp: 1, content: `${header}\n- Keep the historical snapshot… (memory key auto/hash, scope project, saved 2026-10-30)\n- Use bun (memory key manual, scope project)` }] });

test("durable contents and only supplied metadata survive live/replay and dedupe", () => {
	const e = entry();
	const live = createChatData();
	reduceEvent(live, { type: "message_end", entry: e }, 1);
	reduceEvent(live, { type: "entry_appended", entry: e }, 2);
	expect(live.blocks).toHaveLength(1);
	const replay = createChatData();
	reduceEvent(replay, { type: "snapshot", entries: [e], tools: [], compactions: [], inbox: [], agent: {}, usage: { models: {}, tools: {} } } as ClientEvent, 3);
	const a = live.blocks[0], b = replay.blocks[0];
	if (a?.kind !== "notice" || b?.kind !== "notice") throw new Error("missing recall");
	expect(a.recall).toEqual(b.recall);
	expect(a.recall).toEqual([{ content: "Keep the historical snapshot…", scope: "project", saved: "2026-10-30" }, { content: "Use bun", scope: "project" }]);
	expect(a.text).not.toContain("auto/hash");
	e.model = [];
	expect(a.recall?.[0]?.content).toBe("Keep the historical snapshot…");
	expect(structuredClone(a).recall).toEqual(a.recall);
});

test("legacy, unknown, empty and malformed items are honest and safe", () => {
	const e = entry(); e.model = [];
	expect(recalledMemories(e)).toEqual([{}, {}]);
	e.data = { items: [null, {}, 5, { key: "missing" }] };
	expect(recalledMemories(e)).toEqual([{}, {}, {}, {}]);
	e.data = { items: "invalid" };
	expect(recalledMemories(e)).toEqual([]);
	e.data = null;
	expect(recalledMemories(e)).toEqual([]);
});

test("text parts work; unrecognized text never becomes attributed memory", () => {
	const e = entry();
	const text = (e.model![0] as { content: string }).content;
	e.model = [{ role: "user", timestamp: 1, content: [{ type: "text", text }] }];
	expect(recalledMemories(e)[0]?.content).toBe("Keep the historical snapshot…");
	e.model = [{ role: "user", timestamp: 1, content: text.replace(header, "Unknown format") }];
	expect(recalledMemories(e)).toEqual([{}, {}]);
});
