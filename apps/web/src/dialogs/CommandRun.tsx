import { Button, cn, Dialog, DialogPopup, Dino, Shimmer } from "@dinobot/ui";
import { IconCheck, IconCopy, IconExternalLink } from "@tabler/icons-react";
import { desktop } from "../lib/bridge.ts";
import { answerPrompt, cancelCommand, closeRun, type RunLine, useRunner } from "../state/command-runner.ts";
import { PromptView } from "./PromptView.tsx";

export function openUrl(url: string) {
	if (desktop) void desktop.openExternal(url);
	else window.open(url, "_blank", "noopener");
}

export function RunLines({ lines }: { lines: RunLine[] }) {
	return (
		<>
			{lines.map((line, i) =>
				line.kind === "output" ? (
					<div key={i} className={cn("selectable text-sm whitespace-pre-wrap", line.level === "error" ? "text-status-failed-fg" : line.level === "success" ? "text-status-success-fg" : "font-mono text-xs text-fg-2")}>
						{line.text}
					</div>
				) : line.kind === "auth_url" || line.kind === "device_code" ? (
					<div key={i} className="flex flex-col gap-1.5">
						{"instructions" in line && line.instructions ? <div className="text-sm text-fg-2">{line.instructions}</div> : null}
						{(line.kind === "device_code" ? line.code : line.code) ? (
							<div className="flex items-center gap-2">
								<div className="selectable rounded-md border border-line bg-sunken px-3 py-1.5 font-mono text-lg tracking-widest">{line.code}</div>
								<Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(line.code ?? "")}>
									<IconCopy /> 코드 복사
								</Button>
							</div>
						) : null}
						<div className="flex gap-1.5">
							<Button size="sm" variant="primary" onClick={() => openUrl(line.url)}>
								<IconExternalLink /> 브라우저에서 열기
							</Button>
							<Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(line.url)}>
								<IconCopy /> 링크 복사
							</Button>
						</div>
					</div>
				) : (
					<div key={i} className="text-sm text-fg-2">
						{line.text}
						{line.links?.map((l) => (
							<button key={l.url} type="button" onClick={() => openUrl(l.url)} className="ml-2 cursor-pointer text-accent-deep underline">
								{l.label ?? l.url}
							</button>
						))}
					</div>
				),
			)}
		</>
	);
}

/** The command dialog: streams a daemon slash command (output, auth links, prompts) until done or error. */
export function CommandRunDialog() {
	const run = useRunner((s) => s.run);
	const open = Boolean(run && run.surface === "dialog");
	// A model choice is the whole interaction, not a prompt stacked over an output dialog.
	// Dismissing it closes the run as well, without leaving a cancelled command behind.
	if (open && run?.name === "model" && run.prompt?.spec.type === "select") {
		return <PromptView spec={run.prompt.spec} onAnswer={(v) => void answerPrompt(v)} onCancel={closeRun} />;
	}
	return (
		<Dialog open={open} onOpenChange={(o) => !o && closeRun()}>
			<DialogPopup heading={<span className="font-mono">/{run?.name}{run?.args ? ` ${run.args}` : ""}</span>} data-testid="command-run">
				{run ? (
					<div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5">
						<RunLines lines={run.lines} />
						{run.prompt && run.prompt.spec.type !== "select" && run.prompt.spec.type !== "checklist" ? <PromptView spec={run.prompt.spec} onAnswer={(v) => void answerPrompt(v)} onCancel={() => void cancelCommand()} /> : null}
						{run.state === "running" && !run.prompt ? (
							<div className="flex items-center gap-2 text-sm text-fg-3">
								<Dino state="running" size={30} shape="pixel" />
								<Shimmer>실행 중</Shimmer>
								<span className="flex-1" />
								<Button size="xs" variant="ghost" onClick={() => void cancelCommand()}>
									멈추기 Esc
								</Button>
							</div>
						) : null}
						{run.state !== "running" ? (
							<div className="flex items-center justify-between gap-2 pt-1">
								<span className={cn("flex items-center gap-1.5 text-sm", run.state === "done" ? "text-status-success-fg" : run.state === "cancelled" ? "text-fg-3" : "text-status-failed-fg")}>
									{run.state === "done" ? <IconCheck size={15} /> : null}
									{run.state === "done" ? "완료" : run.state === "cancelled" ? "멈춤" : (run.error ?? "실패")}
								</span>
								<Button variant="primary" size="sm" onClick={closeRun} autoFocus>
									닫기
								</Button>
							</div>
						) : null}
					</div>
				) : null}
			</DialogPopup>
			{/* select/checklist prompts stack above the dialog as the shared picker */}
			{open && run?.prompt && (run.prompt.spec.type === "select" || run.prompt.spec.type === "checklist") ? (
				<PromptView spec={run.prompt.spec} onAnswer={(v) => void answerPrompt(v)} onCancel={() => void cancelCommand()} />
			) : null}
		</Dialog>
	);
}
