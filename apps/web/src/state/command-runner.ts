/**
 * Daemon slash-command runs (docs/protocol.md §2.5, TUI rows T52-T57). One run at a time across the app: the stream
 * is the run, closing it aborts the command on the daemon. Prompts are surfaced to whichever surface started the run
 * (command dialog, login card, setup wizard); select/checklist prompts render through the shared Picker.
 */
import type { CommandEvent, CommandPromptSpec, ManifestApplyRequest } from "@dinobot/contracts";
import { toast } from "@dinobot/ui";
import { create } from "zustand";
import { api, runCommand } from "../lib/api.ts";
import { desktop } from "../lib/bridge.ts";
import { useSettings } from "../lib/settings.ts";

export type RunSurface = "dialog" | "login" | "quiet" | "slack";
export type RunLine =
	| { kind: "output"; text: string; level: "info" | "success" | "error" }
	| { kind: "auth_url"; url: string; instructions?: string; code?: string }
	| { kind: "device_code"; code: string; url: string }
	| { kind: "progress"; text: string; links?: { url: string; label?: string }[] };

export interface CommandRun {
	id: number;
	key: string;
	name: string;
	args: string | undefined;
	surface: RunSurface;
	runId: string | undefined;
	lines: RunLine[];
	prompt: { id: string; spec: CommandPromptSpec } | null;
	state: "running" | "done" | "error" | "cancelled";
	error: string | undefined;
	apply: ManifestApplyRequest | undefined;
	/** Model/reasoning/fast changed during the run. */
	stateChanged: boolean;
}

interface RunnerState {
	run: CommandRun | null;
}

export const useRunner = create<RunnerState>(() => ({ run: null }));
let controller: AbortController | null = null;
let seq = 0;

const update = (id: number, patch: (run: CommandRun) => Partial<CommandRun>) =>
	useRunner.setState((s) => (s.run && s.run.id === id ? { run: { ...s.run, ...patch(s.run) } } : s));

/** "Enter code: ABCD-1234" inside auth_url instructions (dinobot never sends device_code events). */
export function codeIn(instructions: string | undefined): string | undefined {
	return /(?:code|코드)[:：]\s*([A-Z0-9][A-Z0-9-]{3,})/i.exec(instructions ?? "")?.[1];
}

export interface StartOptions {
	surface?: RunSurface;
	onDone?: (run: CommandRun) => void;
}

const QUIET_ON_SUCCESS = new Set(["model", "reasoning", "fast"]);

