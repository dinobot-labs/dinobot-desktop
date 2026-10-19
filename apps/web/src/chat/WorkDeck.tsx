import type { SubagentProgress, TodoItem } from "@dinobot/contracts";
import { Badge, Banner, Button, cn, formatClock, HintBar, Shimmer, StatusMark, TodoList } from "@dinobot/ui";
import { IconChevronUp, IconDownload, IconRobot, IconWand } from "@tabler/icons-react";
import { useNow } from "../lib/hooks.ts";
import { useSettings } from "../lib/settings.ts";
import { openSubagent, runCommandUi, startDesktopUpdate, useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";
import type { SideState } from "./protocol.ts";

/** Running subagents above the composer (TUI T152), minus those already shown as running DAG nodes (T153). */
export function SubagentDock({ side }: { side: SideState }) {
	const now = useNow(true, 1000);
	const running = side.subagents.filter((s) => s.status === "running");
	if (!side.subagents.length) return null;
	const dagRunning = new Set((side.dag?.status === "running" ? side.dag.nodes : []).filter((n) => n.state === "running" || n.state === "waiting").map((n) => n.handle));
	const shown = running.filter((s) => !dagRunning.has(s.taskId));
	const done = side.subagents.filter((s) => s.status === "completed").length;
	const failed = side.subagents.filter((s) => s.status === "failed").length;
	const cancelled = side.subagents.filter((s) => s.status === "cancelled").length;
	if (!running.length) return null;
	return (
		<div className="rounded-lg border border-line bg-surface px-3 py-2" data-testid="subagent-dock">
			<div className="flex items-center gap-2 text-xs text-fg-3">
				<IconRobot size={13} />
				<span className="font-mono uppercase tracking-[var(--tr-label)]">서브에이전트 · {running.length}개 실행 중</span>
				<span className="flex-1" />
				<span>
					기록: {done} 완료{failed ? ` · ${failed} 실패` : ""}
					{cancelled ? ` · ${cancelled} 취소` : ""}
				</span>
				<button type="button" className="cursor-pointer text-accent-deep hover:underline" onClick={() => useUi.setState({ agentsOpen: true })}>
					모두 보기
				</button>
			</div>
			{shown.slice(0, 4).map((s) => (
				<DockRow key={s.taskId} s={s} now={now} />
			))}
			{shown.length > 4 ? <div className="pt-1 text-xs text-fg-3">+{shown.length - 4}개 더</div> : null}
		</div>
	);
}

function DockRow({ s, now }: { s: SubagentProgress; now: number }) {
	return (
		<button type="button" disabled={s.conversationId <= 0} onClick={() => openSubagent(s.conversationId, s.description || s.taskId)} className="mt-1 flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm text-left text-sm hover:bg-hover disabled:cursor-default">
			<StatusMark kind="running" size={13} />
			<span className="min-w-0 shrink truncate text-fg">{s.description}</span>
			<span className="min-w-0 flex-1 truncate font-mono text-micro text-fg-3">{s.currentTool ? <Shimmer>{s.currentTool}</Shimmer> : s.lastText}</span>
			<span className="shrink-0 font-mono text-micro text-fg-3">{formatClock(now - s.startedAt)}</span>
		</button>
	);
}

/**
 * Todo caption on the composer (TUI T163): progress, the current item and the next one. Ctrl+T or a click unfolds the
 * whole list right above the composer and folds it back.
 */
export function TodoCaption({ todos }: { todos: TodoItem[] }) {
	const open = useUi((s) => s.todoOpen);
	if (!todos.length) return null;
	const done = todos.filter((t) => t.status === "completed").length;
	const current = todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status === "pending");
	const next = current ? todos.slice(todos.indexOf(current) + 1).find((t) => t.status === "pending") : undefined;
	const toggle = () => useUi.setState((s) => ({ todoOpen: !s.todoOpen }));
	if (open) {
		return (
			<div className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2" data-testid="todo-expanded">
				<button type="button" onClick={toggle} aria-expanded="true" className="flex min-w-0 cursor-pointer items-center gap-2 text-left text-xs text-fg-3 hover:text-fg-2" data-testid="todo-caption">
					<span className="shrink-0 font-mono uppercase tracking-[var(--tr-label)]">
						Todo {done}/{todos.length}
					</span>
					<span className="flex-1" />
					<span className="shrink-0 font-mono text-micro">Ctrl T</span>
					<IconChevronUp size={13} className="shrink-0" />
				</button>
				<div className="max-h-64 overflow-y-auto">
					<TodoList todos={todos} className="[&>div:first-child]:hidden" />
				</div>
			</div>
		);
	}
	return (
		<button
			type="button"
			onClick={toggle}
			aria-expanded="false"
			className="flex min-w-0 cursor-pointer items-center gap-2 px-1 text-left text-xs text-fg-3 hover:text-fg-2"
			data-testid="todo-caption"
		>
			<span className="shrink-0 font-mono uppercase tracking-[var(--tr-label)]">
				Todo {done}/{todos.length}
			</span>
			{current ? (
				<>
					<StatusMark kind={current.status === "in_progress" ? "running" : "pending"} size={12} />
					<span className={cn("min-w-0 truncate", current.status === "in_progress" ? "text-fg-2" : "")}>{current.content}</span>
				</>
			) : (
				<span>{done === todos.length ? "모두 끝났어요" : "할 일이 없어요"}</span>
			)}
			{next ? <span className="hidden min-w-0 truncate md:inline">→ {next.content}</span> : null}
			<span className="ml-auto shrink-0 font-mono text-micro">Ctrl T</span>
		</button>
	);
}

