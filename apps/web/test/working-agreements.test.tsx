import { expect, test } from "bun:test";
import type { EntryRecord, ClientEvent } from "@dinobot/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { createChatData, reduceEvent } from "../src/chat/model.ts";
import { WorkingAgreements } from "../src/chat/WorkingAgreements.tsx";

const entry = (id: number, section?: string | null): EntryRecord => ({ id, conversationId: 1, kind: "pi.system", model: [{ role: "system", content: "", timestamp: 1, sections: section === undefined ? {} : { working_agreements: section } }] });
const first = "Preferences:\n- [one] Keep historical content\n  including continuation lines";

test("absent section is not zero; same-count changes and removal survive live/replay", () => {
 const entries = [entry(1), entry(2, first), entry(3, "- [one] Changed content"), entry(4, null), entry(5, first)];
 const live = createChatData();
 for (const e of entries) {
  reduceEvent(live, { type: "message_end", entry: e }, 1);
  reduceEvent(live, { type: "entry_appended", entry: e }, 2);
 }
 const sections = (data: typeof live) => data.blocks.map(b => b.kind === "notice" ? b.agreements : undefined);
 expect(sections(live)).toEqual([first, "- [one] Changed content", null, first]);
 const replay = createChatData();
 reduceEvent(replay, { type: "snapshot", entries, tools: [], compactions: [], inbox: [], agent: {}, usage: { models: {}, tools: {} } } as ClientEvent, 3);
 expect(sections(replay)).toEqual(sections(live));
 entries[1]!.model = [];
 expect(sections(structuredClone(live))[0]).toBe(first);
});

test("renders historical plain text safely, collapsed, without a live status announcement", () => {
 const html = renderToStaticMarkup(<WorkingAgreements section={first + "\n<script>unsafe</script>"} />);
 expect(html).toContain("전달된 작업 약속 1개");
 expect(html).toContain("including continuation lines");
 expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
 expect(html).not.toContain("<script>");
 expect(html).toContain('aria-expanded="false"');
 expect(html).toContain("aria-controls=");
 expect(html).toContain("hidden=");
 expect(html).not.toContain('role="status"');
});

test("empty removal and unfamiliar nonempty format have honest labels and preserved detail", () => {
 for (const section of [null, "", "  "]) expect(renderToStaticMarkup(<WorkingAgreements section={section} />)).toContain("전달된 작업 약속 없음");
 const html = renderToStaticMarkup(<WorkingAgreements section="Unrecognized but preserved" />);
 expect(html).not.toContain("전달된 작업 약속 없음");
 expect(html).toContain("Unrecognized but preserved");
});
