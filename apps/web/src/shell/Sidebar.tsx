import { Button, cn, ContextMenu, ContextMenuItem, ContextMenuPopup, ContextMenuTrigger, Dialog, DialogPopup, Input, Kbd, StatusMark, type StatusKind, Tooltip } from "@dinobot/ui";
import { IconChevronRight, IconFolder, IconFolderOpen, IconLayoutList, IconMessages, IconPlus, IconSearch, IconSettings, IconTrash } from "@tabler/icons-react";
import { memo, useCallback, useMemo, useState } from "react";
import { relativeTime, useNow } from "../lib/hooks.ts";
import { collapsedProjects, saveCollapsedProjects } from "../lib/settings.ts";
import { deleteThread, newThread, openSettings, selectThread, type ThreadEntry, useApp } from "../state/app.ts";
import { groupProjects, nextShown, PROJECT_PAGE, PROJECT_STEP, type ProjectGroup } from "../state/projects.ts";
import { cleanPreview, threadLabel, withoutSender } from "./thread-label.ts";
import { ReportButton } from "../dialogs/ReportDialog.tsx";

function statusKind(t: ThreadEntry, unseen: boolean): StatusKind {
	const s = t.status;
	if (s?.busy) return s.state === "retrying" ? "retry" : "running";
	if (unseen) return "done";
	if (s && s.queued > 0) return "waiting";
	return "ready";
}

type RowProps = { thread: ThreadEntry; active: boolean; unseen: boolean; titles: Record<string, string>; now: number; onDelete?: (key: string) => void; onSelect?: (key: string) => void };

const ThreadRow = memo(function ThreadRow({ thread, active, unseen, titles, now, onDelete, onSelect }: RowProps) {
	const s = thread.status;
	const at = s?.lastActivityAt ?? thread.createdAt;
	const kind = statusKind(thread, unseen);
	const label = threadLabel(thread.key, titles, s);
	const preview = s?.lastRole === "user" ? withoutSender(cleanPreview(s.lastText)) : cleanPreview(s?.lastText);
	const row = (
		<button
			type="button"
			data-thread={thread.key}
			aria-current={active ? "true" : undefined}
			onClick={() => (onSelect ? onSelect(thread.key) : void selectThread(thread.key))}
			className={cn(
				"group flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
				active ? "bg-pressed" : "hover:bg-hover",
			)}
		>
			<StatusMark kind={kind} size={13} className={cn("mt-[3px]", kind === "ready" && "opacity-40")} />
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-baseline gap-2">
					<span className={cn("min-w-0 flex-1 truncate text-sm", active || unseen ? "font-medium text-fg" : "text-fg")}>{label}</span>
					{at ? <span className="shrink-0 text-micro text-fg-3">{relativeTime(at, now)}</span> : null}
				</span>
				<span className="flex min-w-0 items-center gap-1.5 text-micro text-fg-3">
					{s?.busy && s.runningTools.length ? <span className="truncate font-mono">{s.runningTools.join(", ")}</span> : preview && preview !== label ? <span className="truncate">{preview}</span> : null}
					{s && s.queued > 0 ? <span className="shrink-0 rounded-xs bg-status-waiting-tint px-1 text-status-waiting-fg">대기 {s.queued}</span> : null}
					{s && s.subagents.length > 0 ? <span className="shrink-0 rounded-xs bg-hover px-1">에이전트 {s.subagents.length}</span> : null}
				</span>
			</span>
		</button>
	);
	if (!onDelete) return row;
	// Right-click on a local thread: a menu with "delete" (confirmed in a dialog by the sidebar).
	return (
		<ContextMenu>
			<ContextMenuTrigger>{row}</ContextMenuTrigger>
			<ContextMenuPopup>
				<ContextMenuItem tone="danger" data-testid="thread-delete" onClick={() => onDelete(thread.key)}>
					<IconTrash /> 스레드 삭제
				</ContextMenuItem>
			</ContextMenuPopup>
		</ContextMenu>
	);
});

