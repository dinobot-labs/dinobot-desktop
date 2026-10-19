/// <reference lib="webworker" />
/**
 * Stream worker: one per app. Opens thread / conversation event streams, parses frames, runs the reducer and posts a
 * coalesced patch per frame to the UI thread. See protocol.ts.
 */
import type { ClientEvent } from "@dinobot/contracts";
import { openStream, setApiBase, type StreamStatus } from "../lib/api.ts";
import { type Block, type ChatData, createChatData, localNotice, reduceEvent } from "./model.ts";
import { artifactCandidates } from "./artifacts.ts";
import { type BlockView, CUT_AT, type FromWorker, type SideState, type ToWorker, WINDOW_STEP } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;
const post = (message: FromWorker) => self.postMessage(message);
const FRAME_MS = 16;

function view(block: Block): BlockView {
	if (block.kind !== "tool") return block;
	const out: BlockView = { ...block };
	// Only the codemode receipts are rendered; the rest of the details can be large and is not needed by the UI.
	const calls = (block.details as { codemodeCalls?: unknown } | undefined)?.codemodeCalls;
	if (block.details !== undefined) out.details = Array.isArray(calls) ? { codemodeCalls: calls } : undefined;
	if (block.output.length > CUT_AT) {
		out.output = block.output.slice(-CUT_AT);
		out.cut = { field: "output", length: block.output.length };
	}
	if (block.result && block.result.length > CUT_AT) {
		out.result = block.result.slice(0, CUT_AT);
		out.cut = { field: "result", length: block.result.length };
	}
	return out;
}

class Session {
	readonly data: ChatData = createChatData();
	window = WINDOW_STEP;
	private sent = new Map<string, number>();
	private lastOrder: string[] = [];
	private lastSide = "";
	private status: StreamStatus | undefined;
	private events = new Set<"snapshot" | "run_end" | "run_start">();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private close: (() => void) | undefined;

	constructor(
		readonly key: string,
		path: string,
	) {
		this.close = openStream(
			path,
			(event) => this.apply(event as ClientEvent),
			(status) => {
				this.status = status;
				this.schedule(0);
			},
		);
	}

	apply(event: ClientEvent): void {
		const before = this.data.revision;
		reduceEvent(this.data, event, Date.now());
		if (event.type === "snapshot") {
			this.sent.clear();
			this.lastOrder = [];
			this.events.add("snapshot");
			this.schedule(0);
			return;
		}
		if (event.type === "run_end" || event.type === "run_start") this.events.add(event.type);
		if (this.data.revision !== before) this.schedule(FRAME_MS);
	}

	notice(text: string, level: "info" | "error"): void {
		localNotice(this.data, text, level);
		this.schedule(0);
	}

	more(): void {
		this.window += WINDOW_STEP;
		this.schedule(0);
	}

	full(id: string): string {
		const block = this.data.blocks.find((b) => b.id === id);
		if (block?.kind !== "tool") return "";
		return block.status === "running" ? block.output : (block.result ?? block.output);
	}

	stop(): void {
		this.close?.();
		this.close = undefined;
		if (this.timer) clearTimeout(this.timer);
	}

	private schedule(delay: number): void {
		if (this.timer !== undefined) {
			if (delay > 0) return;
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.flush();
		}, delay);
	}

	private flush(): void {
		const d = this.data;
		const start = Math.max(0, d.blocks.length - this.window);
		const slice = d.blocks.slice(start);
		const order = slice.map((b) => b.id);
		const orderChanged = order.length !== this.lastOrder.length || order.some((id, i) => id !== this.lastOrder[i]);
		const blocks: BlockView[] = [];
		for (const b of slice) {
			if (this.sent.get(b.id) !== b.version) {
				blocks.push(view(b));
				this.sent.set(b.id, b.version);
			}
		}
		if (orderChanged) {
			const keep = new Set(order);
			for (const id of this.sent.keys()) if (!keep.has(id)) this.sent.delete(id);
			this.lastOrder = order;
		}
		const firstUser = d.blocks.find((b) => b.kind === "user");
		const lastAgent = d.blocks.findLast((b) => b.kind === "agent");
		const side: SideState = {
			run: d.run,
			lastTurnMs: d.lastTurnMs,
			todos: d.todos,
			subagents: [...d.subagents.values()],
			asks: [...d.asks.values()],
			queue: d.queue,
			workflow: d.workflow,
			dag: d.dag,
			agent: d.agent,
			usage: d.usage,
			ledger: d.ledger,
			call: d.call,
			snapshots: d.snapshots,
			total: d.blocks.length,
			firstUserText: firstUser?.kind === "user" ? firstUser.text.slice(0, 200) : undefined,
			lastAgentText: lastAgent?.kind === "agent" ? lastAgent.text.slice(-400) : undefined,
			artifacts: artifactCandidates(d.artifacts, d.agent.cwd),
		};
		const sideJson = JSON.stringify(side);
		const sideChanged = sideJson !== this.lastSide;
		this.lastSide = sideJson;
		const status = this.status;
		this.status = undefined;
		const events = [...this.events];
		this.events.clear();
		if (!orderChanged && !blocks.length && !sideChanged && !status && !events.length) return;
		post({
			type: "patch",
			key: this.key,
			...(orderChanged ? { order } : {}),
			...(blocks.length ? { blocks } : {}),
			...(sideChanged ? { side } : {}),
			...(status ? { status } : {}),
			...(events.length ? { events } : {}),
		});
	}
}

const sessions = new Map<string, Session>();

self.onmessage = (e: MessageEvent<ToWorker>) => {
	const m = e.data;
	switch (m.type) {
		case "init":
			setApiBase(m.base);
			return;
		case "open":
			if (!sessions.has(m.key)) sessions.set(m.key, new Session(m.key, m.path));
			return;
		case "close":
			sessions.get(m.key)?.stop();
			sessions.delete(m.key);
			return;
		case "more":
			sessions.get(m.key)?.more();
			return;
		case "notice":
			sessions.get(m.key)?.notice(m.text, m.level);
			return;
		case "full":
			post({ type: "full", key: m.key, request: m.request, text: sessions.get(m.key)?.full(m.id) ?? "" });
			return;
	}
};
