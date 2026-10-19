/**
 * dinobot daemon client (docs/protocol.md). Every path is relative to /daemon on the page's own origin: the
 * packaged app proxies dinobot-app://app/daemon/* to 127.0.0.1:<api.port> in the main process, the Vite dev server
 * proxies /daemon the same way. So requests are same-origin: no CORS, no preflight.
 */
import {
	type ClientEvent,
	type CommandArgumentsResponse,
	type CommandEvent,
	type CommandsResponse,
	type DaemonInfo,
	type DeleteThreadResult,
	type PromptAnswer,
	type RunCommandRequest,
	routes,
	type SendMessageRequest,
	type SendMessageResponse,
	type SendNowResult,
	type SessionsEvent,
	type SessionsSnapshot,
	type ShutdownResult,
	splitThreadKey,
	type ThreadModelState,
	type ThreadsResponse,
	type UsageResponse,
	type SearchResponse,
	type WithdrawResult,
	type WorkspaceResponse,
} from "@dinobot/contracts";
import { HttpError, readSse } from "./sse.ts";

let BASE = "./daemon";
/** Workers resolve relative URLs against their own script, so the UI thread hands them the absolute base. */
export function setApiBase(base: string): void {
	BASE = base.replace(/\/$/, "");
}
const url = (path: string) => `${BASE}${path}`;

async function request<T>(path: string, init?: RequestInit & { json?: unknown; timeoutMs?: number }): Promise<T> {
	const { json, timeoutMs = 20_000, ...rest } = init ?? {};
	const response = await fetch(url(path), {
		...rest,
		...(json === undefined ? {} : { method: rest.method ?? "POST", body: JSON.stringify(json), headers: { "content-type": "application/json" } }),
		signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
	});
	const text = await response.text();
	if (!response.ok) {
		let message = text || `HTTP ${response.status}`;
		try {
			message = (JSON.parse(text) as { error?: string }).error ?? message;
		} catch {}
		throw new HttpError(response.status, message);
	}
	return (text ? JSON.parse(text) : undefined) as T;
}

function thread(key: string) {
	const parts = splitThreadKey(key);
	if (!parts) throw new Error(`bad thread key: ${key}`);
	return parts;
}

export const api = {
	async healthy(): Promise<boolean> {
		try {
			const r = await fetch(url(routes.healthz()), { signal: AbortSignal.timeout(2000) });
			return r.ok;
		} catch {
			return false;
		}
	},
	daemon: () => request<DaemonInfo>(routes.daemon()),
	threads: () => request<ThreadsResponse>(routes.threads()),
	sessions: () => request<SessionsSnapshot>(routes.sessions()),
	workspace: (key: string, cwd: string) => {
		const { channel, thread: t } = thread(key);
		return request<WorkspaceResponse>(routes.workspace(channel, t), { json: { cwd }, timeoutMs: 45_000 });
	},
	send: (key: string, body: SendMessageRequest) => {
		const { channel, thread: t } = thread(key);
		return request<SendMessageResponse>(routes.messages(channel, t), { json: body, timeoutMs: 60_000 });
	},
	/** 404 `not_found` and 409 refusals are results; a daemon without the route answers a plain 404 and throws. */
	deleteThread: async (key: string): Promise<DeleteThreadResult> => {
		const { channel, thread: t } = thread(key);
		const response = await fetch(url(routes.thread(channel, t)), { method: "DELETE", signal: AbortSignal.timeout(20_000) });
		const text = await response.text();
		let body: { status?: unknown; error?: string } | undefined;
		try {
			body = text ? (JSON.parse(text) as { status?: unknown; error?: string }) : undefined;
		} catch {}
		if ((response.ok || response.status === 404 || response.status === 409) && typeof body?.status === "string") return body as DeleteThreadResult;
		throw new HttpError(response.status, body?.error ?? (text || `HTTP ${response.status}`));
	},
	abort: (key: string) => {
		const { channel, thread: t } = thread(key);
		return request<void>(routes.abort(channel, t), { method: "POST" });
	},
	queueSend: (key: string) => {
		const { channel, thread: t } = thread(key);
		return request<SendNowResult>(routes.queueSend(channel, t), { method: "POST" });
	},
	queueWithdraw: (key: string, id: number) => {
		const { channel, thread: t } = thread(key);
		return request<WithdrawResult>(routes.queueWithdraw(channel, t, id), { method: "POST" });
	},
	model: (key: string) => {
		const { channel, thread: t } = thread(key);
		return request<ThreadModelState>(routes.model(channel, t));
	},
	commands: () => request<CommandsResponse>(routes.commands()),
	commandArguments: (name: string, key: string) => {
		const { channel, thread: t } = thread(key);
		return request<CommandArgumentsResponse>(routes.commandArguments(name, channel, t));
	},
	answerPrompt: (runId: string, promptId: string, answer: PromptAnswer) => request<void>(routes.commandPrompt(runId, promptId), { json: answer }),
	shutdown: (pid: number) => request<ShutdownResult>(routes.shutdown(), { json: { pid } }),
	/** 404 on daemons that predate the usage endpoint. */
	usage: (refresh = false) => request<UsageResponse>(`/v1/usage${refresh ? "?refresh=1" : ""}`, { timeoutMs: 30_000 }),
	search: (q: string, limit = 20) => request<SearchResponse>(`/v1/search?${new URLSearchParams({ q, limit: String(limit) }).toString()}`),
	researchReport: (key: string, mission: string, file = "report.md") => {
		const { channel, thread: t } = thread(key);
		return request<{ content: string }>(routes.researchReport(channel, t, mission, file));
	},
};

