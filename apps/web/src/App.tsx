import { DinoSpeciesProvider, Toaster, TooltipProvider } from "@dinobot/ui";
import { useEffect, useState } from "react";
import { ChatView } from "./chat/ChatView.tsx";
import { lazy, Suspense } from "react";
import { useRunner } from "./state/command-runner.ts";

// Dialogs load on first use: the first frame only pays for the shell and the transcript.
const CommandPalette = lazy(() => import("./dialogs/CommandPalette.tsx").then((m) => ({ default: m.CommandPalette })));
const CommandRunDialog = lazy(() => import("./dialogs/CommandRun.tsx").then((m) => ({ default: m.CommandRunDialog })));
const SubagentSheet = lazy(() => import("./dialogs/SubagentSheet.tsx").then((m) => ({ default: m.SubagentSheet })));
const Overlays = lazy(() => import("./dialogs/Overlays.tsx").then((m) => ({ default: m.Overlays })));
const LoginCard = lazy(() => import("./prefs/LoginCard.tsx").then((m) => ({ default: m.LoginCard })));
const Preferences = lazy(() => import("./prefs/Preferences.tsx").then((m) => ({ default: m.Preferences })));

/** Mounts a lazy dialog once it has been wanted at least once (keeps its close animation afterwards). */
function useOnce(flag: boolean): boolean {
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		if (flag && !seen) setSeen(true);
	}, [flag, seen]);
	return seen || flag;
}

import { desktop } from "./lib/bridge.ts";
import { useSettings } from "./lib/settings.ts";
import { useDinoSync, useThemeSync } from "./lib/theme.ts";
import { WorkPanel } from "./panel/WorkPanel.tsx";
import { ConnectionScreen } from "./shell/ConnectionScreen.tsx";
import { EmptyState } from "./shell/EmptyState.tsx";
import { Sidebar } from "./shell/Sidebar.tsx";
import { TitleBar } from "./shell/TitleBar.tsx";
import { connect, newThread, openPalette, openSettings, useApp } from "./state/app.ts";
import { useUi } from "./state/ui.ts";

function useShortcuts() {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			if (!mod || e.altKey) return;
			// Holding a toggle key must toggle once (TUI key gate, T137).
			if (e.repeat && ["o", "e", "b", "t", "j", "k", "p", "/", ","].includes(e.key.toLowerCase())) {
				e.preventDefault();
				return;
			}
			const k = e.key.toLowerCase();
			if (k === "k") {
				e.preventDefault();
				openPalette();
			} else if (k === "p" && !e.shiftKey) {
				e.preventDefault();
				useUi.setState({ switcherOpen: true });
			} else if (k === "f" && e.shiftKey) {
				e.preventDefault();
				useUi.setState({ searchOpen: true, searchQuery: "" });
			} else if (k === "/") {
				// The TUI's Ctrl+X cheatsheet: Ctrl+X stays "cut" on the desktop.
				e.preventDefault();
				useUi.setState({ shortcutsOpen: true });
			} else if (k === "o" && !e.shiftKey) {
				e.preventDefault();
				const s = useSettings.getState();
				s.set({ toolsExpanded: !s.toolsExpanded });
			} else if (k === "e" && !e.shiftKey) {
				e.preventDefault();
				const s = useSettings.getState();
				s.set({ thinkingExpanded: !s.thinkingExpanded });
			} else if (k === "j" && !e.shiftKey) {
				e.preventDefault();
				useUi.setState({ askOpen: true });
			} else if (k === "t" && !e.shiftKey) {
				e.preventDefault();
				useUi.setState((s) => ({ todoOpen: !s.todoOpen }));
			} else if (k === "n" && !e.shiftKey) {
				e.preventDefault();
				if (useApp.getState().connection === "online") newThread();
			} else if (k === ",") {
				e.preventDefault();
				openSettings();
			} else if (k === "b") {
				e.preventDefault();
				const s = useSettings.getState();
				s.set({ panelOpen: !s.panelOpen });
			}
		};
		window.addEventListener("keydown", onKey);
		const off = desktop?.onMenuCommand((command) => {
			if (command === "new-thread" && useApp.getState().connection === "online") newThread();
			else if (command === "command-palette") openPalette();
			else if (command === "settings") openSettings();
			else if (command === "toggle-panel") {
				const s = useSettings.getState();
				s.set({ panelOpen: !s.panelOpen });
			}
		});
		return () => {
			window.removeEventListener("keydown", onKey);
			off?.();
		};
	}, []);
}

export function App() {
	useThemeSync();
	const dino = useDinoSync();
	useShortcuts();
	const connection = useApp((s) => s.connection);
	const activeKey = useApp((s) => s.activeKey);
	const panelOpen = useSettings((s) => s.panelOpen);
	const palette = useOnce(useApp((s) => s.paletteOpen));
	const run = useOnce(useRunner((s) => s.run !== null));
	const settings = useOnce(useApp((s) => s.settingsOpen));
	const subagent = useOnce(useApp((s) => s.subagentView !== null));
	const overlays = useOnce(useUi((s) => s.switcherOpen || s.agentsOpen || s.dagOpen || s.helpOpen || s.searchOpen || s.shortcutsOpen));
	useEffect(() => {
		void connect();
	}, []);
	return (
		<DinoSpeciesProvider species={dino}>
			<TooltipProvider delay={400}>
				<div className="flex h-full flex-col bg-bg text-fg">
					<TitleBar />
					{connection === "online" ? (
						<div className="flex min-h-0 flex-1">
							<Sidebar />
							<main className="flex min-w-0 flex-1 flex-col">{activeKey ? <ChatView key={activeKey} threadKey={activeKey} /> : <EmptyState />}</main>
							{panelOpen && activeKey ? <WorkPanel key={activeKey} threadKey={activeKey} /> : null}
						</div>
					) : (
						<ConnectionScreen />
					)}
				</div>
				<Suspense fallback={null}>
					{palette ? <CommandPalette /> : null}
					{run ? <CommandRunDialog /> : null}
					{run ? <LoginCard /> : null}
					{settings ? <Preferences /> : null}
					{overlays ? <Overlays /> : null}
					{subagent ? <SubagentSheet /> : null}
				</Suspense>
				<Toaster />
			</TooltipProvider>
		</DinoSpeciesProvider>
	);
}
