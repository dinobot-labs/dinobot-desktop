/**
 * Sidebar projects: local threads grouped by the working folder they were created with (the daemon's
 * `SessionStatus.cwd`, else the folder this app bound for the thread). The home folder, system folders and threads
 * without a folder share one "일반" group.
 *
 * Display rules (pure; the sidebar only renders the result):
 * - A project shows its newest {@link PROJECT_RECENT} threads; "더 보기" adds {@link PROJECT_STEP} at a time up to
 *   {@link PROJECT_SIDEBAR_MAX}; beyond that the full list opens in the project dialog.
 * - Running, unseen, queued, draft and the open thread are "sticky": always listed, even past the limit or in a collapsed
 *   project, so work in progress never hides behind "더 보기".
 * - Projects are ordered by their newest activity (a running thread counts as now); the first {@link PROJECTS_VISIBLE}
 *   are listed, plus any project holding a sticky thread. "일반" comes after the projects.
 */
import type { ThreadEntry } from "./app.ts";

export const PROJECT_RECENT = 5;
export const GENERAL_RECENT = 10;
export const PROJECT_STEP = 20;
export const PROJECT_SIDEBAR_MAX = 50;
export const PROJECTS_VISIBLE = 10;
export const PROJECT_PAGE = 50;
export const GENERAL_ID = "general";

/** Comparable form of a folder: forward slashes, no trailing slash, case-folded on Windows drive paths. */
export function normalizePath(path: string): string {
	let p = path.trim().replace(/\\/g, "/");
	if (p.length > 1) p = p.replace(/\/+$/, "");
	if (/^[a-z]:$/i.test(p)) p += "/";
	return /^[a-z]:\//i.test(p) || p.startsWith("//") ? p.toLowerCase() : p;
}

/** Folders that say nothing about a project: none, the home folder, a filesystem root, OS folders. */
export function isGeneralCwd(cwd: string | undefined, homeDir?: string): boolean {
	if (!cwd) return true;
	const p = normalizePath(cwd);
	if (homeDir && p === normalizePath(homeDir)) return true;
	if (p === "/" || /^[a-z]:\/$/.test(p)) return true;
	if (/^[a-z]:\/windows(\/|$)/.test(p)) return true;
	return /^\/(usr|bin|sbin|etc|system|private|var|tmp)(\/|$)/.test(p) || p === "/users" || p === "/home";
}

