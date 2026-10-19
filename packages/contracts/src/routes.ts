/**
 * Paths of the client API (dinobot src/api/server.ts:76-312) and the TUI's thread naming (src/tui/app.ts:110).
 * Pure functions; no I/O.
 */

/** `/v1/threads/<channel>/<thread>` with both segments URI-encoded (tui/client.ts:180). */
export function threadPath(channel: string, thread: string): string {
	return `/v1/threads/${encodeURIComponent(channel)}/${encodeURIComponent(thread)}`;
}

export const routes = {
	healthz: () => "/healthz",
	daemon: () => "/v1/daemon",
	shutdown: () => "/v1/daemon/shutdown",
	threads: () => "/v1/threads",
	sessions: () => "/v1/sessions",
	sessionsEvents: () => "/v1/sessions/events",
	commands: () => "/v1/commands",
	commandArguments: (name: string, channel: string, thread: string) =>
		`/v1/commands/${encodeURIComponent(name)}/arguments?${new URLSearchParams({ channel, thread }).toString()}`,
	commandPrompt: (runId: string, promptId: string) => `/v1/command-runs/${encodeURIComponent(runId)}/prompts/${encodeURIComponent(promptId)}`,
	conversationEvents: (conversationId: number) => `/v1/conversations/${conversationId}/events`,
	/** DELETE: remove the thread (and its /new archives) from every listing (server.ts, DELETE /v1/threads/:channel/:thread). */
	thread: (channel: string, thread: string) => threadPath(channel, thread),
	workspace: (channel: string, thread: string) => `${threadPath(channel, thread)}/workspace`,
	messages: (channel: string, thread: string) => `${threadPath(channel, thread)}/messages`,
	events: (channel: string, thread: string) => `${threadPath(channel, thread)}/events`,
	abort: (channel: string, thread: string) => `${threadPath(channel, thread)}/abort`,
	queueSend: (channel: string, thread: string) => `${threadPath(channel, thread)}/queue/send`,
	queueWithdraw: (channel: string, thread: string, submissionId: number) => `${threadPath(channel, thread)}/queue/${submissionId}/withdraw`,
	model: (channel: string, thread: string) => `${threadPath(channel, thread)}/model`,
	runCommand: (channel: string, thread: string) => `${threadPath(channel, thread)}/commands`,
	researchReport: (channel: string, thread: string, mission: string, file = "report.md") =>
		`${threadPath(channel, thread)}/research/${encodeURIComponent(mission)}/report?${new URLSearchParams({ file }).toString()}`,
} as const;

/**
 * A fresh thread key exactly as the TUI makes it (tui/app.ts:110-113): UTC `YYYYMMDDHHMMSS-xxxx`, 4 hex random.
 * The full thread key is `tui:<name>`.
 */
export function newThreadName(now: Date = new Date(), random: () => number = Math.random): string {
	const suffix = Math.floor(random() * 0x10000).toString(16).padStart(4, "0");
	return `${now.toISOString().slice(0, 19).replace(/[-:T]/g, "")}-${suffix}`;
}

/** Split `channel:threadKey` at the first colon (channel names never contain a colon, core/channel-identity.ts:2). */
export function splitThreadKey(key: string): { channel: string; thread: string } | undefined {
	const colon = key.indexOf(":");
	if (colon <= 0) return undefined;
	return { channel: key.slice(0, colon), thread: key.slice(colon + 1) };
}

/** `<from user="U" channel="C"/>\n` header the daemon prefixes to channel input (core/input.ts:10,26). */
export const FROM_HEADER = /^<from [^>]*\/>\n/;
export function stripFromHeader(text: string): string {
	return text.replace(FROM_HEADER, "");
}
