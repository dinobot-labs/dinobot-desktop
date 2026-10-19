import { localeTag } from "@dinobot/ui/i18n";
import type { SearchHit } from "@dinobot/contracts";
import { DagGraph, DagHeader, DagRail, Dialog, DialogPopup, formatClock, Input, Picker, type PickerOption, Tabs, TabsList, TabsTab, toast } from "@dinobot/ui";
import { IconLock, IconMessage, IconPlus, IconRobot } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import { relativeTime, useNow, useSession } from "../lib/hooks.ts";
import { ShortcutsList } from "../prefs/ShortcutsTab.tsx";
import { threadLabel } from "../shell/thread-label.ts";
import { closeSubagent, newThread, openSubagent, selectThread, sessionFor, useApp } from "../state/app.ts";
import { LOCAL_COMMANDS, useCommands } from "../state/commands.ts";
import { useUi } from "../state/ui.ts";
import { ResearchCard } from "../panel/Research.tsx";

const STATE: Record<string, string> = { idle: "대기", generating: "답하는 중", running_tools: "도구 실행 중", retrying: "다시 시도 중" };

/** Ctrl+P / /thread / /sessions: every thread with live state; other channels are listed read-only. */
function ThreadSwitcher() {
	const open = useUi((s) => s.switcherOpen);
	const threads = useApp((s) => s.threads);
	const titles = useApp((s) => s.titles);
	const active = useApp((s) => s.activeKey);
	const options: PickerOption[] = useMemo(
		() =>
			threads.map((t) => ({
				id: t.key,
				label: threadLabel(t.key, titles, t.status),
				text: `${threadLabel(t.key, titles, t.status)} ${t.key} ${t.status?.lastText ?? ""}`,
				description: t.status?.lastText ?? t.key,
				group: t.status?.busy ? "진행 중" : t.channel === "tui" ? "스레드" : "다른 채널 (읽기 전용)",
				...(t.key === active ? { current: true } : {}),
				...(t.status ? { tag: `${STATE[t.status.state] ?? t.status.state}${t.status.lastActivityAt ? ` · ${relativeTime(t.status.lastActivityAt)}` : ""}${t.status.queued ? ` · 대기 ${t.status.queued}` : ""}` } : {}),
				icon: t.channel === "tui" ? <IconMessage /> : <IconLock />,
			})),
		[threads, titles, active],
	);
	return (
		<Picker
			open={open}
			title="스레드로 이동"
			placeholder="스레드 찾기 · 없는 이름이면 새로 만들어요"
			options={options}
			onChoose={([id]) => {
				useUi.setState({ switcherOpen: false });
				if (id) void selectThread(id);
			}}
			onCancel={() => useUi.setState({ switcherOpen: false })}
			footer={
				<button type="button" className="ml-auto flex cursor-pointer items-center gap-1 text-accent-deep" onClick={() => (useUi.setState({ switcherOpen: false }), newThread())}>
					<IconPlus size={12} /> 새 스레드
				</button>
			}
		/>
	);
}

/** /agents: every subagent of the thread, running first; Enter opens its conversation. */
function AgentsPicker() {
	const open = useUi((s) => s.agentsOpen);
	const key = useApp((s) => s.activeKey);
	const session = useMemo(() => (key ? sessionFor(key) : undefined), [key]);
	useSession(session);
	const now = useNow(open, 1000);
	const list = session?.side.subagents ?? [];
	const options: PickerOption[] = [...list]
		.sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.startedAt - a.startedAt)
		.map((p) => ({
			id: p.taskId,
			label: `${p.status === "completed" ? "done" : p.status} · ${p.description || p.taskId}`,
			description: `${p.subagentType} · 도구 ${p.toolCount}개 · ${p.error ?? p.currentTool ?? p.lastText ?? p.taskId}`,
			group: p.status === "running" ? "진행 중" : "기록",
			tag: formatClock((p.endedAt ?? now) - p.startedAt),
			icon: <IconRobot />,
			...(p.conversationId > 0 ? {} : { disabled: true }),
		}));
	return (
		<Picker
			open={open}
			title="서브에이전트"
			header="Enter로 대화와 결과를 열어요"
			options={options}
			emptyText="이 스레드에는 아직 서브에이전트가 없어요"
			onChoose={([id]) => {
				useUi.setState({ agentsOpen: false });
				const p = list.find((s) => s.taskId === id);
				if (p && p.conversationId > 0) openSubagent(p.conversationId, p.description || p.taskId);
			}}
			onCancel={() => useUi.setState({ agentsOpen: false })}
		/>
	);
}

