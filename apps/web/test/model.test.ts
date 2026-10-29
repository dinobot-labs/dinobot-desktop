import { describe, expect, test } from "bun:test";
import { syntheticReplay as fixture } from "./synthetic-replay.ts";
import type { ClientEvent, EntryRecord } from "@dinobot/contracts";
import { type ChatData, createChatData, openHumanAsks, reduceEvent } from "../src/chat/model.ts";

function replay(events: ClientEvent[], now = 1_800_000_000_000): ChatData {
	const d = createChatData();
	events.forEach((e, i) => reduceEvent(d, e, now + i));
	return d;
}

/** Structural invariants every reduced state must hold. */
function checkInvariants(d: ChatData) {
	const ids = new Set(d.blocks.map((b) => b.id));
	expect(ids.size).toBe(d.blocks.length);
	const callIds = d.blocks.flatMap((b) => (b.kind === "tool" ? [b.callId] : []));
	expect(new Set(callIds).size).toBe(callIds.length);
	for (const [callId, row] of d.toolRows) {
		const b = d.blocks[row];
		expect(b?.kind).toBe("tool");
		if (b?.kind === "tool") expect(b.callId).toBe(callId);
	}
	for (const [callId, row] of d.subagentRows) {
		const b = d.blocks[row];
		expect(b?.kind).toBe("subagent");
		if (b?.kind === "subagent") expect(b.callId).toBe(callId);
	}
	for (const row of d.live) if (row >= 0) expect(d.blocks[row]).toBeDefined();
	// Hidden tools never become tool rows.
	for (const b of d.blocks) if (b.kind === "tool") expect(["todo_write", "task", "task_output", "kill_task", "task_message"]).not.toContain(b.name);
}

describe("replaying wholly synthetic protocol events", () => {
	test("idle thread with a DAG, todos and subagents", () => {
		const events = fixture("thread-dag-todo.jsonl");
		expect(events[0]?.type).toBe("snapshot");
		const d = replay(events);
		checkInvariants(d);
		expect(d.snapshots).toBe(1);
		expect(d.run).toBeUndefined();
		expect(d.dag?.nodes.length).toBeGreaterThan(0);
		expect(d.todos.length).toBeGreaterThan(0);
		expect(d.subagents.size).toBeGreaterThan(0);
		expect(d.blocks.some((b) => b.kind === "user")).toBe(true);
		expect(d.blocks.some((b) => b.kind === "agent")).toBe(true);
		expect(d.blocks.some((b) => b.kind === "tool" && b.name === "codemode" && b.status === "done")).toBe(true);
		// No streaming leftovers in an idle thread.
		expect(d.blocks.some((b) => (b.kind === "agent" || b.kind === "thinking") && b.streaming)).toBe(false);
	});

	test("ask is tracked from open to answered", () => {
		const d = replay(fixture("thread-ask.jsonl"));
		checkInvariants(d);
		const human = [...d.asks.values()].filter((a) => a.to === "human");
		expect(human.length).toBeGreaterThan(0);
		expect(human.every((a) => a.state !== "open")).toBe(true);
		expect(openHumanAsks(d, 1_800_000_000_000)).toEqual([]);
	});

	test("live stream: busy snapshot then deltas, tool results deduped across three deliveries", () => {
		const events = fixture("thread-live-stream.jsonl");
		const d = replay(events);
		checkInvariants(d);
		expect(d.run).toBeDefined();
		// Every tool-result entry id is ingested once even though it arrives in tool_execution_end and message_end.
		const resultEntries = new Set<number>();
		for (const e of events) {
			const entry = (e.type === "tool_execution_end" || e.type === "message_end" ? e.entry : undefined) as EntryRecord | undefined;
			if (entry?.kind === "pi.tool-result") resultEntries.add(entry.id);
		}
		expect(resultEntries.size).toBeGreaterThan(0);
		const doneTools = d.blocks.filter((b) => b.kind === "tool" && b.status !== "pending" && b.status !== "running");
		expect(doneTools.length).toBeGreaterThanOrEqual(resultEntries.size);
	});

	test("a replacement snapshot resets everything (replay is idempotent)", () => {
		const events = fixture("thread-dag-todo.jsonl");
		const once = replay(events);
		const twice = replay([...events, ...events]);
		expect(twice.snapshots).toBe(2);
		expect(twice.blocks.map((b) => b.kind)).toEqual(once.blocks.map((b) => b.kind));
		expect(twice.todos).toEqual(once.todos);
		expect(twice.dag).toEqual(once.dag);
		expect(twice.usage).toEqual(once.usage);
		expect(once.usage.sent + once.usage.output).toBe(once.usage.contextTokens);
	});
});

