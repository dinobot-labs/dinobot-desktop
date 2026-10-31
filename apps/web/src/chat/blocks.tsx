import { localeTag } from "@dinobot/ui/i18n";
import { Badge, cn, Dialog, DialogPopup, DinoMark, Shimmer, STATUS, StatusMark, type StatusKind, statusTextClass, ToolCall } from "@dinobot/ui";
import { IconBrain, IconCheck, IconChevronRight, IconCode, IconCopy, IconFile, IconPencil, IconRobot, IconSearch, IconTerminal2, IconTool, IconWorld } from "@tabler/icons-react";
import { memo, type ReactNode, useId, useState } from "react";
import { openSettings, openSubagent } from "../state/app.ts";
import { formatElapsed } from "../lib/hooks.ts";
import { Markdown } from "./Markdown.tsx";
import type { AgentBlock, NudgeBlock, NoticeBlock, SubagentBlock, ThinkingBlock, ToolBlock, UserBlock } from "./model.ts";
import type { BlockView } from "./protocol.ts";
import { useChatSession } from "./Transcript.tsx";
import { codemodeCalls, formatDuration, toolSummary } from "./tool-summary.ts";

const FOLD_LINES = 8;

export const UserRow = memo(function UserRow({ block }: { block: UserBlock; version: number }) {
	const [open, setOpen] = useState(false);
	const [zoom, setZoom] = useState<string | null>(null);
	// An answer to a question reads as one (the daemon rewrites choice buttons to this text).
	const answer = /^\[ask [0-9a-f]{32}\] (choice|answer)(?: #\d+)?: ([\s\S]*)$/.exec(block.text);
	const lines = block.text.split("\n");
	const long = lines.length > FOLD_LINES || block.text.length > 900;
	if (answer) {
		return (
			<div className="flex flex-col items-end gap-1" data-role="user">
				<div className="flex max-w-[80%] items-center gap-2 rounded-lg rounded-br-sm border border-status-waiting/40 bg-status-waiting-tint px-3.5 py-2 text-sm text-fg">
					<span className="text-micro text-status-waiting-fg">질문에 답함</span>
					<span className="selectable">{answer[2]}</span>
				</div>
			</div>
		);
	}
	return (
		<div className="flex flex-col items-end gap-1" data-role="user">
			{block.images?.length ? (
				<div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
					{block.images.map((img, i) => {
						const src = `data:${img.mimeType};base64,${img.data}`;
						return (
							<button key={i} type="button" onClick={() => setZoom(src)} className="cursor-zoom-in" aria-label="이미지 크게 보기">
								<img src={src} alt="" className="max-h-40 rounded-md border border-line" />
							</button>
						);
					})}
				</div>
			) : null}
			{block.text ? (
				<div className="selectable max-w-[80%] rounded-lg rounded-br-sm bg-hover px-3.5 py-2.5 text-md leading-[var(--lh-chat)] whitespace-pre-wrap break-words text-fg">
					{long && !open ? `${lines.slice(0, FOLD_LINES).join("\n").slice(0, 900)}…` : block.text}
					{long ? (
						<button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 block cursor-pointer text-xs text-accent-deep hover:underline">
							{open ? "접기" : `더 보기 (${lines.length}줄)`}
						</button>
					) : null}
				</div>
			) : null}
			<span className="px-1 text-micro text-fg-3">{block.at ? new Date(block.at).toLocaleTimeString(localeTag(), { hour: "numeric", minute: "2-digit" }) : ""}</span>
			<Dialog open={zoom !== null} onOpenChange={(o) => !o && setZoom(null)}>
				<DialogPopup className="w-auto max-w-[92vw] p-2" showClose={false}>
					{zoom ? <img src={zoom} alt="" className="max-h-[84vh] max-w-full rounded-md" /> : null}
				</DialogPopup>
			</Dialog>
		</div>
	);
});

export const AgentRow = memo(function AgentRow({ block }: { block: AgentBlock; version: number }) {
	const [copied, setCopied] = useState(false);
	if (!block.text.trim()) return null;
	return (
		<div className="group/msg relative">
			<Markdown text={block.text} />
			{!block.streaming ? (
				<button
					type="button"
					aria-label="답 복사"
					onClick={() =>
						void navigator.clipboard.writeText(block.text).then(() => {
							setCopied(true);
							setTimeout(() => setCopied(false), 1200);
						})
					}
					// Keep the action in the measured row so the next virtual row cannot cover its hit area.
					className="flex h-5 cursor-pointer items-center gap-1 rounded-xs px-1 text-micro text-fg-3 opacity-0 transition-opacity group-hover/msg:opacity-100 hover:text-fg focus-visible:opacity-100"
				>
					{copied ? <IconCheck size={12} /> : <IconCopy size={12} />} {copied ? "복사됨" : "복사"}
				</button>
			) : null}
		</div>
	);
});

export const ThinkingRow = memo(function ThinkingRow({ block, earlier = [], expanded = false }: { block: ThinkingBlock; version: number; earlier?: string[]; expanded?: boolean }) {
	const [open, setOpen] = useState(expanded);
	// Blocks replayed from a snapshot start and end at the same instant: no measured duration.
	const ms = block.endedAt ? block.endedAt - block.startedAt : 0;
	const seconds = ms >= 1000 ? Math.round(ms / 1000) : undefined;
	if (!block.text.trim() && !block.streaming && earlier.length === 0) return null;
	const count = earlier.length + 1;
	const text = [...earlier, block.text].filter((t) => t.trim()).join("\n\n");
	return (
		<div className="text-sm">
			<button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex cursor-pointer items-center gap-1.5 rounded-sm py-0.5 text-fg-3 hover:text-fg-2">
				<IconBrain size={14} />
				{block.streaming ? <Shimmer>생각하는 중</Shimmer> : <span>{seconds ? `${seconds}초 동안 생각함` : "생각"}{count > 1 ? ` · ${count}번` : ""}</span>}
				<IconChevronRight size={13} className={cn("transition-transform duration-(--dur-state)", open && "rotate-90")} />
			</button>
			{open || block.streaming ? (
				<div className={cn("selectable mt-1 border-l-2 border-line pl-3 text-sm leading-relaxed whitespace-pre-wrap text-fg-3", block.streaming && !open && "line-clamp-3")}>{block.streaming && !open ? block.text : text}</div>
			) : null}
		</div>
	);
});

function toolIcon(name: string): ReactNode {
	if (name === "bash" || name === "shell") return <IconTerminal2 />;
	if (name === "read") return <IconFile />;
	if (name === "write" || name === "edit") return <IconPencil />;
	if (name === "codemode") return <IconCode />;
	if (name.includes("search") || name === "grep" || name === "glob") return <IconSearch />;
	if (name.includes("web") || name.includes("browser") || name.includes("fetch")) return <IconWorld />;
	return <IconTool />;
}

const TOOL_STATUS: Record<ToolBlock["status"], StatusKind> = { pending: "pending", running: "running", done: "done", error: "failed", cancelled: "skipped" };
const CALL_STATUS: Record<string, StatusKind> = { pending: "pending", running: "running", done: "done", failed: "failed", aborted: "skipped" };
const MAX_RESULT = 6000;

function ResultText({ text, blockId, fullLength }: { text: string; blockId: string; fullLength?: number }) {
	const session = useChatSession();
	const [full, setFull] = useState<string | null>(null);
	const [all, setAll] = useState(false);
	const shown = full ?? text;
	const length = fullLength ?? text.length;
	const long = length > MAX_RESULT;
	return (
		<>
			<div className="selectable">{all || !long ? shown : `${shown.slice(0, MAX_RESULT)}…`}</div>
			{long ? (
				<button
					type="button"
					onClick={() => {
						if (!all && fullLength && full === null && session) void session.full(blockId).then(setFull);
						setAll((v) => !v);
					}}
					className="mt-1.5 cursor-pointer font-sans text-xs text-accent-deep hover:underline"
				>
					{all ? "접기" : `전체 보기 (${length.toLocaleString()}자)`}
				</button>
			) : null}
		</>
	);
}

const EXECUTE = new Set(["bash", "shell", "exec", "run", "powershell", "cmd"]);
const READ = new Set(["read", "read_file", "view"]);

/** Per-kind expanded body (TUI T123): `$ command` + output for execute tools, numbered lines for reads. */
function KindBody({ block, body }: { block: ToolBlock & Pick<BlockView, "cut">; body: string }) {
	if (EXECUTE.has(block.name) && typeof block.args.command === "string") {
		return (
			<>
				<div className="selectable text-fg">
					<span className="text-fg-3">$ </span>
					{block.args.command}
				</div>
				{body.trim() ? <ResultText text={body} blockId={block.id} {...(block.cut ? { fullLength: block.cut.length } : {})} /> : null}
			</>
		);
	}
	if (READ.has(block.name) && !block.status.startsWith("err") && body.trim()) {
		const lines = body.split("\n");
		const start = typeof block.args.offset === "number" ? block.args.offset : 1;
		const width = String(start + lines.length).length;
		return (
			<div className="selectable">
				{lines.slice(0, 60).map((l, i) => (
					<div key={i} className="flex gap-3">
						<span className="shrink-0 text-right text-fg-3 select-none" style={{ width: `${width}ch` }}>
							{start + i}
						</span>
						<span className="min-w-0">{l || " "}</span>
					</div>
				))}
				{lines.length > 60 ? <div className="pt-1 font-sans text-xs text-fg-3">… {lines.length - 60}줄 더</div> : null}
			</div>
		);
	}
	return <ResultText text={body} blockId={block.id} {...(block.cut ? { fullLength: block.cut.length } : {})} />;
}

export const ToolRow = memo(function ToolRow({ block, now, expanded = false }: { block: ToolBlock & Pick<BlockView, "cut">; version: number; now: number; expanded?: boolean }) {
	const calls = codemodeCalls(block);
	const end = block.endedAt ?? (block.status === "running" ? now : undefined);
	const duration = block.startedAt && end ? formatDuration(end - block.startedAt) : undefined;
	const body = block.status === "running" ? block.output : (block.result ?? block.output);
	const code = block.name === "codemode" && typeof block.args.code === "string" ? block.args.code : undefined;
	const hasBody = Boolean(calls.length || body?.trim() || code);
	return (
		<ToolCall key={String(expanded)} defaultOpen={expanded} name={block.name} icon={toolIcon(block.name)} summary={toolSummary(block)} status={TOOL_STATUS[block.status]} {...(duration ? { duration } : {})}>
			{hasBody ? (
				<div className="flex flex-col gap-2">
					{calls.length ? (
						<div className="flex flex-col gap-0.5 font-sans">
							{calls.map((c) => (
								<div key={c.id} className="flex min-w-0 items-center gap-2 text-xs">
									<StatusMark kind={CALL_STATUS[c.status] ?? "pending"} size={12} />
									<span className="shrink-0 font-mono text-fg">{c.name}</span>
									<span className="min-w-0 flex-1 truncate font-mono text-fg-3">{c.preview ?? c.detail ?? ""}</span>
									{c.error ? <span className="max-w-[40%] shrink-0 truncate text-status-failed-fg">{c.error}</span> : null}
									{c.startedAt && c.endedAt ? <span className="shrink-0 font-mono text-micro text-fg-3">{formatDuration(c.endedAt - c.startedAt)}</span> : null}
								</div>
							))}
						</div>
					) : null}
					{code ? (
						<details className="font-sans text-xs text-fg-3">
							<summary className="cursor-pointer select-none hover:text-fg-2">코드</summary>
							<pre className="selectable mt-1 overflow-x-auto font-mono text-fg-2">{code}</pre>
						</details>
					) : null}
					{body?.trim() || EXECUTE.has(block.name) ? <KindBody block={block} body={body ?? ""} /> : null}
				</div>
			) : null}
		</ToolCall>
	);
});

const SUB_STATUS: Record<string, StatusKind> = { running: "running", completed: "done", failed: "failed", cancelled: "skipped" };

export const SubagentRow = memo(function SubagentRow({ block, now }: { block: SubagentBlock; version: number; now: number }) {
	const p = block.progress;
	const kind = SUB_STATUS[p.status] ?? "pending";
	const elapsed = (p.endedAt ?? now) - p.startedAt;
	const canOpen = p.conversationId > 0;
	return (
		<button
			type="button"
			disabled={!canOpen}
			onClick={() => canOpen && openSubagent(p.conversationId, p.description || p.taskId)}
			className="group relative flex w-full min-w-0 cursor-pointer items-start gap-2.5 overflow-hidden rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-line-strong disabled:cursor-default"
		>
			<div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm bg-hover text-fg-2">
				<IconRobot size={15} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2 text-sm">
					<span className="min-w-0 truncate font-medium text-fg">{p.description || "서브에이전트"}</span>
					<span className="shrink-0 font-mono text-micro text-fg-3">{p.subagentType}</span>
				</div>
				<div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
					<StatusMark kind={kind} size={12} />
					<span className={cn("shrink-0", statusTextClass(kind))}>{STATUS[kind].label}</span>
					<span className="shrink-0">· {formatElapsed(elapsed)}</span>
					{p.toolCount ? <span className="shrink-0">· 도구 {p.toolCount}</span> : null}
					{p.status === "running" && p.currentTool ? <Shimmer className="min-w-0 truncate font-mono">{p.currentTool}</Shimmer> : p.lastText ? <span className="min-w-0 truncate">{p.lastText}</span> : null}
				</div>
				{p.error ? <div className="mt-1 line-clamp-2 text-xs text-status-failed-fg">{p.error}</div> : null}
			</div>
			{p.status === "running" ? <span className="dn-scan" style={{ ["--scan-color" as string]: "var(--status-running)" }} /> : null}
		</button>
	);
});

export const NoticeRow = memo(function NoticeRow({ block }: { block: NoticeBlock; version: number }) {
	if (block.level === "turn") {
		return (
			<div className="flex items-center gap-3 py-1 text-micro text-fg-3">
				<span className="h-px flex-1 bg-line" />
				<span className="font-mono">
					{formatElapsed(block.elapsedMs ?? 0)} 동안 작업{block.tps ? ` · ${block.tps < 10 ? block.tps.toFixed(1) : Math.round(block.tps)} tok/s` : ""}
				</span>
				<span className="h-px flex-1 bg-line" />
			</div>
		);
	}
	if (/Run \/login|\/login으로 연결/.test(block.text)) {
		return (
			<div className="flex items-center justify-between gap-3 rounded-md border border-status-waiting/40 bg-status-waiting-tint px-3 py-2 text-sm text-fg">
				<span className="selectable">{block.text}</span>
				<button type="button" onClick={() => openSettings(true, "accounts")} className="shrink-0 cursor-pointer rounded-sm bg-inverse px-2 py-1 text-xs text-fg-inverse">
					로그인
				</button>
			</div>
		);
	}
	if (block.level === "error") {
		return <div className="selectable rounded-md border border-status-failed/40 bg-status-failed-tint px-3 py-2 text-sm whitespace-pre-wrap text-status-failed-fg">{block.text}</div>;
	}
	return <div className="selectable truncate text-center text-micro text-fg-3" title={block.text}>{block.text}</div>;
});

export const NudgeRow = memo(function NudgeRow({ block, activeSearch = false }: { block: NudgeBlock; version: number; activeSearch?: boolean }) {
	const [disclosure, setDisclosure] = useState({ manualOpen: false, activeSearch, searchOpen: true });
	// Search reveal is temporary; explicit button choices remain the manual state.
	if (disclosure.activeSearch !== activeSearch) {
		setDisclosure({ ...disclosure, activeSearch, searchOpen: true });
	}
	const open = activeSearch ? (disclosure.activeSearch === activeSearch ? disclosure.searchOpen : true) : disclosure.manualOpen;
	const detailsId = useId();
	return (
		<section className="min-w-0 pl-9" aria-label="자동 알림" data-role="nudge">
			<AssistantHeader at={block.at} badge={<Badge variant="neutral">자동 알림</Badge>} />
			<p className="text-sm text-fg-2">작업을 이어가기 위한 자동 알림이에요</p>
			<button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setDisclosure({ activeSearch, manualOpen: !open, searchOpen: !open })} className="mt-1 cursor-pointer rounded-sm text-xs text-fg-3 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
				{open ? "내부 알림 접기" : "내부 알림 보기"}
			</button>
			<div id={detailsId} hidden={!open} className="selectable mt-2 whitespace-pre-wrap break-words rounded-md border border-line bg-surface p-3 font-mono text-xs text-fg-2">{block.text}</div>
		</section>
	);
});