export function startCommand(key: string, name: string, args?: string, options: StartOptions = {}): boolean {
	const current = useRunner.getState().run;
	if (current && current.state === "running") {
		toast({ tone: "error", title: `/${current.name}이(가) 아직 실행 중이에요`, body: "Esc로 멈춘 뒤 다시 실행하세요." });
		return false;
	}
	const id = ++seq;
	const run: CommandRun = { id, key, name, args, surface: options.surface ?? "dialog", runId: undefined, lines: [], prompt: null, state: "running", error: undefined, apply: undefined, stateChanged: false };
	useRunner.setState({ run });
	controller = new AbortController();
	const abort = controller;
	let dismissed: CommandRun | undefined;
	const push = (line: RunLine) => update(id, (r) => ({ lines: [...r.lines, line] }));
	const onEvent = (e: CommandEvent) => {
		// Cancellation is terminal even while the prompt-reply HTTP request is settling.
		const current = useRunner.getState().run;
		if (current?.id !== id || current.state === "cancelled") return;
		switch (e.type) {
			case "started":
				update(id, () => ({ runId: e.runId }));
				return;
			case "output":
				if (run.surface === "quiet" && e.level === "success") return;
				push({ kind: "output", text: e.text, level: e.level });
				return;
			case "auth": {
				const a = e.event as { type: string; message?: string; url?: string; instructions?: string; userCode?: string; verificationUri?: string; links?: { url: string; label?: string }[] };
				if (a.type === "auth_url" && a.url) {
					const code = codeIn(a.instructions);
					push({ kind: "auth_url", url: a.url, ...(a.instructions ? { instructions: a.instructions } : {}), ...(code ? { code } : {}) });
				} else if (a.type === "device_code" && a.userCode) push({ kind: "device_code", code: a.userCode, url: a.verificationUri ?? "" });
				else if (a.message) push({ kind: "progress", text: a.message, ...(a.links ? { links: a.links } : {}) });
				return;
			}
			case "prompt":
				update(id, () => ({ prompt: { id: e.id, spec: e.prompt } }));
				return;
			case "state":
				update(id, () => ({ stateChanged: true }));
				return;
			case "apply":
				update(id, () => ({ apply: e.request }));
				return;
			case "done": {
				update(id, () => ({ state: "done", prompt: null }));
				// Picking a model/reasoning/fast setting is the whole interaction: the title bar already shows the result,
				// so a clean finish closes the dialog instead of leaving a "완료" card to dismiss.
				const done = useRunner.getState().run;
				if (done?.id === id && done.surface === "dialog" && QUIET_ON_SUCCESS.has(name) && !done.lines.some((l) => l.kind === "output" && l.level === "error")) {
					dismissed = done;
					useRunner.setState({ run: null });
				}
				return;
			}
			case "error":
				update(id, () => ({ state: "error", prompt: null, error: e.message }));
				if (run.surface === "quiet") toast({ tone: "error", title: e.message });
				return;
		}
	};
	const locale = useSettings.getState().locale || desktop?.locale || navigator.language || "ko";
	runCommand(key, { name, ...(args ? { args } : {}), userId: useSettings.getState().userName || "local", locale }, onEvent, abort.signal)
		.then(() => update(id, (r) => (r.state === "running" ? { state: "error", error: `데몬이 /${name}을(를) 끝내기 전에 연결을 닫았어요` } : {})))
		.catch((error: unknown) => {
			if (abort.signal.aborted) return;
			const message = error instanceof Error ? error.message : String(error);
			update(id, () => ({ state: "error", error: /404|unknown command/i.test(message) ? `unknown command /${name}` : message }));
		})
		.finally(() => {
			const final = useRunner.getState().run;
			if (final?.id === id) options.onDone?.(final);
			else if (!final && dismissed) options.onDone?.(dismissed);
		});
	return true;
}

export async function answerPrompt(value: string): Promise<void> {
	const run = useRunner.getState().run;
	if (!run?.prompt || !run.runId) return;
	const promptId = run.prompt.id;
	update(run.id, () => ({ prompt: null }));
	try {
		await api.answerPrompt(run.runId, promptId, { value });
	} catch (error) {
		// 404: the prompt was withdrawn (e.g. the browser callback won the race); the run continues.
		const message = error instanceof Error ? error.message : String(error);
		if (!/no such pending prompt/.test(message)) update(run.id, (r) => ({ lines: [...r.lines, { kind: "output", text: message, level: "error" }] }));
	}
}

/** Esc / Stop: cancel the pending prompt, then close the stream (aborts the command on the daemon). */
export async function cancelCommand(): Promise<void> {
	const run = useRunner.getState().run;
	if (!run || run.state !== "running") return;
	// A new run can start while the cancellation request is pending. Abort only this run.
	const abort = controller;
	// Settle locally first so a second Esc (dialog close + field Esc) cannot cancel the same prompt twice.
	update(run.id, () => ({ state: "cancelled", prompt: null }));
	if (run.prompt && run.runId) await api.answerPrompt(run.runId, run.prompt.id, { cancel: true }).catch(() => {});
	abort?.abort();
	if (run.surface !== "quiet" && (run.lines.length > 0 || run.prompt === null)) toast({ title: `/${run.name}을(를) 멈췄어요` });
}

export function closeRun(): void {
	const run = useRunner.getState().run;
	if (run?.state === "running") void cancelCommand();
	useRunner.setState({ run: null });
}