/** Banners above the composer (TUI T06, T09, T12): update available, older daemon, unfinished setup. */
export function Notices() {
	const update = useApp((s) => s.update);
	const desktopUpdate = useApp((s) => s.desktopUpdate);
	const older = useApp((s) => s.olderDaemon);
	const daemon = useApp((s) => s.daemon);
	const dismissed = useApp((s) => s.dismissed);
	const dismiss = (id: string) => useApp.setState((s) => ({ dismissed: [...s.dismissed, id] }));
	return (
		<>
			{older && !dismissed.includes("older") ? (
				<Banner tone="failed" onDismiss={() => dismiss("older")}>
					실행 중인 dinobot 데몬이 이 앱보다 오래돼서 /login, /model 같은 명령을 쓸 수 없어요. 설정 › 데몬에서 다시 시작하세요.
				</Banner>
			) : null}
			{update?.newer && !dismissed.includes("update") ? (
				<Banner
					icon={<IconDownload />}
					onDismiss={() => dismiss("update")}
					actions={
						<Button size="xs" variant="ghost" onClick={() => void navigator.clipboard.writeText("dinobot update")}>
							명령 복사
						</Button>
					}
				>
					업데이트가 있어요: {daemon?.version} → {update.latest}. 터미널에서 <code className="font-mono">dinobot update</code>를 실행하세요.
				</Banner>
			) : null}
			{desktopUpdate?.newer && !dismissed.includes("desktop-update") ? (
				<Banner
					icon={<IconDownload />}
					onDismiss={() => dismiss("desktop-update")}
					actions={
						<Button size="xs" variant="ghost" disabled={desktopUpdate.updating} onClick={() => void startDesktopUpdate()}>
							{desktopUpdate.updating ? "업데이트 중…" : "지금 업데이트"}
						</Button>
					}
				>
					{desktopUpdate.updating
						? "새 버전을 받는 중이에요. 확인이 끝나면 앱이 닫혔다가 다시 열려요."
						: `데스크톱 앱 새 버전이 있어요: ${desktopUpdate.current} → ${desktopUpdate.latest}.`}
				</Banner>
			) : null}
			{daemon?.setup.startedAt && !daemon.setup.completedAt && !dismissed.includes("setup") ? (
				<Banner
					tone="waiting"
					icon={<IconWand />}
					onDismiss={() => dismiss("setup")}
					actions={
						<Button size="xs" variant="ghost" onClick={() => runCommandUi("setup")}>
							이어서 설정
						</Button>
					}
				>
					설정을 아직 마치지 않았어요. 텔레그램, 컴퓨터 사용, 구글, 문제 보고는 언제든 /setup으로 연결할 수 있어요.
				</Banner>
			) : null}
		</>
	);
}

/** Context-sensitive key hints under the composer (TUI T147). */
export function Hints({ busy, hasText, hasQueue }: { busy: boolean; hasText: boolean; hasQueue: boolean }) {
	const show = useSettings((s) => s.showHints);
	if (!show) return null;
	const hints = [
		...(hasText || !hasQueue ? [{ keys: "Enter", label: busy ? "steer" : "보내기" }] : [{ keys: "Enter", label: "대기 메시지 지금 보내기" }, { keys: "↓", label: "대기 메시지 고치기" }]),
		{ keys: "Shift+Tab", label: "추론" },
		{ keys: "Shift+Enter", label: "줄바꿈" },
		...(busy ? [{ keys: "Esc", label: "멈추기" }] : []),
		{ keys: "Ctrl+O", label: "도구" },
		{ keys: "Ctrl+E", label: "생각" },
		{ keys: "Ctrl+/", label: "단축키" },
	];
	return <HintBar hints={hints} className="px-1" />;
}

export { Badge };
