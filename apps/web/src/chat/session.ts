/**
 * UI-thread side of a thread stream. The stream itself runs in the shared worker (worker.ts); this object holds the
 * visible window the worker publishes and notifies React at most once per animation frame.
 */
import { conversationEventsPath, type StreamStatus, threadEventsPath } from "../lib/api.ts";
import type { BlockView, FromWorker, SideState, ToWorker } from "./protocol.ts";

let worker: Worker | undefined;
const byKey = new Map<string, ChatSession>();
const pendingFull = new Map<number, (text: string) => void>();
let request = 0;

function getWorker(): Worker {
	if (worker) return worker;
	worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "dinobot-streams" });
	worker.onmessage = (e: MessageEvent<FromWorker>) => {
		const m = e.data;
		if (m.type === "full") {
			pendingFull.get(m.request)?.(m.text);
			pendingFull.delete(m.request);
			return;
		}
		byKey.get(m.key)?.receive(m);
	};
	send({ type: "init", base: new URL("./daemon", document.baseURI).href });
	return worker;
}
function send(message: ToWorker) {
	getWorker().postMessage(message);
}

const EMPTY_SIDE: SideState = {
	run: undefined,
	lastTurnMs: undefined,
	todos: [],
	subagents: [],
	asks: [],
	queue: [],
	workflow: null,
	dag: null,
	agent: {},
	usage: { contextTokens: 0, sent: 0, output: 0, totalTokens: 0, cost: 0 },
	ledger: { models: {}, tools: {} },
	call: {},
	snapshots: 0,
	total: 0,
	firstUserText: undefined,
	lastAgentText: undefined,
	artifacts: [],
};

export type SessionEvent = "snapshot" | "run_end" | "run_start";

export class ChatSession {
	order: string[] = [];
	readonly blocks = new Map<string, BlockView>();
	side: SideState = EMPTY_SIDE;
	status: StreamStatus = { state: "connecting", attempt: 0 };
	version = 0;
	private listeners = new Set<() => void>();
	private eventListeners = new Set<(event: SessionEvent) => void>();
	private started = false;
	private frame: number | undefined;

	private constructor(
		readonly key: string,
		private readonly path: string,
	) {}

	static forThread(key: string): ChatSession {
		return new ChatSession(key, threadEventsPath(key));
	}
	static forConversation(id: number): ChatSession {
		return new ChatSession(`conversation:${id}`, conversationEventsPath(id));
	}

	get readOnly(): boolean {
		return !this.key.startsWith("tui:");
	}

	start(): void {
		if (this.started) return;
		this.started = true;
		byKey.set(this.key, this);
		send({ type: "open", key: this.key, path: this.path });
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;
		send({ type: "close", key: this.key });
		if (byKey.get(this.key) === this) byKey.delete(this.key);
	}

	/** Show older blocks (the worker widens the window). */
	loadEarlier(): void {
		send({ type: "more", key: this.key });
	}

	notice(text: string, level: "info" | "error" = "info"): void {
		send({ type: "notice", key: this.key, text, level });
	}

	/** Whole tool output, for blocks the worker cut. */
	full(id: string): Promise<string> {
		const id_ = ++request;
		return new Promise((resolve) => {
			pendingFull.set(id_, resolve);
			send({ type: "full", key: this.key, id, request: id_ });
		});
	}

	receive(m: Extract<FromWorker, { type: "patch" }>): void {
		if (m.events?.includes("snapshot")) this.blocks.clear();
		if (m.blocks) for (const b of m.blocks) this.blocks.set(b.id, b);
		if (m.order) {
			this.order = m.order;
			if (this.blocks.size > m.order.length * 2) {
				const keep = new Set(m.order);
				for (const id of this.blocks.keys()) if (!keep.has(id)) this.blocks.delete(id);
			}
		}
		if (m.side) this.side = m.side;
		if (m.status) this.status = m.status;
		for (const event of m.events ?? []) for (const listener of this.eventListeners) listener(event);
		this.schedule();
	}

	onEvent(listener: (event: SessionEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	getVersion = (): number => this.version;

	private schedule(): void {
		if (this.frame !== undefined) return;
		const run = () => {
			this.frame = undefined;
			this.version++;
			for (const listener of this.listeners) listener();
		};
		if (document.visibilityState === "visible") this.frame = requestAnimationFrame(run);
		else this.frame = window.setTimeout(run, 100) as unknown as number;
	}
}
