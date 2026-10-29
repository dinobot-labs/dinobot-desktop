import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientEvent, Usage } from "@dinobot/contracts";
import { createChatData, ingestEntry, reduceEvent } from "../src/chat/model.ts";
import { ContextUsageDetails } from "../src/chat/ContextUsage.tsx";

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage => ({ input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const update = (u: Usage): ClientEvent => ({ type: "message_update", usage: u, changes: [] });

test("provider usage never attributes images or text estimation residual to system", () => {
	const d = createChatData();
	ingestEntry(d, { id: 1, conversationId: 1, kind: "pi.user", model: [{ role: "user", content: [{type: "text", text: "short"}, {type: "image", mimeType: "image/png", data: "a".repeat(10000)}], timestamp: 1 }] }, 1);
	reduceEvent(d, update(usage(100000, 2000, 30000, 4000)), 2);
	expect(d.usage.contextTokens).toBe(136000);
	expect(d.usage.sent).toBe(134000);
	expect(d.usage.output).toBe(2000);
	const html = renderToStaticMarkup(<ContextUsageDetails usage={d.usage} />);
	expect(html).toContain("134,000");
	expect(html).toContain("2,000");
	expect(html).toContain("구분할 수 없어요");
	expect(html).not.toContain("추정");
	expect(html).not.toContain("프롬프트·도구·메모리");
});

test("equal total updates input/output split; zero-usage errors retain last measurement", () => {
	const d = createChatData();
	reduceEvent(d, update(usage(100, 20)), 1);
	reduceEvent(d, update(usage(90, 30)), 2);
	expect(d.usage.sent).toBe(90);
	expect(d.usage.output).toBe(30);
	reduceEvent(d, update(usage(0, 0)), 3);
	expect(d.usage.contextTokens).toBe(120);
	expect(d.usage.sent).toBe(90);
});

test("compaction and reset invalidate old context until a new provider measurement", () => {
	for (const kind of ["pi.compaction", "pi.reset"]) {
		const d = createChatData();
		reduceEvent(d, update(usage(100000, 2000)), 1);
		ingestEntry(d, {id: 2, conversationId: 1, kind}, 2);
		expect(d.usage.contextTokens).toBe(0);
		expect(d.usage.sent).toBe(0);
		expect(d.usage.output).toBe(0);
		reduceEvent(d, update(usage(20000, 50)), 3);
		expect(d.usage.contextTokens).toBe(20050);
	}
});

test("replacement snapshot cannot retain usage from a different transcript", () => {
	const d = createChatData();
	reduceEvent(d, update(usage(100000, 2000)), 1);
	const snapshot = {type: "snapshot", entries: [], tools: [], compactions: [], inbox: [], agent: {}, usage: {models: {}, tools: {}}} as ClientEvent;
	reduceEvent(d, snapshot, 2);
	expect(d.usage.contextTokens).toBe(0);
	expect(d.usage.sent).toBe(0);
	expect(d.usage.output).toBe(0);
});