/** Confirmation before a thread is deleted on the daemon; deleting cannot be undone from the app. */
function DeleteDialog({ thread, label, onClose }: { thread: string | null; label: string; onClose: () => void }) {
	const [pending, setPending] = useState(false);
	const confirm = async () => {
		if (!thread) return;
		setPending(true);
		await deleteThread(thread);
		setPending(false);
		onClose();
	};
	return (
		<Dialog open={thread !== null} onOpenChange={(open) => !open && !pending && onClose()}>
			<DialogPopup heading="스레드를 삭제할까요?" description="목록과 검색에서 사라지고, 앱에서 되돌릴 수 없어요." className="w-[min(92vw,420px)]" data-testid="thread-delete-dialog">
				<div className="px-5 pb-1 text-sm text-fg truncate">{label}</div>
				<div className="flex justify-end gap-2 px-5 pt-3 pb-4">
					<Button variant="ghost" onClick={onClose} disabled={pending}>취소</Button>
					<Button variant="danger" onClick={() => void confirm()} disabled={pending} data-testid="thread-delete-confirm" autoFocus>
						삭제
					</Button>
				</div>
			</DialogPopup>
		</Dialog>
	);
}

const sectionLabel = "px-2 pt-3 pb-1 font-mono text-micro uppercase tracking-[var(--tr-label)] text-fg-3";
const moreButton = "w-full cursor-pointer rounded-md px-2 py-1 text-left text-xs text-fg-3 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

type RowContext = { activeKey: string | null; unseen: readonly string[]; titles: Record<string, string>; now: number; onDelete: (key: string) => void };

function rowFor(t: ThreadEntry, ctx: RowContext, onSelect?: (key: string) => void) {
	return <ThreadRow key={t.key} thread={t} active={t.key === ctx.activeKey} unseen={ctx.unseen.includes(t.key)} titles={ctx.titles} now={ctx.now} {...(t.channel === "tui" ? { onDelete: ctx.onDelete } : {})} {...(onSelect ? { onSelect } : {})} />;
}

/** One project (or "일반"): a folding header with the folder, a running mark and the count, then its rows. */
function ProjectSection({ group, ctx, onToggle, onMore, onOpenAll }: { group: ProjectGroup; ctx: RowContext; onToggle: (id: string) => void; onMore: (group: ProjectGroup) => void; onOpenAll: (id: string) => void }) {
	const FolderIcon = group.general ? IconMessages : group.collapsed ? IconFolder : IconFolderOpen;
	const create = () => newThread(undefined, group.path ?? undefined);
	const name = (
		<span className="min-w-0 truncate text-xs font-medium text-fg-2 group-hover/project:text-fg" data-testid="project-name">
			{group.name}
		</span>
	);
	return (
		<section data-project={group.id} aria-label={group.name} className="mt-1 first:mt-0">
			<ContextMenu>
				<ContextMenuTrigger>
					<div className="group/project flex items-center gap-0.5 rounded-md pr-0.5 hover:bg-hover">
						<button
							type="button"
							aria-expanded={!group.collapsed}
							data-testid="project-toggle"
							onClick={() => onToggle(group.id)}
							className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md pl-1.5 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
						>
							<IconChevronRight size={12} className={cn("shrink-0 text-fg-3 transition-transform duration-(--dur-state)", !group.collapsed && "rotate-90")} />
							<FolderIcon size={14} className="shrink-0 text-fg-3" />
							{group.path ? <Tooltip content={<span className="font-mono">{group.path}</span>} side="right">{name}</Tooltip> : name}
							{group.busy > 0 ? <StatusMark kind="running" size={11} className="shrink-0" title={`진행 중 ${group.busy}`} /> : null}
							<span className="ml-auto shrink-0 pr-1 font-mono text-micro text-fg-3 tabular-nums" data-testid="project-count">
								{group.threads.length}
							</span>
						</button>
						<Tooltip content={group.general ? "새 스레드" : "이 폴더에서 새 스레드"}>
							<Button variant="ghost" size="icon-xs" aria-label={`${group.name}에서 새 스레드`} data-testid="project-new" className="opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100" onClick={create}>
								<IconPlus />
							</Button>
						</Tooltip>
					</div>
				</ContextMenuTrigger>
				<ContextMenuPopup>
					<ContextMenuItem onClick={create}>
						<IconPlus /> {group.general ? "새 스레드" : "이 폴더에서 새 스레드"}
					</ContextMenuItem>
					<ContextMenuItem onClick={() => onOpenAll(group.id)}>
						<IconLayoutList /> 스레드 모두 보기
					</ContextMenuItem>
				</ContextMenuPopup>
			</ContextMenu>
			{group.visible.length ? <div className="ml-[13px] border-l border-line pl-1">{group.visible.map((t) => rowFor(t, ctx))}</div> : null}
			{!group.collapsed && group.hidden > 0 ? (
				<div className="ml-[13px] pl-1">
					{group.canShowMore ? (
						<button type="button" className={moreButton} data-testid="project-more" onClick={() => onMore(group)}>
							{Math.min(group.hidden, PROJECT_STEP)}개 더 보기
						</button>
					) : (
						<button type="button" className={moreButton} data-testid="project-all" onClick={() => onOpenAll(group.id)}>
							모두 보기 · {group.threads.length}개
						</button>
					)}
				</div>
			) : null}
		</section>
	);
}

