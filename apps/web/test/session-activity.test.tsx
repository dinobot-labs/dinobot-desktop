import { afterEach, expect, test } from "bun:test";
import type { SessionStatus } from "@dinobot/contracts";
import { TooltipProvider } from "@dinobot/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "../src/shell/Sidebar.tsx";
import { applySessions, sortThreads, useApp, type ThreadEntry } from "../src/state/app.ts";
import { groupProjects } from "../src/state/projects.ts";
import { hasActiveWork } from "../src/state/thread-activity.ts";

const initial = { ...useApp.getInitialState() };
afterEach(() => {
 applySessions({ type: "sessions", at: 0, sessions: [], claims: [] });
 Object.assign(useApp.getInitialState(), initial);
 useApp.setState(initial, true);
});
test("initial and subsequent session events keep activity until the last child leaves", () => {
 const parent = entry(status());
 const newer = entry(status({ thread: "tui:new", lastActivityAt: 100 }));
 useApp.setState({ threads: [newer, parent], unseen: [], activeKey: null });
 const snapshot = (subagents: SessionStatus["subagents"], busy = false) => {
  const s = status({ subagents, busy, state: busy ? "generating" : "idle" });
  applySessions({ type: "sessions", at: 1, sessions: [s, newer.status!], claims: [] });
  return useApp.getState().threads.find(t => t.key === parent.key)!.status!;
 };
 let s = snapshot([child, { ...child, taskId: "sa-other" }]);
 expect(useApp.getState().threads[0]!.key).toBe(parent.key);
 expect(hasActiveWork(s)).toBe(true);
 expect(s.busy).toBe(false);
 s = snapshot([child]);
 expect(hasActiveWork(s)).toBe(true);
 expect(markup(s).match(/data-status="running"/g)).toHaveLength(2);
 // Completed, failed and cancelled children all leave the running-only wire list.
 for (const terminal of ["completed", "failed", "cancelled"]) {
  snapshot([child]);
  s = snapshot([]);
  expect(hasActiveWork(s), terminal).toBe(false);
  expect(useApp.getState().threads[0]!.key).toBe(newer.key);
  expect(markup(s)).not.toContain('data-status="running"');
 }
 expect(hasActiveWork(snapshot([], true))).toBe(true);
 applySessions({ type: "sessions", at: 2, sessions: [], claims: [] });
 expect(useApp.getState().threads.every(t => !hasActiveWork(t.status))).toBe(true);
 expect(hasActiveWork(undefined)).toBe(false);
});

const child = { taskId: "sa-live", description: "work", subagentType: "general", startedAt: 1 };
function status(extra: Partial<SessionStatus> = {}): SessionStatus {
 return { thread: "tui:activity", conversationId: 1, busy: false, state: "idle", runningTools: [], queued: 0, subagents: [], claims: [], cwd: "/repo/activity", lastActivityAt: 1, ...extra };
}
function entry(s: SessionStatus): ThreadEntry { return { key: s.thread, channel: "tui", status: s }; }
function markup(s: SessionStatus, unseen = false) {
 Object.assign(useApp.getInitialState(), { threads: [entry(s)], unseen: unseen ? [s.thread] : [], activeKey: null });
 return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(Sidebar)));
}
test("idle parent with running children renders running row and project without changing busy", () => {
 const s = status({ subagents: [child] });
 expect(markup(s).match(/data-status="running"/g)).toHaveLength(2);
 expect(s.busy).toBe(false);
 expect(s.state).toBe("idle");
});
test("background activity sorts first and remains visible in collapsed project", () => {
 const parent = entry(status({ subagents: [child] }));
 const newer = entry(status({ thread: "tui:new", lastActivityAt: 100 }));
 expect(sortThreads([newer, parent])[0]).toBe(parent);
 const group = groupProjects([newer, parent], { cwdOf: t => t.status?.cwd, collapsed: new Set(["/repo/activity"]) }).projects[0]!;
 expect(group.visible).toEqual([parent]);
 expect(group.busy).toBe(1);
 expect(group.activity).toBe(Infinity);
});
test("foreground retry wins, background wins over unseen and queue, empty snapshot restores priorities", () => {
 expect(markup(status({ busy: true, state: "retrying", subagents: [child] }))).toContain('data-status="retry"');
 expect(markup(status({ queued: 1, subagents: [child] }), true).match(/data-status="running"/g)).toHaveLength(2);
 expect(markup(status(), true)).toContain('data-status="done"');
 expect(markup(status({ queued: 1 }))).toContain('data-status="waiting"');
 expect(markup(status())).toContain('data-status="ready"');
});
