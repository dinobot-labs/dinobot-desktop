/**
 * The "문제 보고" flow: check consent, ask for it the first time (modal), then send through the desktop main process,
 * which runs `dinobot report send` and works whether the daemon is up or not.
 *
 * phase: idle -> checking -> (consent -> agreeing ->)? sending -> idle. Only one flow runs at a time: a click while it
 * runs is ignored, and closing the consent modal returns to idle without sending.
 *
 * The thread open when the button is pressed (a real one, not an unsent draft) is captured then and sent with the report,
 * so in daemon mode the report carries that conversation.
 */
import { splitThreadKey } from "@dinobot/contracts";
import type { ReportConsentResult, ReportSendRequest, ReportSendResult, ReportThread, ReportTrigger } from "../../../desktop/src/bridge-types.ts";
import { create } from "zustand";
import { desktop } from "../lib/bridge.ts";

export type ReportPhase = "idle" | "checking" | "consent" | "agreeing" | "sending";

type Consent = Extract<ReportConsentResult, { ok: true }>;

export type ReportBridge = {
	reportConsent?(): Promise<ReportConsentResult>;
	reportAgree?(version: string, auto: boolean): Promise<{ ok: true } | { ok: false; error: string; versionMismatch?: boolean }>;
	reportSend?(request: ReportSendRequest): Promise<ReportSendResult>;
};

export type ReportNotice = { tone: "info" | "success" | "error" | "waiting"; title: string; body?: string; copy?: string };

/** Where the flow shows progress and results (the app binds toasts; tests record). */
export type ReportUi = {
	progress(): () => void;
	notice(notice: ReportNotice): void;
};

interface ReportState {
	phase: ReportPhase;
	trigger: ReportTrigger;
	/** The thread open when the flow started; null when none (or a draft) was open. */
	thread: ReportThread | null;
	consent: Consent | null;
	/** Shown in the consent modal (e.g. the text changed while it was open). */
	consentError: string | null;
	last: ReportSendResult | null;
}

export const useReport = create<ReportState>(() => ({ phase: "idle", trigger: "button", thread: null, consent: null, consentError: null, last: null }));

let bridge: ReportBridge | undefined = desktop;
let ui: ReportUi = { progress: () => () => {}, notice: () => {} };
let activeThread: () => ReportThread | undefined = () => undefined;

export function bindReport(next: { bridge?: ReportBridge | undefined; ui?: ReportUi; thread?: () => ReportThread | undefined }): void {
	if ("bridge" in next) bridge = next.bridge;
	if (next.ui) ui = next.ui;
	if (next.thread) activeThread = next.thread;
}

/** The report thread for the open thread key: none without one, for a draft the daemon does not know yet, or a malformed key. */
export function reportThreadFor(activeKey: string | null, threads: readonly { key: string; draft?: boolean }[]): ReportThread | undefined {
	if (!activeKey) return undefined;
	const entry = threads.find((t) => t.key === activeKey);
	if (!entry || entry.draft) return undefined;
	const parts = splitThreadKey(activeKey);
	return parts && parts.thread ? { channel: parts.channel, key: parts.thread } : undefined;
}

export const reportAvailable = () => bridge?.reportSend !== undefined;

/** The toast for a send result. */
export function reportNotice(result: ReportSendResult): ReportNotice {
	const id = result.shortId ?? result.id;
	switch (result.status) {
		case "sent":
			return { tone: "success", title: id ? `문제 보고를 보냈어요 · ${id}` : "문제 보고를 보냈어요", body: "개발자에게 이 번호를 알려 주면 바로 찾을 수 있어요.", ...(id ? { copy: id } : {}) };
		case "pending":
			return { tone: "waiting", title: id ? `문제 보고를 저장했어요 · ${id}` : "문제 보고를 저장했어요", body: ["지금은 보내지 못해서 나중에 다시 보내요.", result.error].filter(Boolean).join("\n"), ...(id ? { copy: id } : {}) };
		case "consent_required":
			return { tone: "error", title: "문제 보고 동의가 필요해요", body: "다시 눌러서 동의 내용을 확인해 주세요." };
		case "failed":
			return { tone: "error", title: "문제 보고를 보내지 못했어요", ...(result.error ? { body: result.error } : {}) };
	}
}

/** Button press: consented -> send right away; otherwise open the consent modal. */
export async function startReport(trigger: ReportTrigger = "button"): Promise<void> {
	if (useReport.getState().phase !== "idle") return;
	if (!bridge?.reportConsent || !bridge.reportSend) {
		ui.notice({ tone: "error", title: "문제 보고는 데스크톱 앱에서만 보낼 수 있어요" });
		return;
	}
	let thread: ReportThread | null = null;
	try {
		thread = activeThread() ?? null;
	} catch {}
	useReport.setState({ phase: "checking", trigger, thread, consentError: null });
	const consent = await bridge.reportConsent().catch((error: unknown): ReportConsentResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
	if (!consent.ok) {
		useReport.setState({ phase: "idle" });
		ui.notice({ tone: "error", title: "문제 보고를 준비하지 못했어요", body: consent.error });
		return;
	}
	if (!consent.consented) {
		useReport.setState({ phase: "consent", consent });
		return;
	}
	useReport.setState({ consent });
	await send(trigger, thread);
}

/** The consent modal's submit: record consent for the version shown, then send. */
export async function agreeAndSend(choice: { collect: boolean; transfer: boolean; age14: boolean; auto: boolean; note?: string }): Promise<void> {
	const state = useReport.getState();
	if (state.phase !== "consent" || state.consent === null || !bridge?.reportAgree) return;
	if (!choice.collect || !choice.transfer || !choice.age14) return;
	useReport.setState({ phase: "agreeing", consentError: null });
	const agreed = await bridge.reportAgree(state.consent.version, choice.auto).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
	if (!agreed.ok) {
		if ("versionMismatch" in agreed && agreed.versionMismatch) {
			const fresh = await bridge.reportConsent?.().catch(() => undefined);
			useReport.setState({ phase: "consent", consent: fresh?.ok ? fresh : state.consent, consentError: "동의 내용이 바뀌었어요. 새 내용을 읽고 다시 동의해 주세요." });
			return;
		}
		useReport.setState({ phase: "consent", consentError: agreed.error });
		return;
	}
	useReport.setState({ consent: { ...state.consent, consented: true, auto: choice.auto } });
	await send(state.trigger, state.thread, choice.note);
}

export function cancelConsent(): void {
	if (useReport.getState().phase === "consent") useReport.setState({ phase: "idle", consentError: null });
}

async function send(trigger: ReportTrigger, thread: ReportThread | null, note?: string): Promise<void> {
	useReport.setState({ phase: "sending" });
	const done = ui.progress();
	let result: ReportSendResult;
	try {
		result = (await bridge?.reportSend?.({ trigger, ...(note?.trim() ? { note: note.trim() } : {}), ...(thread ? { thread } : {}) })) ?? { status: "failed", error: "unavailable" };
	} catch (error) {
		result = { status: "failed", error: error instanceof Error ? error.message : String(error) };
	} finally {
		done();
	}
	if (result.status === "consent_required") {
		// Consent was withdrawn or the text changed since it was checked: ask again instead of failing.
		const fresh = await bridge?.reportConsent?.().catch(() => undefined);
		if (fresh?.ok) {
			useReport.setState({ phase: "consent", consent: { ...fresh, consented: false }, consentError: "동의 내용이 바뀌었어요. 새 내용을 읽고 다시 동의해 주세요.", last: result });
			return;
		}
	}
	useReport.setState({ phase: "idle", last: result });
	ui.notice(reportNotice(result));
}