/** Every thread of one project, filtered and loaded {@link PROJECT_PAGE} at a time. */
function ProjectDialog({ group, ctx, onClose }: { group: ProjectGroup | undefined; ctx: RowContext; onClose: () => void }) {
	const [filter, setFilter] = useState("");
	const [pages, setPages] = useState(1);
	const matches = useMemo(() => {
		if (!group) return [];
		const q = filter.trim().toLowerCase();
		if (!q) return group.threads;
		return group.threads.filter((t) => threadLabel(t.key, ctx.titles, t.status).toLowerCase().includes(q) || (t.status?.lastText ?? "").toLowerCase().includes(q));
	}, [group, filter, ctx.titles]);
	const shown = matches.slice(0, pages * PROJECT_PAGE);
	const close = () => {
		setFilter("");
		setPages(1);
		onClose();
	};
	const select = (key: string) => {
		void selectThread(key);
		close();
	};
	return (
		<Dialog open={group !== undefined} onOpenChange={(open) => !open && close()}>
			<DialogPopup
				heading={group?.name ?? ""}
				description={group?.path ? <span className="font-mono text-xs">{group.path}</span> : "작업 폴더를 정하지 않은 스레드"}
				className="w-[min(92vw,520px)]"
				data-testid="project-dialog"
			>
				<div className="flex items-center gap-2 px-5 pb-2">
					<div className="relative min-w-0 flex-1">
						<IconSearch size={14} className="pointer-events-none absolute top-2 left-2.5 text-fg-3" />
						<Input value={filter} onChange={(e) => (setFilter(e.target.value), setPages(1))} placeholder="이 프로젝트에서 검색" aria-label="프로젝트 스레드 검색" className="h-7 pl-8 text-xs" />
					</div>
					<Button variant="secondary" size="xs" onClick={() => (newThread(undefined, group?.path ?? undefined), close())}>
						<IconPlus /> 새 스레드
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2" data-testid="project-dialog-list">
					{shown.length ? shown.map((t) => rowFor(t, ctx, select)) : <div className="px-2 py-3 text-xs text-fg-3">{filter ? "찾는 스레드가 없어요" : "스레드가 없어요"}</div>}
				</div>
				<div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-2.5 text-micro text-fg-3">
					<span className="font-mono tabular-nums" data-testid="project-dialog-count">
						{shown.length} / {matches.length}
					</span>
					{shown.length < matches.length ? (
						<Button variant="ghost" size="xs" className="ml-auto" data-testid="project-dialog-more" onClick={() => setPages((p) => p + 1)}>
							{Math.min(PROJECT_PAGE, matches.length - shown.length)}개 더 불러오기
						</Button>
					) : null}
				</div>
			</DialogPopup>
		</Dialog>
	);
}

