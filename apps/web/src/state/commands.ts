import type { CommandInfo } from "@dinobot/contracts";
import { create } from "zustand";
import { api } from "../lib/api.ts";

/** Daemon slash commands (surface "tui"), fetched once per connection. */
export const useCommands = create<{ commands: CommandInfo[]; loaded: boolean }>(() => ({ commands: [], loaded: false }));

let loading: Promise<void> | undefined;
export function loadCommands(): Promise<void> {
	loading ??= api
		.commands()
		.then(({ commands }) => useCommands.setState({ commands, loaded: true }))
		.catch(() => {
			loading = undefined;
		});
	return loading;
}

/** Commands handled by the app itself. */
export const LOCAL_COMMANDS: CommandInfo[] = [
	{ name: "new", description: "새 스레드 (이름을 붙일 수 있어요)", usage: "[name]" },
	{ name: "thread", description: "이름으로 스레드 열기", usage: "<name>" },
	{ name: "sessions", description: "실시간 세션 목록" },
	{ name: "agents", description: "서브에이전트 목록·대화", usage: "[id]" },
	{ name: "dag", description: "DAG 실행 보기" },
	{ name: "choose", description: "질문에 답하기" },
	{ name: "help", description: "명령 도움말" },
	{ name: "settings", description: "설정 열기" },
	{ name: "quit", description: "앱 닫기 (데몬은 계속 실행)" },
];