/** /dag: the whole run as a graph or by waves; clicking a node opens the subagent that ran it. */
function DagDialog() {
	const open = useUi((s) => s.dagOpen);
	const key = useApp((s) => s.activeKey);
	const session = useMemo(() => (key ? sessionFor(key) : undefined), [key]);
	useSession(session);
	const now = useNow(open, 1000);
	const [view, setView] = useState("graph");
	const dag = session?.side.dag;
	const select = (id: string) => {
		const node = dag?.nodes.find((n) => n.id === id);
		const sub = node?.handle?.startsWith("sa-") ? session?.side.subagents.find((s) => s.taskId === node.handle) : undefined;
		if (sub && sub.conversationId > 0) {
			useUi.setState({ dagOpen: false });
			openSubagent(sub.conversationId, sub.description || sub.taskId);
		} else toast({ title: `node ${id} has no conversation` });
	};
	return (
		<Dialog open={open} onOpenChange={(o) => useUi.setState({ dagOpen: o })}>
			<DialogPopup className="h-[min(86vh,820px)] w-[min(96vw,1200px)] max-h-none" heading={dag ? `DAG ${dag.id}${dag.revision ? ` · rev ${dag.revision}` : ""}` : "DAG"} data-testid="dag-dialog">
				{dag ? (
					<div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
						<div className="flex items-center gap-3">
							<DagHeader view={dag} live={{ now }} className="min-w-0 flex-1" />
							<Tabs value={view} onValueChange={(v) => setView(String(v))}>
								<TabsList>
									<TabsTab value="graph">그래프</TabsTab>
									<TabsTab value="rail">웨이브</TabsTab>
								</TabsList>
							</Tabs>
						</div>
						{dag.research ? <ResearchCard research={dag.research} threadKey={key ?? ""} /> : null}
						<div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-bg p-2">
							{view === "graph" ? <DagGraph view={dag} live={{ now }} onSelect={select} direction="LR" /> : <DagRail view={dag} live={{ now }} onSelect={select} />}
						</div>
					</div>
				) : null}
			</DialogPopup>
		</Dialog>
	);
}

/** /help: every command the app knows, local and daemon, with usage. */
function HelpDialog() {
	const open = useUi((s) => s.helpOpen);
	const commands = useCommands((s) => s.commands);
	const all = [...LOCAL_COMMANDS.map((c) => ({ ...c, local: true })), ...commands.filter((c) => !LOCAL_COMMANDS.some((l) => l.name === c.name)).map((c) => ({ ...c, local: false }))].sort((a, b) => a.name.localeCompare(b.name));
	return (
		<Dialog open={open} onOpenChange={(o) => useUi.setState({ helpOpen: o })}>
			<DialogPopup heading="명령" description="입력창에 / 를 치면 바로 고를 수 있어요" data-testid="help-dialog">
				<div className="min-h-0 overflow-y-auto px-5 pb-5">
					<div className="divide-y divide-line">
						{all.map((c) => (
							<div key={c.name} className="flex items-baseline gap-3 py-1.5 text-sm">
								<code className="w-40 shrink-0 font-mono text-fg">
									/{c.name}
									{c.usage ? <span className="text-fg-3"> {c.usage}</span> : null}
								</code>
								<span className="min-w-0 flex-1 text-fg-2">{c.description}</span>
								{c.local ? <span className="shrink-0 text-micro text-fg-3">앱</span> : null}
							</div>
						))}
					</div>
				</div>
			</DialogPopup>
		</Dialog>
	);
}