/** The last path segment as written (original case and separators). */
export function baseName(path: string): string {
	const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

function parentName(path: string): string {
	const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts.length > 1 ? parts[parts.length - 2] || "" : "";
}

export interface ProjectGroup {
	id: string;
	/** Display name: folder name, with its parent when two projects share a name; "일반" for the general group. */
	name: string;
	/** The folder as the daemon reported it; null for the general group. */
	path: string | null;
	general: boolean;
	/** Every thread of the project, newest first (sticky ordering of the input is kept). */
	threads: ThreadEntry[];
	/** Rows to render in the sidebar, in list order. */
	visible: ThreadEntry[];
	/** Threads not rendered in the sidebar. */
	hidden: number;
	busy: number;
	unseen: number;
	collapsed: boolean;
	/** "더 보기" can add rows in the sidebar; otherwise hidden threads open in the project dialog. */
	canShowMore: boolean;
	/** Newest activity in the project (epoch ms), Infinity while a thread runs. */
	activity: number;
}

export interface GroupOptions {
	/** Folder of a thread (daemon cwd, else remembered). */
	cwdOf: (thread: ThreadEntry) => string | undefined;
	homeDir?: string;
	unseen?: ReadonlySet<string>;
	activeKey?: string | null;
	collapsed?: ReadonlySet<string>;
	/** Rows chosen with "더 보기", per project id. */
	shown?: Readonly<Record<string, number>>;
	/** Searching: list every match, ignore collapsing and limits. */
	all?: boolean;
}

export interface ProjectLayout {
	projects: ProjectGroup[];
	/** Projects past {@link PROJECTS_VISIBLE} without sticky threads. */
	moreProjects: ProjectGroup[];
	general: ProjectGroup | null;
}

const activityOf = (t: ThreadEntry) => (t.status?.busy ? Number.POSITIVE_INFINITY : t.status?.lastActivityAt ?? t.createdAt ?? 0);

export function isSticky(t: ThreadEntry, unseen: ReadonlySet<string> | undefined, activeKey: string | null | undefined): boolean {
	return Boolean(t.status?.busy) || (t.status?.queued ?? 0) > 0 || Boolean(t.draft) || t.key === activeKey || Boolean(unseen?.has(t.key));
}

/** Project id of a thread: the normalized folder, or {@link GENERAL_ID}. */
export function projectIdOf(cwd: string | undefined, homeDir?: string): string {
	return isGeneralCwd(cwd, homeDir) ? GENERAL_ID : normalizePath(cwd as string);
}

/** Rows of one group under the display rules. */
export function visibleRows(threads: ThreadEntry[], limit: number, collapsed: boolean, sticky: (t: ThreadEntry) => boolean): ThreadEntry[] {
	return threads.filter((t, i) => (!collapsed && i < limit) || sticky(t));
}

/** Group local threads (input already sorted: busy first, newest first) into sidebar projects. */
export function groupProjects(threads: readonly ThreadEntry[], options: GroupOptions): ProjectLayout {
	const { cwdOf, homeDir, unseen, activeKey, collapsed, shown, all = false } = options;
	const buckets = new Map<string, { path: string | null; threads: ThreadEntry[] }>();
	for (const t of threads) {
		const cwd = cwdOf(t);
		const id = projectIdOf(cwd, homeDir);
		let bucket = buckets.get(id);
		if (!bucket) buckets.set(id, (bucket = { path: id === GENERAL_ID ? null : (cwd as string), threads: [] }));
		bucket.threads.push(t);
	}
	const names = new Map<string, number>();
	for (const [id, b] of buckets) if (id !== GENERAL_ID && b.path) names.set(baseName(b.path).toLowerCase(), (names.get(baseName(b.path).toLowerCase()) ?? 0) + 1);
	const sticky = (t: ThreadEntry) => isSticky(t, unseen, activeKey);
	const build = (id: string, b: { path: string | null; threads: ThreadEntry[] }): ProjectGroup => {
		const general = id === GENERAL_ID;
		const base = general ? GENERAL_RECENT : PROJECT_RECENT;
		const limit = all ? Number.POSITIVE_INFINITY : Math.min(Math.max(shown?.[id] ?? base, base), PROJECT_SIDEBAR_MAX);
		const isCollapsed = !all && Boolean(collapsed?.has(id));
		const visible = visibleRows(b.threads, limit, isCollapsed, sticky);
		const name = general || !b.path ? "일반" : (names.get(baseName(b.path).toLowerCase()) ?? 0) > 1 && parentName(b.path) ? `${baseName(b.path)} · ${parentName(b.path)}` : baseName(b.path);
		return {
			id,
			name,
			path: b.path,
			general,
			threads: b.threads,
			visible,
			hidden: b.threads.length - visible.length,
			busy: b.threads.filter((t) => t.status?.busy).length,
			unseen: b.threads.filter((t) => unseen?.has(t.key)).length,
			collapsed: isCollapsed,
			canShowMore: !isCollapsed && limit < PROJECT_SIDEBAR_MAX && b.threads.length > limit,
			activity: b.threads.reduce((max, t) => Math.max(max, activityOf(t)), 0),
		};
	};
	const groups = [...buckets].filter(([id]) => id !== GENERAL_ID).map(([id, b]) => build(id, b));
	groups.sort((a, b) => b.activity - a.activity || a.name.localeCompare(b.name));
	const generalBucket = buckets.get(GENERAL_ID);
	const projects: ProjectGroup[] = [];
	const moreProjects: ProjectGroup[] = [];
	for (const g of groups) {
		if (all || projects.length < PROJECTS_VISIBLE || g.threads.some(sticky)) projects.push(g);
		else moreProjects.push(g);
	}
	return { projects, moreProjects, general: generalBucket ? build(GENERAL_ID, generalBucket) : null };
}

/** Next "더 보기" size for a group. */
export function nextShown(group: ProjectGroup, current: number | undefined): number {
	const base = group.general ? GENERAL_RECENT : PROJECT_RECENT;
	return Math.min(Math.max(current ?? base, base) + PROJECT_STEP, PROJECT_SIDEBAR_MAX);
}
