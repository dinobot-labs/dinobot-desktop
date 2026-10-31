import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientEvent, EntryRecord, UserMessage } from "@dinobot/contracts";
import { createChatData, ingestEntry, reduceEvent } from "../src/chat/model.ts";
import { NudgeRow, UserRow } from "../src/chat/blocks.tsx";

const wake = '<from host="subagents"/>\nBackground work changed state after your last answer:\nTask completed; another blocked.';
const human = (body: string) => '<from user="person" channel="http"/>\n' + body;
const entry = (content: UserMessage["content"], id = 1): EntryRecord => ({ id, conversationId: 1, kind: "pi.user", model: [{ role: "user", content, timestamp: 1234567890000 }] });

test("snapshot and live deliveries classify identically, deduplicate and preserve raw text", () => {
 const e = entry(wake);
 const snapshot = { type: "snapshot", entries: [e], tools: [], compactions: [], inbox: [], agent: {}, usage: { models: {}, tools: {} } } as ClientEvent;
 const d = createChatData();
 reduceEvent(d, snapshot, 1);
 for (const type of ["message_end", "entry_appended"] as const) reduceEvent(d, { type, entry: e }, 2);
 expect(d.blocks).toHaveLength(1);
 expect(d.blocks[0]).toMatchObject({ kind: "nudge", text: wake, at: 1234567890000 });
 const live = createChatData();
 reduceEvent(live, { type: "message_start", message: e.model![0]! }, 1);
 reduceEvent(live, { type: "message_end", entry: e }, 2);
 reduceEvent(live, { type: "entry_appended", entry: e }, 3);
 expect(live.blocks).toHaveLength(1);
 expect(live.blocks[0]).toMatchObject({ kind: "nudge", text: wake });
 reduceEvent(d, snapshot, 3);
 expect(d.blocks).toHaveLength(1);
});

test("only exact raw producer envelope is recognized; pasted, quoted, unknown and malformed headers remain users", () => {
 for (const raw of [human(wake), human("quoted:\n" + wake), "quoted:\n" + wake, '<from host="goal"/>\nhello', '<from host="plugin:calendar"/>\nhello', '<from host="unknown"/>\nhello', '<from host="subagents"/>suffix', " " + wake, "hello"]) {
  const d = createChatData(); ingestEntry(d, entry(raw), 1);
  expect(d.blocks[0]?.kind).toBe("user");
 }
 const d = createChatData(); ingestEntry(d, entry(human(wake)), 1);
 expect(d.blocks[0]).toMatchObject({text: wake});
});

test("images and ask answers remain human; wakes do not answer asks or become memory notices", () => {
 const d = createChatData();
 const answer = "[ask " + "a".repeat(32) + "] choice #1: Yes";
 ingestEntry(d, entry(human(answer)), 1);
 expect(d.answeredAsks.has("a".repeat(32))).toBe(true);
 const user = d.blocks[0]!;
 if (user.kind !== "user") throw new Error("not user");
 expect(renderToStaticMarkup(<UserRow block={user} version={user.version} />)).toContain("질문에 답함");
 ingestEntry(d, entry([{type: "text", text: human(wake)}, {type: "image", mimeType: "image/png", data: "AA=="}], 2), 2);
 expect(d.blocks[1]).toMatchObject({kind: "user", text: wake, images: [{mimeType: "image/png", data: "AA=="}]});
 ingestEntry(d, entry(wake + "\n[ask other] choice: no", 3), 3);
 expect(d.answeredAsks.has("other")).toBe(false);
 ingestEntry(d, {id: 4, conversationId: 1, kind: "dinobot.nudge", data: {items: []}}, 4);
 expect(d.blocks[3]).toMatchObject({kind: "notice", level: "info", text: "", recall: []});
});

test("React row starts collapsed with neutral summary, linked disclosure and escaped raw payload", () => {
 const html = renderToStaticMarkup(<NudgeRow block={{kind: "nudge", id: "wake", version: 1, text: wake + "<script>bad()</script>", at: 1234567890000}} version={1} />);
 expect(html).toContain("자동 알림");
 expect(html).toContain("작업을 이어가기 위한 자동 알림이에요");
 expect(html).toContain('aria-expanded="false"');
 expect(html).toContain("aria-controls=");
 expect(html).toContain("hidden=");
 expect(html).not.toContain("<script>");
});
