import type { AskView, QueuedInput } from "@dinobot/contracts";
import { useEffect, useMemo, useState } from "react";
import { api, HttpError } from "../lib/api.ts";
import { useNow, useSession } from "../lib/hooks.ts";
import { useSettings } from "../lib/settings.ts";
import { refreshModel, sessionFor, setTitle, useApp } from "../state/app.ts";
import { runLocalOrDaemon } from "../state/local-commands.ts";
import { AskBar } from "./AskBar.tsx";
import type { StagedAttachment } from "../lib/bridge.ts";
import { withAttachments } from "./attachments.ts";
import { type Attachment, Composer } from "./Composer.tsx";
import { QueueBar } from "./QueueBar.tsx";
import { StatusLine } from "./StatusLine.tsx";
import { Transcript } from "./Transcript.tsx";
import { Hints, Notices, SubagentDock, TodoCaption } from "./WorkDeck.tsx";
import { useUi } from "../state/ui.ts";
import { toast, Button } from "@dinobot/ui";
import { runCommandUi } from "../state/app.ts";

const errorText = (error: unknown) => (error instanceof HttpError || error instanceof Error ? error.message : String(error));

export function ChatView({ threadKey }: { threadKey: string }) {
	const session = useMemo(() => sessionFor(threadKey), [threadKey]);
	useSession(session);
	const d = session.side;
	const userName = useSettings((s) => s.userName);
	const now = useNow(d.asks.length > 0, 5000);
	const asks = d.asks.filter((a) => a.to === "human" && a.state === "open" && a.deadlineAt > now).sort((a, b) => a.deadlineAt - b.deadlineAt);
	const readOnly = session.readOnly;
	const [hasText, setHasText] = useState(false);
	const askOpen = useUi((s) => s.askOpen);
	useEffect(() => {
		if (!askOpen) return;
		useUi.setState({ askOpen: false });
		const bar = document.querySelector('[data-testid="ask-bar"] button');
		if (bar instanceof HTMLElement) {
			bar.scrollIntoView({ block: "center" });
			bar.focus();
		} else toast({ title: "열린 질문이 없어요" });
	}, [askOpen]);
	const busy = Boolean(d.run);

	useEffect(() => {
		session.start();
	}, [session]);

	const send = async (text: string, images: Attachment[], files: StagedAttachment[] = []): Promise<boolean> => {
		try {
			const first = d.firstUserText === undefined;
			// The title comes from what the person typed, not from the attachment note.
			const title = text || files[0]?.name;
			if (first && title) setTitle(threadKey, title);
			const response = await api.send(threadKey, {
				text: withAttachments(text, files),
				userId: userName || "local",
				messageId: crypto.randomUUID(),
				...(busy ? { whenBusy: "steer" as const } : {}),
				...(images.length ? { images: images.map(({ mimeType, data }) => ({ mimeType, data })) } : {}),
			});
			if (response.autoReport) {
				const id8 = response.autoReport.id.slice(0, 8);
				toast({
					tone: "waiting",
					title: `자동 보고 ${id8} 예약됨 (불만 표현 감지)`,
					body: "약 30초 뒤에 보내요.",
					duration: 30_000,
					actions: (
						<>
							<Button size="xs" onClick={() => runCommandUi("report", `undo ${id8}`)}>
								취소
							</Button>
							<Button size="xs" variant="ghost" onClick={() => runCommandUi("report", "auto off")}>
								자동 보고 끄기
							</Button>
						</>
					),
				});
			}
			return true;
		} catch (error) {
			session.notice(`보내지 못했어요: ${errorText(error)}`, "error");
			return false;
		}
	};

	const stop = () => {
		void api.abort(threadKey).catch((error) => session.notice(`멈추지 못했어요: ${errorText(error)}`, "error"));
	};

	const choose = async (ask: AskView, index: number) => {
		try {
			await api.send(threadKey, {
				text: `[ask ${ask.id}] choice #${index + 1}`,
				choice: { askId: ask.id, option: index },
				userId: userName || "local",
				messageId: crypto.randomUUID(),
				...(busy ? { whenBusy: "steer" as const } : {}),
			});
		} catch (error) {
			session.notice(errorText(error), "error");
		}
	};
	const answer = async (ask: AskView, text: string) => {
		await send(`[ask ${ask.id}] answer: ${text}`, []);
	};

	const sendQueueNow = () => {
		void api.queueSend(threadKey).catch((error) => session.notice(`대기 메시지를 보내지 못했어요: ${errorText(error)}`, "error"));
	};
	const withdraw = async (item: QueuedInput): Promise<string | null> => {
		try {
			const result = await api.queueWithdraw(threadKey, item.id);
			if (result.status === "withdrawn") return result.item.text;
			session.notice(result.status === "already_placed" ? "이미 전달된 메시지예요" : "이미 처리된 메시지예요", "info");
		} catch (error) {
			session.notice(errorText(error), "error");
		}
		return null;
	};

	const model = useApp((st) => st.models[threadKey]);
	const applying = useApp((st) => st.applying);
	const onCommand = (name: string, args: string, quiet = false) => runLocalOrDaemon(name, args, quiet);

	useEffect(() => {
		// The model line changes when a run ends (e.g. /model ran inside the thread).
		if (!busy) void refreshModel(threadKey);
	}, [busy, threadKey]);

	const status = session.status;
	const connectionNote = status.state === "retrying" ? "다시 연결하는 중…" : status.state === "failed" ? `스트림 오류: ${status.error}` : undefined;
	const cwd = d.agent.cwd;
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="chat-view" data-thread={threadKey}>
			<Transcript session={session} />
			<div className="shrink-0 px-6 pt-3 pb-4">
				<div className="mx-auto flex max-w-3xl flex-col gap-2">
					{connectionNote ? <div className="rounded-md bg-status-running-tint px-3 py-1.5 text-xs text-status-running-fg">{connectionNote}</div> : null}
					<Notices />
					<StatusLine run={d.run} side={d} onStop={stop} readOnly={readOnly} />
					{!readOnly ? <SubagentDock side={d} /> : null}
					{!readOnly ? <AskBar asks={asks} onChoose={choose} onAnswer={answer} /> : null}
					{!readOnly ? <QueueBar queue={d.queue} onSendNow={sendQueueNow} onWithdraw={(item) => void withdraw(item)} /> : null}
					<TodoCaption todos={d.todos} />
					<Composer
						busy={busy}
						disabled={readOnly ? "다른 채널의 스레드는 여기서 읽기만 할 수 있어요" : applying ? "설정을 적용하고 dinobot을 다시 시작하는 중…" : undefined}
						threadKey={threadKey}
						cwd={cwd}
						model={model}
						usage={d.usage}
						hasQueue={d.queue.length > 0}
						onSend={send}
						onCommand={onCommand}
						onStop={stop}
						onSendQueueNow={sendQueueNow}
						onRecallQueued={async () => {
							const newest = d.queue.at(-1);
							return newest ? withdraw(newest) : null;
						}}
						onError={(m) => session.notice(m, "error")}
						onDraftChange={setHasText}
					/>
					<Hints busy={busy} hasText={hasText} hasQueue={d.queue.length > 0} />
				</div>
			</div>
		</div>
	);
}
