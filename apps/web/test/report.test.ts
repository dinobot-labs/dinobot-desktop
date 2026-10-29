import { beforeEach, describe, expect, test } from "bun:test";
import type { ReportConsentResult, ReportSendResult } from "../../desktop/src/bridge-types.ts";
import type { ReportThread } from "../../desktop/src/bridge-types.ts";
import { agreeAndSend, bindReport, cancelConsent, type ReportNotice, reportNotice, reportThreadFor, startReport, useReport } from "../src/state/report.ts";

type Calls = { consent: number; agree: [string, boolean][]; send: { trigger: string; note?: string; thread?: ReportThread }[]; progress: number; done: number; notices: ReportNotice[] };

let calls: Calls;
let consent: ReportConsentResult;
let agreeAnswer: { ok: true } | { ok: false; error: string; versionMismatch?: boolean };
let sendAnswers: ReportSendResult[];
let open: ReportThread | undefined;

const v2 = (consented: boolean): ReportConsentResult => ({ ok: true, version: "report-consent-ko-v2", text: "전문", consented, auto: false });

beforeEach(() => {
	calls = { consent: 0, agree: [], send: [], progress: 0, done: 0, notices: [] };
	consent = v2(false);
	agreeAnswer = { ok: true };
	sendAnswers = [{ status: "sent", id: "0123456789", shortId: "01234567" }];
	open = undefined;
	useReport.setState({ phase: "idle", trigger: "button", thread: null, consent: null, consentError: null, last: null });
	bindReport({
		thread: () => open,
		bridge: {
			reportConsent: async () => (calls.consent++, consent),
			reportAgree: async (version, auto) => (calls.agree.push([version, auto]), agreeAnswer),
			reportSend: async (request) => (calls.send.push(request), sendAnswers.shift() ?? { status: "failed", error: "none" }),
		},
		ui: {
			progress: () => {
				calls.progress++;
				return () => void calls.done++;
			},
			notice: (n) => void calls.notices.push(n),
		},
	});
});

const all = { collect: true, transfer: true, age14: true, auto: false };

describe("report flow", () => {
	test("consented: one click sends with progress and a success notice carrying the short id", async () => {
		consent = v2(true);
		await startReport("button");
		expect(calls.send).toEqual([{ trigger: "button" }]);
		expect(calls.progress).toBe(1);
		expect(calls.done).toBe(1);
		expect(calls.notices[0]).toMatchObject({ tone: "success", copy: "01234567" });
		expect(calls.notices[0]!.title).toContain("01234567");
		expect(useReport.getState().phase).toBe("idle");
	});
	test("first use opens the consent modal; sending needs all three required checks", async () => {
		await startReport("daemon-down");
		expect(useReport.getState().phase).toBe("consent");
		expect(calls.send).toHaveLength(0);
		await agreeAndSend({ ...all, age14: false });
		expect(calls.agree).toHaveLength(0);
		await agreeAndSend({ ...all, auto: true, note: " 끊겼어요 " });
		expect(calls.agree).toEqual([["report-consent-ko-v2", true]]);
		expect(calls.send).toEqual([{ trigger: "daemon-down", note: "끊겼어요" }]);
		expect(useReport.getState().phase).toBe("idle");
	});
	test("cancel closes the modal without sending", async () => {
		await startReport();
		cancelConsent();
		expect(useReport.getState().phase).toBe("idle");
		expect(calls.send).toHaveLength(0);
		expect(calls.agree).toHaveLength(0);
	});
	test("the text changed while the modal was open: stays open with the new text and a message", async () => {
		await startReport();
		agreeAnswer = { ok: false, error: "version", versionMismatch: true };
		consent = { ok: true, version: "report-consent-ko-v3", text: "새 전문", consented: false, auto: false };
		await agreeAndSend(all);
		const s = useReport.getState();
		expect(s.phase).toBe("consent");
		expect(s.consent?.version).toBe("report-consent-ko-v3");
		expect(s.consentError).toBeTruthy();
		expect(calls.send).toHaveLength(0);
	});
	test("consent_required from send reopens the modal instead of failing", async () => {
		consent = v2(true);
		sendAnswers = [{ status: "consent_required" }];
		await startReport();
		expect(useReport.getState().phase).toBe("consent");
		expect(calls.notices).toHaveLength(0);
	});
	test("a CLI that cannot answer consent shows an error and stays idle", async () => {
		consent = { ok: false, error: "the dinobot command was not found" };
		await startReport();
		expect(useReport.getState().phase).toBe("idle");
		expect(calls.notices[0]).toMatchObject({ tone: "error", body: "the dinobot command was not found" });
	});
	test("a click while a report runs is ignored", async () => {
		consent = v2(true);
		const first = startReport();
		const second = startReport();
		await Promise.all([first, second]);
		expect(calls.consent).toBe(1);
		expect(calls.send).toHaveLength(1);
	});
	test("the thread open at the click is sent, also after the consent modal", async () => {
		consent = v2(true);
		open = { channel: "tui", key: "20261015141712-c6fa" };
		await startReport();
		expect(calls.send).toEqual([{ trigger: "button", thread: { channel: "tui", key: "20261015141712-c6fa" } }]);
		consent = v2(false);
		await startReport();
		open = { channel: "tui", key: "other" };
		await agreeAndSend({ ...all, note: "n" });
		expect(calls.send[1]).toEqual({ trigger: "button", note: "n", thread: { channel: "tui", key: "20261015141712-c6fa" } });
	});
	test("no open thread: sent without one", async () => {
		consent = v2(true);
		await startReport();
		expect(calls.send).toEqual([{ trigger: "button" }]);
	});
	test("no desktop bridge: an error notice", async () => {
		bindReport({ bridge: undefined });
		await startReport();
		expect(calls.notices[0]?.tone).toBe("error");
	});
});

describe("result notice", () => {
	test("pending and failed", () => {
		expect(reportNotice({ status: "pending", shortId: "abcd1234", error: "offline" })).toMatchObject({ tone: "waiting", copy: "abcd1234" });
		expect(reportNotice({ status: "pending", shortId: "abcd1234", error: "offline" }).body).toContain("offline");
		expect(reportNotice({ status: "failed", error: "HTTP 500" })).toMatchObject({ tone: "error", body: "HTTP 500" });
		expect(reportNotice({ status: "sent" }).copy).toBeUndefined();
	});
});

describe("active thread", () => {
	const threads = [{ key: "tui:20261015141712-c6fa" }, { key: "tui:20261016000000-aaaa", draft: true }, { key: "slack:C123-1700000000.0001" }];
	test("a real open thread maps to channel + key", () => {
		expect(reportThreadFor("tui:20261015141712-c6fa", threads)).toEqual({ channel: "tui", key: "20261015141712-c6fa" });
		expect(reportThreadFor("slack:C123-1700000000.0001", threads)).toEqual({ channel: "slack", key: "C123-1700000000.0001" });
	});
	test("none, a draft, an unknown or malformed key: no thread", () => {
		expect(reportThreadFor(null, threads)).toBeUndefined();
		expect(reportThreadFor("tui:20261016000000-aaaa", threads)).toBeUndefined();
		expect(reportThreadFor("tui:gone", threads)).toBeUndefined();
		expect(reportThreadFor("nocolon", [{ key: "nocolon" }])).toBeUndefined();
		expect(reportThreadFor("tui:", [{ key: "tui:" }])).toBeUndefined();
	});
});
