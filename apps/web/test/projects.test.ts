import { describe, expect, test } from "bun:test";
import type { SessionStatus } from "@dinobot/contracts";
import type { ThreadEntry } from "../src/state/app.ts";
import {
	GENERAL_ID,
	GENERAL_RECENT,
	groupProjects,
	isGeneralCwd,
	nextShown,
	normalizePath,
	PROJECT_RECENT,
	PROJECT_SIDEBAR_MAX,
	PROJECT_STEP,
	PROJECTS_VISIBLE,
	projectIdOf,
} from "../src/state/projects.ts";

const HOME = "C:\\Users\\dev";
let clock = 1_000_000;

function status(key: string, extra: Partial<SessionStatus> = {}): SessionStatus {
	return { thread: key, conversationId: 1, busy: false, state: "idle", runningTools: [], queued: 0, subagents: [], claims: [], lastActivityAt: clock--, ...extra };
}
/** Threads newest first, like sortThreads (activity strictly decreasing in creation order). */
function threads(cwd: string | undefined, n: number, prefix: string, extra: (i: number) => Partial<SessionStatus> = () => ({})): ThreadEntry[] {
	return Array.from({ length: n }, (_, i) => {
		const key = `tui:${prefix}-${i}`;
		return { key, channel: "tui", status: status(key, { ...(cwd ? { cwd } : {}), ...extra(i) }) };
	});
}
const cwdOf = (t: ThreadEntry) => t.status?.cwd ?? t.cwd;
const keys = (list: ThreadEntry[]) => list.map((t) => t.key);

describe("project folders", () => {
	test("paths compare case-insensitively on Windows drives and ignore separators and trailing slashes", () => {
		expect(normalizePath("C:\\Users\\Dev\\Repo\\")).toBe("c:/users/dev/repo");
		expect(normalizePath("c:/users/dev/repo")).toBe("c:/users/dev/repo");
		expect(normalizePath("/home/dev/Repo/")).toBe("/home/dev/Repo");
		expect(normalizePath("C:\\")).toBe("c:/");
		expect(projectIdOf("C:\\Users\\dev\\dinobot", HOME)).toBe(projectIdOf("c:/users/DEV/dinobot/", HOME));
	});

	test("home, roots, OS folders and missing folders fall into the general group", () => {
		for (const cwd of [undefined, "", HOME, "c:/users/dev/", "C:\\", "/", "C:\\Windows\\System32", "C:\\WINDOWS\\system32", "/usr/local", "/tmp"]) expect(isGeneralCwd(cwd, HOME)).toBe(true);
		for (const cwd of ["C:\\Users\\dev\\dinobot", "/home/dev/repo", "D:\\work"]) expect(isGeneralCwd(cwd, HOME)).toBe(false);
	});
});