export function Sidebar() {
	const threads = useApp((s) => s.threads);
	const activeKey = useApp((s) => s.activeKey);
	const titles = useApp((s) => s.titles);
	const cwds = useApp((s) => s.cwds);
	const unseen = useApp((s) => s.unseen);
	const daemon = useApp((s) => s.daemon);
	const homeDir = useApp((s) => s.config?.homeDir);
	const [query, setQuery] = useState("");
	const [collapsed, setCollapsed] = useState(() => new Set(collapsedProjects()));
	const [shown, setShown] = useState<Record<string, number>>({});
	const [allProjects, setAllProjects] = useState(false);
	const [showAllOther, setShowAllOther] = useState(false);
	const [dialog, setDialog] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const now = useNow(true, 30_000);
	const layout = useMemo(() => {
		const q = query.trim().toLowerCase();
		const match = (t: ThreadEntry) => !q || threadLabel(t.key, titles, t.status).toLowerCase().includes(q) || t.key.toLowerCase().includes(q) || (t.status?.lastText ?? "").toLowerCase().includes(q);
		const local = threads.filter((t) => t.channel === "tui" && match(t));
		const other = threads.filter((t) => t.channel !== "tui" && match(t));
		const grouped = groupProjects(local, {
			cwdOf: (t) => t.status?.cwd ?? cwds[t.key] ?? t.cwd,
			...(homeDir ? { homeDir } : {}),
			unseen: new Set(unseen),
			activeKey,
			collapsed,
			shown,
			all: Boolean(q),
		});
		return { ...grouped, other, empty: local.length === 0 };
	}, [threads, titles, cwds, homeDir, unseen, activeKey, collapsed, shown, query]);
	const toggle = useCallback((id: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (!next.delete(id)) next.add(id);
			saveCollapsedProjects([...next]);
			return next;
		});
	}, []);
	const more = useCallback((group: ProjectGroup) => setShown((prev) => ({ ...prev, [group.id]: nextShown(group, prev[group.id]) })), []);
	const ctx: RowContext = { activeKey, unseen, titles, now, onDelete: setDeleting };
	const projects = allProjects || query ? [...layout.projects, ...layout.moreProjects] : layout.projects;
	const every = [...layout.projects, ...layout.moreProjects, ...(layout.general ? [layout.general] : [])];
	const dialogGroup = dialog ? every.find((g) => g.id === dialog) : undefined;
	const deletingEntry = deleting ? threads.find((t) => t.key === deleting) : undefined;
	const section = (g: ProjectGroup) => <ProjectSection key={g.id} group={g} ctx={ctx} onToggle={toggle} onMore={more} onOpenAll={setDialog} />;
	return (
		<aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-band" aria-label="스레드">
			<div className="flex flex-col gap-2 p-2.5">
				<Button variant="primary" className="w-full justify-start" onClick={() => newThread()}>
					<IconPlus /> 새 스레드 <Kbd className="ml-auto border-transparent bg-white/15 text-fg-inverse dark:bg-black/10">Ctrl N</Kbd>
				</Button>
				<div className="relative">
					<IconSearch size={14} className="pointer-events-none absolute top-2 left-2.5 text-fg-3" />
					<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="스레드 검색" aria-label="스레드 검색" className="h-7 pl-8 text-xs" />
				</div>
			</div>
			<nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
				{projects.length ? (
					<>
						<div className={cn(sectionLabel, "pt-1")}>프로젝트</div>
						{projects.map(section)}
						{!allProjects && !query && layout.moreProjects.length ? (
							<button type="button" className={cn(moreButton, "mt-1")} data-testid="projects-more" onClick={() => setAllProjects(true)}>
								프로젝트 {layout.moreProjects.length}개 더 보기
							</button>
						) : null}
					</>
				) : null}
				{layout.general ? (
					<>
						{projects.length ? <div className="h-2" /> : null}
						{section(layout.general)}
					</>
				) : null}
				{layout.empty ? <div className="px-2 py-2 text-xs text-fg-3">{query ? "찾는 스레드가 없어요" : "아직 스레드가 없어요"}</div> : null}
				{layout.other.length ? (
					<>
						<div className={sectionLabel}>다른 채널 (읽기 전용)</div>
						{layout.other.slice(0, showAllOther || query ? undefined : 10).map((t) => rowFor(t, ctx))}
						{!showAllOther && !query && layout.other.length > 10 ? (
							<button type="button" className={moreButton} onClick={() => setShowAllOther(true)}>
								{layout.other.length - 10}개 더 보기
							</button>
						) : null}
					</>
				) : null}
			</nav>
			<div className="flex items-center gap-2 border-t border-line px-2.5 py-2">
				<span className="size-1.5 rounded-full bg-status-success" />
				<span className="min-w-0 flex-1 truncate font-mono text-micro text-fg-3">daemon {daemon?.version ?? ""}</span>
				<ReportButton size="icon-sm" label={false} />
				<Tooltip content="설정 (Ctrl ,)">
					<Button variant="ghost" size="icon-sm" aria-label="설정" onClick={() => openSettings()}>
						<IconSettings />
					</Button>
				</Tooltip>
			</div>
			<ProjectDialog group={dialogGroup} ctx={ctx} onClose={() => setDialog(null)} />
			<DeleteDialog thread={deleting} label={deletingEntry ? threadLabel(deletingEntry.key, titles, deletingEntry.status) : (deleting ?? "")} onClose={() => setDeleting(null)} />
		</aside>
	);
}