export function AssistantHeader({ at, badge }: { at?: number; badge?: ReactNode }) {
	return (
		<div className="mb-1.5 -ml-9 flex items-center gap-2 text-xs">
			<div className="flex size-7 items-center justify-center rounded-md border border-line bg-surface">
				<DinoMark size={22} />
			</div>
			<span className="font-semibold text-fg">dinobot</span>
			{badge}
			{at ? <span className="text-fg-3">{new Date(at).toLocaleTimeString(localeTag(), { hour: "numeric", minute: "2-digit" })}</span> : null}
		</div>
	);
}

/** Groupable tool kinds (TUI verb-run groups): reads, searches, listings and web lookups fold into one row. */
export const GROUP_VERB: Record<string, [string, string]> = {
	read: ["파일", "읽음"],
	read_file: ["파일", "읽음"],
	grep: ["패턴", "검색"],
	glob: ["패턴", "검색"],
	search: ["패턴", "검색"],
	find: ["패턴", "검색"],
	ls: ["폴더", "살펴봄"],
	list: ["폴더", "살펴봄"],
	web_fetch: ["페이지", "가져옴"],
	web_search: ["검색어", "웹 검색"],
};

export function ToolGroupRow({ members, now, expanded }: { members: ToolBlock[]; now: number; expanded: boolean }) {
	const [open, setOpen] = useState(expanded);
	const counts = new Map<string, number>();
	for (const m of members) {
		const [noun, verb] = GROUP_VERB[m.name] ?? ["도구", "실행"];
		counts.set(`${verb}|${noun}`, (counts.get(`${verb}|${noun}`) ?? 0) + 1);
	}
	const label = [...counts].map(([k, n]) => {
		const [verb, noun] = k.split("|");
		return `${noun} ${n}개 ${verb}`;
	});
	const running = members.some((m) => m.status === "running");
	const failed = members.filter((m) => m.status === "error").length;
	return (
		<div className="flex flex-col gap-1.5" data-testid="tool-group">
			<button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-left text-sm hover:bg-hover">
				<StatusMark kind={running ? "running" : failed ? "failed" : "done"} size={14} />
				<span className="min-w-0 flex-1 truncate text-fg-2">
					{running ? <Shimmer>{label.join(", ")}</Shimmer> : label.join(", ")}
					{failed ? <span className="text-status-failed-fg"> · {failed}개 실패</span> : null}
				</span>
				<IconChevronRight size={14} className={cn("shrink-0 text-fg-3 transition-transform duration-(--dur-state)", open && "rotate-90")} />
			</button>
			{open ? (
				<div className="flex flex-col gap-1.5 pl-4">
					{members.map((m) => (
						<ToolRow key={m.id} block={m} version={m.version} now={m.status === "running" ? now : 0} />
					))}
				</div>
			) : null}
		</div>
	);
}
