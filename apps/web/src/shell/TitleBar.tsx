import { Badge, Button, cn, ContextMeter, DinoMark, Shimmer, toast, Tooltip } from "@dinobot/ui";
import { IconFolder, IconGitBranch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { desktop } from "../lib/bridge.ts";
import { useSession } from "../lib/hooks.ts";
import { sessionFor } from "../state/app.ts";
import { IconLayoutSidebarRight, IconLayoutSidebarRightFilled } from "@tabler/icons-react";
import { useEffect } from "react";
import { platform } from "../lib/bridge.ts";
import { useSettings } from "../lib/settings.ts";
import { runCommandUi, useApp } from "../state/app.ts";
import { threadLabel } from "./thread-label.ts";
import { BrowserEntry } from "../panel/BrowserEntry.tsx";

/** 40px app chrome: drag region, the thread title and its live state, the model chip and the panel toggle. */
export function TitleBar() {
	const activeKey = useApp((s) => s.activeKey);
	const connection = useApp((s) => s.connection);
	const entry = useApp((s) => s.threads.find((t) => t.key === s.activeKey));
	const titles = useApp((s) => s.titles);
	const model = useApp((s) => (s.activeKey ? s.models[s.activeKey] : undefined));
	const panelOpen = useSettings((s) => s.panelOpen);
	const setSettings = useSettings((s) => s.set);
	const mac = platform === "darwin";
	const busy = entry?.status?.busy ?? false;
	const session = useMemo(() => (activeKey && connection === "online" ? sessionFor(activeKey) : undefined), [activeKey, connection]);
	useSession(session);
	const cwd = session?.side.agent.cwd;
	const [branch, setBranch] = useState<string | null>(null);
	useEffect(() => {
		setBranch(null);
		if (!cwd || !desktop?.gitBranch) return;
		let live = true;
		const load = () => void desktop?.gitBranch(cwd).then((b) => live && setBranch(b));
		load();
		window.addEventListener("focus", load);
		return () => {
			live = false;
			window.removeEventListener("focus", load);
		};
	}, [cwd]);
	const contextTokens = session?.side.usage.contextTokens ?? 0;
	const label = activeKey ? threadLabel(activeKey, titles, entry?.status) : "";
	useEffect(() => {
		document.title = label ? `${label} · dinobot` : "dinobot";
	}, [label]);
	return (
		<header className={cn("app-drag flex h-10 shrink-0 items-center gap-2 border-b border-line bg-band", mac ? "pl-20" : "pl-3", platform === "win32" || platform === "linux" ? "pr-[148px]" : "pr-2")}>
			<div className="flex shrink-0 items-center gap-2">
				<DinoMark size={22} />
				<span className="text-sm font-semibold tracking-[-0.01em]">dinobot</span>
			</div>
			{activeKey && connection === "online" ? (
				<div className="flex min-w-0 flex-1 items-center gap-2 pl-4">
					<span className="h-4 w-px shrink-0 bg-line-strong" />
					<span className="min-w-0 truncate text-sm text-fg-2">{label}</span>
					{busy ? (
						<Badge variant="running" className="shrink-0">
							<Shimmer>{entry?.status?.state === "running_tools" ? "도구 실행 중" : entry?.status?.state === "retrying" ? "다시 시도 중" : "작업 중"}</Shimmer>
						</Badge>
					) : null}
					{!activeKey.startsWith("tui:") ? <Badge variant="outline" className="shrink-0">읽기 전용</Badge> : null}
				</div>
			) : (
				<div className="flex-1" />
			)}
			{activeKey && cwd ? (
				<div className="hidden shrink-0 items-center gap-2 lg:flex" data-testid="header-context">
					{branch ? (
						<span className="flex items-center gap-1 font-mono text-micro text-fg-3" title="git 브랜치">
							<IconGitBranch size={12} />
							{branch}
						</span>
					) : null}
					<Tooltip content={`${cwd} (클릭해서 경로 복사)`}>
						<button type="button" onClick={() => void navigator.clipboard.writeText(cwd).then(() => toast({ title: "경로를 복사했어요" }))} className="flex max-w-40 cursor-pointer items-center gap-1 truncate font-mono text-micro text-fg-3 hover:text-fg">
							<IconFolder size={12} />
							{cwd.split(/[\\/]/).filter(Boolean).pop()}
						</button>
					</Tooltip>
					{contextTokens ? <ContextMeter used={contextTokens} window={model?.contextWindow} /> : null}
					<Tooltip content="스레드 키 복사">
						<button type="button" onClick={() => void navigator.clipboard.writeText(activeKey).then(() => toast({ title: `${activeKey} 복사함` }))} className="cursor-pointer font-mono text-micro text-fg-3 hover:text-fg">
							[{activeKey}]
						</button>
					</Tooltip>
				</div>
			) : null}
			{activeKey && model ? (
				<Tooltip content="모델 바꾸기 (/model)">
					<button
						type="button"
						onClick={() => runCommandUi("model")}
						className="flex h-7 max-w-64 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 font-mono text-xs text-fg-2 hover:bg-hover hover:text-fg"
					>
						<span className={cn("size-1.5 rounded-full", model.signedIn === false ? "bg-status-failed" : "bg-status-success")} />
						<span className="truncate">{model.model.split("/").pop()}</span>
						{model.supportedThinkingLevels.length > 0 ? <span className="text-fg-3">· {model.thinkingLevel}</span> : null}
						{model.fast ? <span className="text-fg-3">· fast</span> : null}
					</button>
				</Tooltip>
			) : null}
			<BrowserEntry activeKey={activeKey} online={connection === "online"} />
			{activeKey ? (
				<Tooltip content={panelOpen ? "작업 패널 닫기 (Ctrl B)" : "작업 패널 열기 (Ctrl B)"}>
					<Button variant="ghost" size="icon-sm" aria-label="작업 패널" aria-pressed={panelOpen} onClick={() => setSettings({ panelOpen: !panelOpen })}>
						{panelOpen ? <IconLayoutSidebarRightFilled /> : <IconLayoutSidebarRight />}
					</Button>
				</Tooltip>
			) : null}
		</header>
	);
}