function Snippet({ text }: { text: string }) {
	const parts = text.split(/(\[[^\]]+\])/g);
	return (
		<span>
			{parts.map((p, i) => (p.startsWith("[") && p.endsWith("]") ? <mark key={i} className="rounded-xs bg-accent-soft px-0.5 text-fg">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
		</span>
	);
}

/** Ctrl+Shift+F / /search: search every thread's history (daemon session index). */
function SearchDialog() {
	const open = useUi((s) => s.searchOpen);
	const initial = useUi((s) => s.searchQuery);
	const titles = useApp((s) => s.titles);
	const [q, setQ] = useState("");
	const [result, setResult] = useState<{ hits: SearchHit[]; note?: string } | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (open) {
			setQ(initial);
			setResult(null);
		}
	}, [open, initial]);
	useEffect(() => {
		const query = q.trim();
		if (!open || !query) return;
		let live = true;
		setBusy(true);
		const timer = setTimeout(() => {
			void api
				.search(query, 20)
				.then((r) => live && setResult({ hits: r.results, ...(r.match === "any" || r.match === "substring" ? { note: "모든 단어가 들어간 메시지가 없어 일부 단어로 찾았어요" } : {}) }))
				.catch((e: unknown) => live && setResult({ hits: [], note: e instanceof Error ? e.message : String(e) }))
				.finally(() => live && setBusy(false));
		}, 250);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [q, open]);
	return (
		<Dialog open={open} onOpenChange={(o) => useUi.setState({ searchOpen: o })}>
			<DialogPopup side="top" heading="모든 스레드 검색" data-testid="search-dialog">
				<div className="flex min-h-0 flex-col gap-3 px-5 pb-5">
					<Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="찾을 말" aria-label="검색어" />
					{result?.note ? <div className="text-xs text-fg-3">{result.note}</div> : null}
					<div className="min-h-0 overflow-y-auto">
						{busy && !result ? <div className="py-4 text-center text-sm text-fg-3">찾는 중…</div> : null}
						{result && !result.hits.length ? <div className="py-4 text-center text-sm text-fg-3">"{q}"에 맞는 메시지가 없어요</div> : null}
						{result?.hits.map((h) => (
							<button
								key={`${h.thread}:${h.entryId}`}
								type="button"
								disabled={!h.thread.startsWith("tui:") && !h.thread.includes(":")}
								onClick={() => {
									useUi.setState({ searchOpen: false });
									closeSubagent();
									void selectThread(h.thread);
								}}
								className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-hover"
							>
								<span className="flex min-w-0 items-center gap-2 text-xs">
									<span className="min-w-0 truncate font-medium text-fg">{threadLabel(h.thread, titles)}</span>
									<span className="shrink-0 text-fg-3">{new Date(h.at).toLocaleString(localeTag(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
									<span className="shrink-0 font-mono text-micro text-fg-3">{h.role}</span>
								</span>
								<span className="line-clamp-2 text-sm text-fg-2">
									<Snippet text={h.snippet} />
								</span>
							</button>
						))}
					</div>
				</div>
			</DialogPopup>
		</Dialog>
	);
}

function ShortcutsDialog() {
	const open = useUi((s) => s.shortcutsOpen);
	return (
		<Dialog open={open} onOpenChange={(o) => useUi.setState({ shortcutsOpen: o })}>
			<DialogPopup heading="단축키" data-testid="shortcuts-dialog">
				<div className="min-h-0 overflow-y-auto px-5 pb-5">
					<ShortcutsList />
				</div>
			</DialogPopup>
		</Dialog>
	);
}

export function Overlays() {
	return (
		<>
			<ThreadSwitcher />
			<AgentsPicker />
			<DagDialog />
			<HelpDialog />
			<SearchDialog />
			<ShortcutsDialog />
		</>
	);
}
