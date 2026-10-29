import { Button, Dialog, DialogPopup, Spinner, Textarea, toast } from "@dinobot/ui";
import { IconMessageReport } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ReportTrigger } from "../../../desktop/src/bridge-types.ts";
import { agreeAndSend, bindReport, cancelConsent, reportAvailable, startReport, useReport } from "../state/report.ts";

bindReport({
	ui: {
		progress: () => toast({ tone: "waiting", title: "문제 보고를 만드는 중이에요", body: "진단 정보를 모아 보내요. 최대 2분 걸릴 수 있어요.", duration: 0 }),
		notice: (n) =>
			void toast({
				tone: n.tone,
				title: n.title,
				...(n.body ? { body: <span className="whitespace-pre-wrap break-words">{n.body}</span> } : {}),
				...(n.copy
					? {
							actions: (
								<Button size="xs" variant="secondary" data-testid="report-copy-id" onClick={() => void navigator.clipboard.writeText(n.copy ?? "")}>
									번호 복사
								</Button>
							),
						}
					: {}),
				duration: n.tone === "error" ? 0 : 15_000,
			}),
	},
});

/** The "문제 보고" button: one click sends (first time: consent modal). Hidden outside the desktop app. */
export function ReportButton({ trigger = "button", variant = "ghost", size = "sm", testId = "report-button", label = true }: { trigger?: ReportTrigger; variant?: "ghost" | "secondary" | "primary"; size?: "sm" | "lg" | "xs" | "icon-sm"; testId?: string; label?: boolean }) {
	const phase = useReport((s) => s.phase);
	if (!reportAvailable()) return null;
	const busy = phase !== "idle";
	return (
		<Button variant={variant} size={size} data-testid={testId} aria-label="문제 보고" title="문제 보고" disabled={busy} onClick={() => void startReport(trigger)}>
			{busy ? <Spinner /> : <IconMessageReport />}
			{label ? (busy ? "보내는 중…" : "문제 보고") : null}
		</Button>
	);
}

/** First-use consent: the full text from the CLI, three required checks and the optional automatic reports. */
export function ReportConsentDialog() {
	const phase = useReport((s) => s.phase);
	const consent = useReport((s) => s.consent);
	const error = useReport((s) => s.consentError);
	const open = phase === "consent" || phase === "agreeing";
	const [collect, setCollect] = useState(false);
	const [transfer, setTransfer] = useState(false);
	const [age14, setAge14] = useState(false);
	const [auto, setAuto] = useState(false);
	const [note, setNote] = useState("");
	const version = consent?.version;
	useEffect(() => {
		// A new text (version) needs fresh checks.
		setCollect(false);
		setTransfer(false);
		setAge14(false);
	}, [version]);
	useEffect(() => {
		if (open) return;
		setNote("");
	}, [open]);
	const agreeing = phase === "agreeing";
	const ready = collect && transfer && age14 && !agreeing;
	const check = (id: string, checked: boolean, set: (v: boolean) => void, text: string, required: boolean) => (
		<label className="flex items-start gap-2 text-sm text-fg">
			<input type="checkbox" data-testid={`report-consent-${id}`} checked={checked} disabled={agreeing} onChange={(e) => set(e.target.checked)} className="mt-1" />
			<span>
				{text}
				{required ? <span className="text-fg-3"> (필수)</span> : <span className="text-fg-3"> (선택)</span>}
			</span>
		</label>
	);
	return (
		<Dialog open={open} onOpenChange={(next) => !next && !agreeing && cancelConsent()}>
			<DialogPopup heading="문제 보고" description="처음 한 번만 동의하면 다음부터는 버튼 한 번으로 보내요." data-testid="report-consent" className="w-[min(92vw,640px)]">
				<div className="flex min-h-0 flex-col gap-3 px-5 pb-4">
					<pre data-testid="report-consent-text" className="selectable max-h-[38vh] min-h-24 overflow-auto rounded-md border border-line bg-sunken p-3 font-sans text-xs whitespace-pre-wrap text-fg-2">
						{consent?.text ?? ""}
					</pre>
					<div className="font-mono text-micro text-fg-3">{version}</div>
					<div className="flex flex-col gap-2">
						{check("collect", collect, setCollect, "위 내용대로 진단 정보와 대화 기록을 모으는 데 동의해요", true)}
						{check("transfer", transfer, setTransfer, "모은 정보를 dinobot 보고 서버로 보내는 데 동의해요", true)}
						{check("age14", age14, setAge14, "만 14세 이상이에요", true)}
						{check("auto", auto, setAuto, "오류가 나면 묻지 않고 자동으로 보내기", false)}
					</div>
					<Textarea data-testid="report-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="무슨 일이 있었는지 적어 주세요 (선택)" aria-label="무슨 일이 있었는지" rows={3} maxLength={4000} className="text-sm" />
					{error ? (
						<p role="alert" data-testid="report-consent-error" className="text-xs text-status-failed-fg">
							{error}
						</p>
					) : null}
					<div className="flex justify-end gap-2">
						<Button variant="ghost" data-testid="report-consent-cancel" disabled={agreeing} onClick={() => cancelConsent()}>
							취소
						</Button>
						<Button variant="primary" data-testid="report-consent-submit" disabled={!ready} onClick={() => void agreeAndSend({ collect, transfer, age14, auto, note })}>
							{agreeing ? <Spinner /> : null}
							<span>동의하고 보내기</span>
						</Button>
					</div>
				</div>
			</DialogPopup>
		</Dialog>
	);
}