describe("synthetic protocol cases", () => {
	const base = { type: "snapshot", entries: [], tools: [], compactions: [], inbox: [], agent: {}, usage: { models: {}, tools: {} } } as unknown as ClientEvent;
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

	test("run_start/run_end bracket busy and end with a turn notice", () => {
		const d = createChatData();
		reduceEvent(d, base, 0);
		reduceEvent(d, { type: "run_start", inputs: [1] }, 10);
		expect(d.run?.phase).toBe("waiting_response");
		reduceEvent(d, { type: "message_start", message: { role: "assistant", content: [], api: "x", provider: "p", model: "m", usage, stopReason: "pending", timestamp: 11 } } as unknown as ClientEvent, 11);
		reduceEvent(d, { type: "message_update", usage, changes: [{ type: "text_start", contentIndex: 0, block: { type: "text", text: "" } }, { type: "text_delta", contentIndex: 0, delta: "안녕" }] } as unknown as ClientEvent, 12);
		expect(d.run?.phase).toBe("responding");
		const agent = d.blocks.find((b) => b.kind === "agent");
		expect(agent?.kind === "agent" && agent.streaming && agent.text).toBe("안녕");
		reduceEvent(d, { type: "run_end", inputs: [1] }, 20);
		expect(d.run).toBeUndefined();
		const last = d.blocks.at(-1);
		expect(last?.kind === "notice" && last.level).toBe("turn");
		expect(d.blocks.some((b) => b.kind === "agent" && b.streaming)).toBe(false);
	});

	test("tool output window: set, trimStart + append", () => {
		const d = createChatData();
		reduceEvent(d, base, 0);
		reduceEvent(d, { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } }, 1);
		reduceEvent(d, { type: "tool_execution_update", toolCallId: "c1", toolName: "bash", output: { set: "abcdef" } }, 2);
		reduceEvent(d, { type: "tool_execution_update", toolCallId: "c1", toolName: "bash", output: { trimStart: 2, append: "XY" } }, 3);
		const tool = d.blocks.find((b) => b.kind === "tool");
		expect(tool?.kind === "tool" && tool.output).toBe("cdefXY");
		expect(tool?.kind === "tool" && tool.status).toBe("running");
		reduceEvent(d, { type: "tool_execution_end", toolCallId: "c1", toolName: "bash" }, 4);
		expect(tool?.kind === "tool" && tool.status).toBe("error");
	});

	test("hidden todo_write updates todos without a tool row; queue_status replaces the queue", () => {
		const d = createChatData();
		reduceEvent(d, base, 0);
		const todos = [{ id: "1", content: "a", status: "in_progress" }];
		reduceEvent(d, { type: "tool_execution_start", toolCallId: "t", toolName: "todo_write", args: {} }, 1);
		reduceEvent(d, { type: "tool_execution_end", toolCallId: "t", toolName: "todo_write", entry: { id: 5, conversationId: 1, kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: "t", toolName: "todo_write", content: [{ type: "text", text: "ok" }], details: { todos }, isError: false, timestamp: 1 }] } } as unknown as ClientEvent, 2);
		expect(d.todos).toEqual(todos as never);
		expect(d.blocks.some((b) => b.kind === "tool")).toBe(false);
		reduceEvent(d, { type: "queue_status", items: [{ id: 3, mode: "steer", text: "hi" }] }, 3);
		expect(d.queue.length).toBe(1);
	});

	test("an open human ask is listed until its deadline or answer", () => {
		const d = createChatData();
		reduceEvent(d, base, 0);
		const ask = { id: "a".repeat(32), from: { conversationId: 1 }, to: "human", kind: "decision", refs: [], question: "Q?", options: ["A", "B"], default: "A", createdAt: 0, deadlineAt: 1000, state: "open" };
		reduceEvent(d, { type: "tool_execution_update", toolCallId: "cm", toolName: "codemode", details: { ask } }, 1);
		expect(openHumanAsks(d, 500).map((a) => a.id)).toEqual([ask.id]);
		expect(openHumanAsks(d, 1500)).toEqual([]);
		reduceEvent(d, { type: "tool_execution_update", toolCallId: "cm", toolName: "codemode", details: { ask: { ...ask, state: "answered", answer: "B" } } }, 2);
		expect(openHumanAsks(d, 500)).toEqual([]);
	});

	test("a human reply in the transcript hides the ask before the agent resolves it", () => {
		const d = createChatData();
		reduceEvent(d, base, 0);
		const ask = { id: "b".repeat(32), from: { conversationId: 1 }, to: "human", kind: "decision", refs: [], question: "Q?", options: ["A", "B"], default: "A", createdAt: 0, deadlineAt: 1000, state: "open" };
		reduceEvent(d, { type: "tool_execution_update", toolCallId: "cm", toolName: "codemode", details: { ask } }, 1);
		expect(openHumanAsks(d, 500).map((a) => a.id)).toEqual([ask.id]);
		const reply = (id: number, text: string) =>
			({ type: "entry_appended", entry: { id, kind: "pi.user", model: [{ role: "user", content: text, timestamp: 2 }] } }) as unknown as ClientEvent;
		reduceEvent(d, reply(900, "[ask " + "c".repeat(32) + "] choice: A"), 2);
		expect(openHumanAsks(d, 500).map((a) => a.id)).toEqual([ask.id]);
		reduceEvent(d, reply(901, "[ask " + ask.id + "] choice: B"), 3);
		expect(openHumanAsks(d, 500)).toEqual([]);
		// A later replay of the still-open record (the agent has not called answer yet) keeps it hidden.
		reduceEvent(d, { type: "tool_execution_update", toolCallId: "cm", toolName: "codemode", details: { ask } }, 4);
		expect(openHumanAsks(d, 500)).toEqual([]);
	});
});