/** Runs a read-only command and returns its output lines (for listings like /accounts, /plugins, /skills list). */
export async function readCommand(key: string, name: string, args?: string): Promise<{ lines: { text: string; level: string }[]; error?: string }> {
	const lines: { text: string; level: string }[] = [];
	let error: string | undefined;
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), 30_000);
	try {
		await runCommand(key, { name, ...(args ? { args } : {}), userId: "local" }, (e) => {
			if (e.type === "output") lines.push({ text: e.text, level: e.level });
			else if (e.type === "error") error = e.message;
			else if (e.type === "prompt") abort.abort(); // listings never prompt; a prompt means the command wanted input
		}, abort.signal);
	} catch (e) {
		if (!abort.signal.aborted) error = e instanceof Error ? e.message : String(e);
	} finally {
		clearTimeout(timer);
	}
	return { lines, ...(error ? { error } : {}) };
}

export type StreamStatus = { state: "connecting" | "live" | "retrying" | "failed"; error?: string; attempt: number };

/**
 * A GET event stream that never gives up until closed (dinobot tui/sse.ts semantics): transport errors, clean EOF,
 * 408/429/5xx back off 250 ms doubling to 10 s (reset after a connection lived 30 s); 45 s without a byte (heartbeats
 * are every 15 s) counts as dead. Other 4xx stop the stream with `failed`. Every reconnect starts with a snapshot.
 */
export function openStream(path: string, onEvent: (event: unknown) => void, onStatus: (status: StreamStatus) => void): () => void {
	let closed = false;
	let current: AbortController | undefined;
	let attempt = 0;
	const loop = async () => {
		let delay = 250;
		while (!closed) {
			const controller = new AbortController();
			current = controller;
			let lastByte = Date.now();
			let watchdog: ReturnType<typeof setInterval> | undefined;
			const openedAt = Date.now();
			onStatus({ state: attempt === 0 ? "connecting" : "retrying", attempt });
			try {
				watchdog = setInterval(() => {
					if (Date.now() - lastByte > 45_000) controller.abort();
				}, 5000);
				await readSse(url(path), {
					signal: controller.signal,
					onOpen: () => onStatus({ state: "live", attempt }),
					onChunk: () => {
						lastByte = Date.now();
					},
					onEvent,
				});
			} catch (error) {
				if (closed) break;
				if (error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
					onStatus({ state: "failed", error: error.message, attempt });
					return;
				}
				onStatus({ state: "retrying", error: error instanceof Error ? error.message : String(error), attempt });
			} finally {
				if (watchdog) clearInterval(watchdog);
			}
			if (closed) break;
			attempt++;
			if (Date.now() - openedAt > 30_000) delay = 250;
			await new Promise((r) => setTimeout(r, delay));
			delay = Math.min(delay * 2, 10_000);
		}
	};
	void loop();
	return () => {
		closed = true;
		current?.abort();
	};
}

export const threadEventsPath = (key: string) => {
	const { channel, thread: t } = thread(key);
	return routes.events(channel, t);
};
export const conversationEventsPath = (id: number) => routes.conversationEvents(id);
export const sessionsEventsPath = () => routes.sessionsEvents();

export type { ClientEvent, SessionsEvent };

/** A slash-command run: POST stream of CommandEvents; aborting the signal cancels the command on the daemon. */
export async function runCommand(key: string, body: RunCommandRequest, onEvent: (event: CommandEvent) => void, signal: AbortSignal): Promise<void> {
	const { channel, thread: t } = thread(key);
	await readSse(url(routes.runCommand(channel, t)), {
		signal,
		init: { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } },
		onEvent: (e) => onEvent(e as CommandEvent),
	});
}

export { HttpError };