describe("grouping", () => {
	test("threads group by folder; projects order by newest activity; general comes separately", () => {
		const a = threads("C:\\Users\\dev\\alpha", 3, "a");
		const g = threads(HOME, 2, "g");
		const b = threads("C:\\Users\\dev\\beta", 2, "b");
		const layout = groupProjects([...a, ...g, ...b], { cwdOf, homeDir: HOME });
		expect(layout.projects.map((p) => p.name)).toEqual(["alpha", "beta"]);
		expect(layout.projects[0]?.path).toBe("C:\\Users\\dev\\alpha");
		expect(layout.general?.id).toBe(GENERAL_ID);
		expect(keys(layout.general?.threads ?? [])).toEqual(keys(g));
	});

	test("a project shows its newest five; '더 보기' adds twenty up to fifty, then the dialog takes over", () => {
		const list = threads("C:\\Users\\dev\\big", 80, "big");
		const id = projectIdOf("C:\\Users\\dev\\big");
		const first = groupProjects(list, { cwdOf, homeDir: HOME }).projects[0]!;
		expect(keys(first.visible)).toEqual(keys(list.slice(0, PROJECT_RECENT)));
		expect(first.hidden).toBe(80 - PROJECT_RECENT);
		expect(first.canShowMore).toBe(true);
		const step1 = nextShown(first, undefined);
		expect(step1).toBe(PROJECT_RECENT + PROJECT_STEP);
		const second = groupProjects(list, { cwdOf, homeDir: HOME, shown: { [id]: step1 } }).projects[0]!;
		expect(second.visible).toHaveLength(25);
		const step2 = nextShown(second, step1);
		const step3 = nextShown(second, step2);
		expect([step2, step3]).toEqual([45, PROJECT_SIDEBAR_MAX]);
		const last = groupProjects(list, { cwdOf, homeDir: HOME, shown: { [id]: step3 } }).projects[0]!;
		expect(last.visible).toHaveLength(PROJECT_SIDEBAR_MAX);
		expect(last.canShowMore).toBe(false);
		expect(last.hidden).toBe(30);
		// A forged larger value never renders more than the cap.
		expect(groupProjects(list, { cwdOf, shown: { [id]: 999 } }).projects[0]!.visible).toHaveLength(PROJECT_SIDEBAR_MAX);
	});

	test("the general group shows ten by default", () => {
		const general = groupProjects(threads(undefined, 30, "g"), { cwdOf }).general!;
		expect(general.visible).toHaveLength(GENERAL_RECENT);
	});

	test("running, unseen, queued, draft and open threads stay listed past the limit and in a folded project", () => {
		const list = threads("/repo/x", 40, "x", (i) => (i === 30 ? { busy: true, state: "running_tools" } : i === 31 ? { queued: 2 } : {}));
		list.push({ key: "tui:x-draft", channel: "tui", draft: true, cwd: "/repo/x" });
		const id = projectIdOf("/repo/x");
		const opts = { cwdOf, unseen: new Set(["tui:x-35"]), activeKey: "tui:x-38" };
		const open = groupProjects(list, opts).projects[0]!;
		expect(keys(open.visible)).toEqual([...keys(list.slice(0, 5)), "tui:x-30", "tui:x-31", "tui:x-35", "tui:x-38", "tui:x-draft"]);
		expect(open.busy).toBe(1);
		expect(open.unseen).toBe(1);
		const folded = groupProjects(list, { ...opts, collapsed: new Set([id]) }).projects[0]!;
		expect(folded.collapsed).toBe(true);
		expect(keys(folded.visible)).toEqual(["tui:x-30", "tui:x-31", "tui:x-35", "tui:x-38", "tui:x-draft"]);
		expect(folded.canShowMore).toBe(false);
	});

	test("ten projects are listed; later ones move to 'more' unless they hold a sticky thread", () => {
		const list: ThreadEntry[] = [];
		for (let p = 0; p < 13; p++) list.push(...threads(`/repo/p${p}`, 1, `p${p}`, () => (p === 12 ? { busy: true, state: "generating", lastActivityAt: 0 } : { lastActivityAt: 1000 - p })));
		const layout = groupProjects(list, { cwdOf, unseen: new Set(["tui:p11-0"]) });
		// Running counts as now, so p12 leads; p11 is old but unseen, so it stays listed past the ten.
		expect(layout.projects.map((p) => p.name)).toEqual(["p12", "p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p11"]);
		expect(layout.projects).toHaveLength(PROJECTS_VISIBLE + 1);
		expect(layout.moreProjects.map((p) => p.name)).toEqual(["p9", "p10"]);
	});

	test("searching lists every match and ignores folding and limits", () => {
		const list = threads("/repo/s", 60, "s");
		const layout = groupProjects(list, { cwdOf, collapsed: new Set([projectIdOf("/repo/s")]), all: true });
		expect(layout.projects[0]?.visible).toHaveLength(60);
		expect(layout.projects[0]?.collapsed).toBe(false);
	});

	test("two projects with the same folder name are told apart by their parent", () => {
		const layout = groupProjects([...threads("/work/a/app", 1, "a"), ...threads("/work/b/app", 1, "b"), ...threads("/work/c/tool", 1, "c")], { cwdOf });
		expect(layout.projects.map((p) => p.name).sort()).toEqual(["app · a", "app · b", "tool"]);
	});

	test("the app's remembered folder places a thread when the daemon reports none", () => {
		const t: ThreadEntry = { key: "tui:old-1", channel: "tui", status: status("tui:old-1") };
		const remembered: Record<string, string> = { "tui:old-1": "/repo/remembered" };
		const layout = groupProjects([t], { cwdOf: (x) => x.status?.cwd ?? remembered[x.key] });
		expect(layout.projects[0]?.name).toBe("remembered");
		expect(layout.general).toBeNull();
	});
});
