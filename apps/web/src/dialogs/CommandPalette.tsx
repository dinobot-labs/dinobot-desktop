import type { CommandArgument, CommandInfo } from "@dinobot/contracts";
import { cn, Dialog, DialogPopup, Kbd } from "@dinobot/ui";
import { IconArrowLeft, IconCommand, IconMessage, IconMoon, IconPlus, IconSettings, IconSun } from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useSettings } from "../lib/settings.ts";
import { threadLabel } from "../shell/thread-label.ts";
import { closePalette, newThread, openSettings, runCommandUi, selectThread, useApp } from "../state/app.ts";
import { loadCommands, useCommands } from "../state/commands.ts";

type Item = { id: string; label: string; hint?: string; group: string; icon?: ReactNode; badge?: string; current?: boolean; disabled?: boolean; run: () => void };

/** Ctrl+K: app actions, thread switching and daemon slash commands; commands with arguments open a second step. */
export function CommandPalette() {
	const open = useApp((s) => s.paletteOpen);
	const initial = useApp((s) => s.paletteQuery);
	const threads = useApp((s) => s.threads);
	const titles = useApp((s) => s.titles);
	const activeKey = useApp((s) => s.activeKey);
	const commands = useCommands((s) => s.commands);
	const theme = useSettings((s) => s.theme);
	const setSettings = useSettings((s) => s.set);
	const [query, setQuery] = useState("");
	const [step, setStep] = useState<{ command: CommandInfo; args: CommandArgument[] | null } | null>(null);
	const [index, setIndex] = useState(0);
	const list = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (open) {
			setQuery(initial);
			setStep(null);
			setIndex(0);
			void loadCommands();
		}
	}, [open, initial]);

	const chooseCommand = (command: CommandInfo) => {
		if (!activeKey) return;
		setStep({ command, args: null });
		setQuery("");
		setIndex(0);
		void api
			.commandArguments(command.name, activeKey)
			.then(({ arguments: args }) => {
				if (args.length === 0) runCommandUi(command.name);
				else setStep({ command, args });
			})
			.catch(() => runCommandUi(command.name));
	};

	const items: Item[] = useMemo(() => {
		if (step) {
			return (step.args ?? []).map((a) => ({
				id: a.value,
				label: a.label,
				group: a.group ?? step.command.name,
				...(a.description ? { hint: a.description } : {}),
				...(a.badge ? { badge: a.badge } : {}),
				...(a.current ? { current: true } : {}),
				...(a.disabled ? { disabled: true } : {}),
				run: () => runCommandUi(step.command.name, a.value),
			}));
		}
		const actions: Item[] = [
			{ id: "new", label: "새 스레드", group: "동작", icon: <IconPlus size={15} />, hint: "Ctrl N", run: () => (closePalette(), newThread()) },
			{ id: "settings", label: "설정", group: "동작", icon: <IconSettings size={15} />, hint: "Ctrl ,", run: () => (closePalette(), openSettings()) },
			{
				id: "theme",
				label: theme === "dark" ? "밝은 테마로" : "어두운 테마로",
				group: "동작",
				icon: theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />,
				run: () => (closePalette(), setSettings({ theme: theme === "dark" ? "light" : "dark" })),
			},
		];
		const cmds: Item[] = activeKey?.startsWith("tui:")
			? commands.map((c) => ({ id: `/${c.name}`, label: `/${c.name}`, hint: c.description, group: "명령", icon: <IconCommand size={15} />, run: () => chooseCommand(c) }))
			: [];
		const recent: Item[] = threads.slice(0, 30).map((t) => ({
			id: t.key,
			label: threadLabel(t.key, titles, t.status),
			hint: t.key,
			group: "스레드",
			icon: <IconMessage size={15} />,
			...(t.key === activeKey ? { current: true } : {}),
			run: () => (closePalette(), void selectThread(t.key)),
		}));
		return [...actions, ...cmds, ...recent];
	}, [step, commands, threads, titles, activeKey, theme]);

	const q = query.trim().toLowerCase();
	const filtered = q ? items.filter((i) => `${i.label} ${i.hint ?? ""} ${i.id}`.toLowerCase().includes(q)) : items;
	const clamped = Math.min(index, Math.max(0, filtered.length - 1));

	useEffect(() => {
		list.current?.querySelector(`[data-index="${clamped}"]`)?.scrollIntoView({ block: "nearest" });
	}, [clamped]);

	let lastGroup = "";
	return (
		<Dialog open={open} onOpenChange={(o) => !o && closePalette()}>
			<DialogPopup side="top" showClose={false} className="overflow-hidden p-0" aria-label="명령 팔레트">
				<div className="flex items-center gap-2 border-b border-line px-3">
					{step ? (
						<button type="button" aria-label="뒤로" onClick={() => setStep(null)} className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-fg-3 hover:bg-hover">
							<IconArrowLeft size={15} />
						</button>
					) : null}
					{step ? <span className="font-mono text-sm text-fg">/{step.command.name}</span> : null}
					<input
						autoFocus
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setIndex(0);
						}}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing) return;
							if (e.key === "ArrowDown") {
								e.preventDefault();
								setIndex((i) => Math.min(i + 1, filtered.length - 1));
							} else if (e.key === "ArrowUp") {
								e.preventDefault();
								setIndex((i) => Math.max(i - 1, 0));
							} else if (e.key === "Enter") {
								e.preventDefault();
								const item = filtered[clamped];
								if (item && !item.disabled) item.run();
								else if (step && query.trim()) runCommandUi(step.command.name, query.trim());
							} else if (e.key === "Backspace" && !query && step) setStep(null);
						}}
						placeholder={step ? (step.args === null ? "불러오는 중…" : "고르거나 직접 입력하고 Enter") : "명령, 스레드, 동작 찾기"}
						className="h-11 min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-3"
						aria-label="명령 검색"
					/>
					<Kbd>Esc</Kbd>
				</div>
				<div ref={list} className="max-h-[55vh] overflow-y-auto p-1.5" role="listbox">
					{filtered.length === 0 ? <div className="px-3 py-6 text-center text-sm text-fg-3">{step?.args === null ? "불러오는 중…" : "찾는 항목이 없어요"}</div> : null}
					{filtered.map((item, i) => {
						const header = item.group !== lastGroup ? item.group : null;
						lastGroup = item.group;
						return (
							<div key={`${item.group}:${item.id}`}>
								{header ? <div className="px-2.5 pt-2 pb-1 font-mono text-micro uppercase tracking-[var(--tr-label)] text-fg-3">{header}</div> : null}
								<button
									type="button"
									role="option"
									aria-selected={i === clamped}
									data-index={i}
									disabled={item.disabled}
									onMouseMove={() => setIndex(i)}
									onClick={() => item.run()}
									className={cn("flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40", i === clamped && "bg-hover")}
								>
									{item.icon ? <span className="text-fg-3">{item.icon}</span> : null}
									<span className="min-w-0 truncate text-fg">{item.label}</span>
									{item.current ? <span className="shrink-0 rounded-xs bg-accent-tint px-1 text-micro text-accent-deep">현재</span> : null}
									{item.badge ? <span className="shrink-0 rounded-xs bg-hover px-1 text-micro text-fg-2">{item.badge}</span> : null}
									<span className="ml-auto min-w-0 truncate pl-3 text-xs text-fg-3">{item.hint}</span>
								</button>
							</div>
						);
					})}
				</div>
			</DialogPopup>
		</Dialog>
	);
}
