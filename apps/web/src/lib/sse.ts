/**
 * Server-sent events over fetch (works for GET and for the POST command streams). The daemon frames every event as
 * one `data: <json>\n\n` record and sends `: heartbeat` comments every 15 s.
 */
export interface SseOptions {
	signal: AbortSignal;
	init?: RequestInit;
	onOpen?: (response: Response) => void;
	onEvent: (data: unknown) => void;
	/** Called for every received chunk, heartbeats included (idle watchdogs). */
	onChunk?: () => void;
}

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** Parse one SSE byte stream; resolves when the server closes it, rejects on network errors (not on abort). */
export async function readSse(url: string, { signal, init, onOpen, onEvent, onChunk }: SseOptions): Promise<void> {
	const response = await fetch(url, { ...init, signal, headers: { accept: "text/event-stream", ...(init?.headers ?? {}) } });
	if (!response.ok || !response.body) {
		const text = await response.text().catch(() => "");
		let message = text || response.statusText;
		try {
			message = (JSON.parse(text) as { error?: string }).error ?? message;
		} catch {}
		throw new HttpError(response.status, message);
	}
	onOpen?.(response);
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	let data: string[] = [];
	const flush = () => {
		if (data.length === 0) return;
		const payload = data.join("\n");
		data = [];
		try {
			onEvent(JSON.parse(payload));
		} catch (error) {
			console.warn("dinobot: bad SSE frame", error);
		}
	};
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			onChunk?.();
			buffer += value;
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				let line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (line === "") flush();
				else if (line.startsWith("data:")) data.push(line.slice(line[5] === " " ? 6 : 5));
				// comments (": heartbeat") and other fields are ignored
				newline = buffer.indexOf("\n");
			}
		}
		flush();
	} catch (error) {
		if (signal.aborted) return;
		throw error;
	} finally {
		reader.releaseLock();
	}
}
