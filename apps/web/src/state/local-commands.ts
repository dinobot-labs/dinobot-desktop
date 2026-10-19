/**
 * Local commands handled by the app itself (TUI src/tui/slash.ts LOCAL_COMMANDS): /new [name], /thread <name>,
 * /sessions, /agents [id], /dag, /choose, /help, /quit (/exit), /settings, /search <words>. Everything else runs on
 * the daemon.
 */
import { toast } from "@dinobot/ui";
import { desktop } from "../lib/bridge.ts";
import { newThread, openSettings, openSubagent, runCommandUi, selectThread, sessionFor, useApp } from "./app.ts";
import { useUi } from "./ui.ts";

export function runLocalOrDaemon(name: string, args: string, quiet = false): void {
	const key = useApp.getState().activeKey;
	switch (name) {
		case "new":
			newThread(args.trim() ? args.trim().split(/\s+/).join("-") : undefined);
			return;
		case "thread":
		case "threads":
			if (!args.trim()) {
				useUi.setState({ switcherOpen: true });
				return;
			}
			void selectThread(args.trim().startsWith("tui:") ? args.trim() : `tui:${args.trim()}`);
			return;
		case "sessions":
			useUi.setState({ switcherOpen: true });
			return;
		case "agents": {
			if (!key) return;
			const subagents = sessionFor(key).side.subagents;
			if (!args.trim()) {
				useUi.setState({ agentsOpen: true });
				return;
			}
			const found = subagents.find((s) => s.taskId === args.trim());
			if (!found) toast({ tone: "error", title: `unknown subagent ${args.trim()}`, body: subagents.length ? `known: ${subagents.map((s) => s.taskId).join(", ")}` : undefined });
			else if (found.conversationId > 0) openSubagent(found.conversationId, found.description || found.taskId);
			else toast({ title: `subagent ${found.description} has no conversation yet` });
			return;
		}
		case "dag":
			if (!key || !sessionFor(key).side.dag) toast({ title: "이 스레드에는 DAG 실행이 없어요" });
			else useUi.setState({ dagOpen: true });
			return;
		case "choose":
			useUi.setState({ askOpen: true });
			return;
		case "help":
			useUi.setState({ helpOpen: true });
			return;
		case "quit":
		case "exit":
			if (desktop) window.close();
			return;
		case "settings":
			openSettings();
			return;
		case "search":
			useUi.setState({ searchOpen: true, searchQuery: args });
			return;
		case "login":
			if (!args.trim()) {
				openSettings(true, "accounts");
				return;
			}
			runCommandUi("login", args.trim());
			return;
		default:
			runCommandUi(name, args || undefined, quiet ? "quiet" : "dialog");
	}
}
