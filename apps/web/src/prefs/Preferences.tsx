import { cn, Dialog, DialogPopup } from "@dinobot/ui";
import { IconAdjustments, IconBrain, IconBug, IconChartBar, IconKeyboard, IconPlug, IconServer, IconSparkles, IconUserCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { ignoreStackedPress } from "../lib/dismiss.ts";
import { openSettings, useApp } from "../state/app.ts";
import { useRunner } from "../state/command-runner.ts";
import { AccountsTab } from "./AccountsTab.tsx";
import { ModelTab, ReportsTab, SkillsTab } from "./CommandsTab.tsx";
import { PluginsTab } from "./PluginsTab.tsx";
import { DaemonTab } from "./DaemonTab.tsx";
import { GeneralTab } from "./GeneralTab.tsx";
import { ShortcutsList } from "./ShortcutsTab.tsx";
import { UsageTab } from "./UsageTab.tsx";

const TABS: { id: string; label: string; icon: ReactNode; view: () => ReactNode }[] = [
	{ id: "general", label: "일반", icon: <IconAdjustments />, view: () => <GeneralTab /> },
	{ id: "accounts", label: "계정", icon: <IconUserCircle />, view: () => <AccountsTab /> },
	{ id: "usage", label: "사용량", icon: <IconChartBar />, view: () => <UsageTab /> },
	{ id: "model", label: "모델", icon: <IconBrain />, view: () => <ModelTab /> },
	{ id: "skills", label: "스킬", icon: <IconSparkles />, view: () => <SkillsTab /> },
	{ id: "plugins", label: "플러그인", icon: <IconPlug />, view: () => <PluginsTab /> },
	{ id: "reports", label: "문제 보고", icon: <IconBug />, view: () => <ReportsTab /> },
	{ id: "daemon", label: "데몬", icon: <IconServer />, view: () => <DaemonTab /> },
	{ id: "shortcuts", label: "단축키", icon: <IconKeyboard />, view: () => <ShortcutsList /> },
];

/** Preferences: one window with a side nav. Every daemon setting goes through the same commands the TUI runs. */
export function Preferences() {
	const open = useApp((s) => s.settingsOpen);
	const tab = useApp((s) => s.preferencesTab);
	const current = TABS.find((t) => t.id === tab) ?? (TABS[0] as (typeof TABS)[number]);
	return (
		<Dialog
			open={open}
			onOpenChange={(o, details) => {
				if (!o && (ignoreStackedPress(details) || useRunner.getState().run)) return;
				openSettings(o);
			}}
		>
			<DialogPopup className="h-[min(86vh,760px)] w-[min(94vw,980px)] max-h-none flex-row overflow-hidden p-0" showClose={false} data-testid="settings" aria-label="설정">
				<nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-line bg-band p-2" aria-label="설정 메뉴">
					<div className="px-2 pt-2 pb-3 text-md font-semibold">설정</div>
					{TABS.map((t) => (
						<button
							key={t.id}
							type="button"
							data-tab={t.id}
							aria-current={t.id === current.id ? "page" : undefined}
							onClick={() => useApp.setState({ preferencesTab: t.id })}
							className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm [&_svg]:size-4", t.id === current.id ? "bg-pressed text-fg" : "text-fg-2 hover:bg-hover hover:text-fg")}
						>
							{t.icon}
							{t.label}
						</button>
					))}
				</nav>
				<div className="flex min-w-0 flex-1 flex-col">
					<div className="flex items-center border-b border-line px-6 py-3.5">
						<h2 className="flex-1 text-lg font-semibold">{current.label}</h2>
						<button type="button" aria-label="닫기" onClick={() => openSettings(false)} className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-fg-3 hover:bg-hover hover:text-fg">
							✕
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{current.view()}</div>
				</div>
			</DialogPopup>
		</Dialog>
	);
}
