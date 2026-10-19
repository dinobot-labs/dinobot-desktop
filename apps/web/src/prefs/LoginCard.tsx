import { Button, cn, Dialog, DialogPopup, Dino, Shimmer, type Step, Stepper } from "@dinobot/ui";
import { IconCheck, IconCopy, IconExternalLink, IconX } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { openUrl } from "../dialogs/CommandRun.tsx";
import { PromptView } from "../dialogs/PromptView.tsx";
import { useAccounts } from "../state/accounts.ts";
import { refreshAccounts } from "../state/accounts.ts";
import { runCommandUi } from "../state/app.ts";
import { answerPrompt, cancelCommand, closeRun, useRunner } from "../state/command-runner.ts";

/**
 * The login card (TUI login-card): one provider's /login run as a guided card. Browser OAuth opens the link once
 * automatically and offers Open/Copy; device codes are shown large with Copy; key and code prompts are fields in the
 * card (secrets masked); progress events form steps; the end state offers "Choose a model" / "Done".
 */
export function LoginCard() {
	const run = useRunner((s) => s.run);
	const providers = useAccounts((s) => s.providers);
	const open = Boolean(run && run.surface === "login");
	const opened = useRef(new Set<string>());
	const name = run?.args ? (providers.find((p) => p.value === run.args)?.label ?? run.args) : "공급자";

	const authUrl = run?.lines.findLast((l) => l.kind === "auth_url" || l.kind === "device_code");
	useEffect(() => {
		if (authUrl && authUrl.kind === "auth_url" && !opened.current.has(authUrl.url)) {
			opened.current.add(authUrl.url);
			openUrl(authUrl.url);
		}
	}, [authUrl]);
	useEffect(() => {
		if (run && run.surface === "login" && run.state !== "running") void refreshAccounts();
	}, [run?.state, run?.surface]);

	if (!run || run.surface !== "login") return <Dialog open={false} />;
	const stepLines = run.lines.flatMap((l) => (l.kind === "progress" || (l.kind === "output" && l.level === "info") ? [l.text] : []));
	const steps: Step[] = stepLines.map((text, i) => ({ id: String(i), label: text, state: i === stepLines.length - 1 && run.state === "running" && !run.prompt ? "running" : "done" }));
	const success = run.lines.findLast((l) => l.kind === "output" && l.level === "success");
	const errorLine = run.lines.findLast((l) => l.kind === "output" && l.level === "error");
	const failure = run.state === "error" ? (run.error ?? "로그인하지 못했어요") : errorLine?.kind === "output" ? errorLine.text : undefined;
	const code = authUrl?.kind === "device_code" ? authUrl.code : authUrl?.code;
	const textPrompt = run.prompt && run.prompt.spec.type !== "select" && run.prompt.spec.type !== "checklist" ? run.prompt : null;
	const listPrompt = run.prompt && (run.prompt.spec.type === "select" || run.prompt.spec.type === "checklist") ? run.prompt : null;
	return (
		<Dialog open={open} onOpenChange={(o) => !o && (run.state === "running" ? void cancelCommand().then(closeRun) : closeRun())}>
			<DialogPopup heading={`로그인 · ${name}`} description="TUI의 /login과 같은 과정이에요" data-testid="login-card">
				<div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
					{steps.length === 0 && run.state === "running" && !authUrl && !run.prompt ? (
						<div className="flex items-center gap-2 text-sm text-fg-3">
							<Dino state="running" size={30} shape="pixel" />
							<Shimmer>{name}에 연결하는 중…</Shimmer>
						</div>
					) : null}
					{steps.length ? <Stepper steps={steps} /> : null}
					{authUrl ? (
						<div className="flex flex-col gap-2.5 rounded-lg border border-line bg-sunken p-3.5" data-testid="login-auth">
							<div className="text-sm text-fg">{code ? "링크를 열고 아래 코드를 입력하세요." : authUrl.kind === "auth_url" ? (authUrl.instructions?.trim() || "브라우저에서 로그인을 마쳐 주세요.") : "브라우저에서 로그인을 마쳐 주세요."}</div>
							{code ? (
								<div className="flex items-center gap-2">
									<div className="selectable rounded-md border border-line-strong bg-surface px-4 py-2 font-mono text-2xl tracking-[0.2em]" data-testid="login-code">
										{code}
									</div>
									<Button size="sm" onClick={() => void navigator.clipboard.writeText(code)}>
										<IconCopy /> 코드 복사
									</Button>
								</div>
							) : null}
							<div className="selectable truncate font-mono text-xs text-fg-3">{authUrl.url}</div>
							<div className="flex gap-1.5">
								<Button size="sm" variant="primary" onClick={() => openUrl(authUrl.url)}>
									<IconExternalLink /> 브라우저에서 열기
								</Button>
								<Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(authUrl.url)}>
									<IconCopy /> 링크 복사
								</Button>
							</div>
						</div>
					) : null}
					{textPrompt ? <PromptView key={textPrompt.id} spec={textPrompt.spec} onAnswer={(v) => void answerPrompt(v)} onCancel={() => void cancelCommand()} /> : null}
					{run.state !== "running" ? (
						<div className={cn("flex items-start gap-2.5 rounded-lg border p-3", failure && run.state !== "done" ? "border-status-failed/40 bg-status-failed-tint" : "border-status-success/40 bg-status-success-tint")} data-testid="login-result">
							{failure && run.state !== "done" ? <IconX size={16} className="mt-0.5 text-status-failed-fg" /> : <IconCheck size={16} className="mt-0.5 text-status-success-fg" />}
							<div className="selectable min-w-0 flex-1 text-sm whitespace-pre-wrap text-fg">{run.state === "cancelled" ? "로그인을 멈췄어요." : failure && run.state !== "done" ? failure : success?.kind === "output" ? success.text : "로그인했어요."}</div>
						</div>
					) : null}
					<div className="flex justify-end gap-2">
						{run.state === "running" ? (
							<Button variant="ghost" size="sm" onClick={() => void cancelCommand()}>
								멈추기 Esc
							</Button>
						) : (
							<>
								{run.state === "done" ? (
									<Button
										variant="secondary"
										size="sm"
										onClick={() => {
											closeRun();
											runCommandUi("model");
										}}
									>
										모델 고르기
									</Button>
								) : null}
								<Button variant="primary" size="sm" autoFocus onClick={closeRun}>
									{run.state === "done" ? "완료" : "닫기"}
								</Button>
							</>
						)}
					</div>
				</div>
			</DialogPopup>
			{listPrompt ? <PromptView key={listPrompt.id} spec={listPrompt.spec} onAnswer={(v) => void answerPrompt(v)} onCancel={() => void cancelCommand()} /> : null}
		</Dialog>
	);
}
