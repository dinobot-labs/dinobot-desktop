import { Button, cn, Dino, Kbd } from "@dinobot/ui";
import { IconArrowDown, IconChevronDown, IconChevronUp, IconCornerLeftUp, IconX } from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNow, useSession } from "../lib/hooks.ts";
import { useSettings } from "../lib/settings.ts";
import { useUi } from "../state/ui.ts";
import { AgentRow, AssistantHeader, GROUP_VERB, NoticeRow, NudgeRow, SubagentRow, ThinkingRow, ToolGroupRow, ToolRow, UserRow } from "./blocks.tsx";
import type { ToolBlock } from "./model.ts";
import type { BlockView } from "./protocol.ts";
import type { ChatSession } from "./session.ts";
import { MemoryRecall } from "./MemoryRecall.tsx";
import { Welcome } from "./Welcome.tsx";

export const SessionContext = createContext<ChatSession | null>(null);
export const useChatSession = () => useContext(SessionContext);

/** Blocks the agent produced share one header per run of assistant output (between user turns and notices). */
const isAgentOutput = (b: BlockView | undefined) => b !== undefined && b.kind !== "user" && b.kind !== "nudge" && !(b.kind === "notice" && b.level !== "error");
const groupable = (b: BlockView | undefined): b is ToolBlock => b?.kind === "tool" && b.name in GROUP_VERB && b.status !== "error";

function blockText(b: BlockView): string {
	switch (b.kind) {
		case "user":
		case "nudge":
		case "agent":
		case "thinking":
		case "notice":
			return b.text;
		case "tool":
			return `${b.name} ${JSON.stringify(b.args)} ${b.result ?? b.output}`;
		case "subagent":
			return `${b.progress.description} ${b.progress.lastText ?? ""}`;
	}
}

/** Highlights every occurrence of the query in the rendered transcript (CSS Custom Highlight API, no DOM edits). */
function paintMatches(root: HTMLElement | null, query: string) {
	const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
	const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
	if (!highlights || !HighlightCtor) return;
	highlights.delete("dn-find");
	if (!root || !query) return;
	const ranges: Range[] = [];
	const q = query.toLowerCase();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node && ranges.length < 500; node = walker.nextNode()) {
		const text = node.textContent?.toLowerCase() ?? "";
		for (let i = text.indexOf(q); i >= 0 && ranges.length < 500; i = text.indexOf(q, i + q.length)) {
			const r = new Range();
			r.setStart(node, i);
			r.setEnd(node, i + q.length);
			ranges.push(r);
		}
	}
	highlights.set("dn-find", new HighlightCtor(...ranges));
}

/**
 * The transcript: a virtualized flat list of blocks (only the rows on screen are mounted), so a thread with
 * thousands of blocks renders in constant time. Sticks to the bottom while new output arrives unless the person
 * scrolled up; pins the prompt being read; Ctrl+↑/↓ jump between prompts; Ctrl+F finds in the thread.
 */
export function Transcript({ session, keyboard = true }: { session: ChatSession; keyboard?: boolean }) {
	useSession(session);
	const { order, side } = session;
	const thinkingExpanded = useSettings((s) => s.thinkingExpanded);
	const toolsExpanded = useSettings((s) => s.toolsExpanded);
	const now = useNow(Boolean(side.run), 1000);
	const scroller = useRef<HTMLDivElement>(null);
	const inner = useRef<HTMLDivElement>(null);
	const atBottom = useRef(true);
	const lastScrollTop = useRef(0);
	const [stuck, setStuck] = useState(true);
	const snapshots = useRef(side.snapshots);
	const anchor = useRef<{ id: string } | null>(null);
	const findOpen = useUi((s) => s.findOpen) && keyboard;
	const [query, setQuery] = useState("");
	const [hit, setHit] = useState(0);

	const virtualizer = useVirtualizer({
		count: order.length,
		getScrollElement: () => scroller.current,
		estimateSize: (i) => {
			const b = session.blocks.get(order[i] ?? "");
			return b?.kind === "tool" || b?.kind === "notice" ? 40 : b?.kind === "user" ? 70 : 120;
		},
		getItemKey: (i) => order[i] ?? i,
		overscan: 6,
	});

	const setFollowing = (following: boolean) => {
		atBottom.current = following;
		setStuck(following);
	};
	const pauseFollowing = () => {
		lastScrollTop.current = scroller.current?.scrollTop ?? 0;
		setFollowing(false);
	};
	const toBottom = () => {
		const el = scroller.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
			lastScrollTop.current = el.scrollTop;
		}
	};
	const followLatest = () => {
		anchor.current = null;
		setFollowing(true);
		toBottom();
	};

	useEffect(() => {
		const target = inner.current;
		if (!target) return;
		const ro = new ResizeObserver(() => {
			if (atBottom.current) toBottom();
		});
		ro.observe(target);
		return () => ro.disconnect();
	}, [order.length > 0]);

	useLayoutEffect(() => {
		if (snapshots.current !== side.snapshots) {
			snapshots.current = side.snapshots;
			anchor.current = null;
			setFollowing(true);
			virtualizer.scrollToIndex(Math.max(0, order.length - 1), { align: "end" });
			requestAnimationFrame(() => {
				if (atBottom.current) toBottom();
			});
			return;
		}
		if (anchor.current) {
			const index = order.indexOf(anchor.current.id);
			// Intent state can render before the worker returns older rows. Keep the
			// anchor until those rows are actually prepended (index moves past zero).
			if (index > 0) virtualizer.scrollToIndex(index, { align: "start" });
			if (index !== 0) anchor.current = null;
			return;
		}
		if (atBottom.current) toBottom();
	});

	// Folded runs: consecutive reads/searches/listings render as one group row (TUI verb-run groups).
	const groups = useMemo(() => {
		const map = new Map<string, ToolBlock[] | null>();
		let run: ToolBlock[] = [];
		const flush = () => {
			if (run.length >= 2) run.forEach((m, i) => map.set(m.id, i === 0 ? run : null));
			run = [];
		};
		for (const id of order) {
			const b = session.blocks.get(id);
			if (groupable(b)) run.push(b);
			else if (b?.kind !== "thinking" || !run.length) flush();
		}
		flush();
		return map;
	}, [order, session.version]);

	const userIndexes = useMemo(() => order.flatMap((id, i) => (session.blocks.get(id)?.kind === "user" ? [i] : [])), [order, session.version]);
	const matches = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [] as number[];
		return order.flatMap((id, i) => {
			const b = session.blocks.get(id);
			return b && blockText(b).toLowerCase().includes(q) ? [i] : [];
		});
	}, [query, order, session.version]);

	const items = virtualizer.getVirtualItems();
	const firstVisible = items.find((it) => it.end > (scroller.current?.scrollTop ?? 0))?.index ?? 0;
	const pinnedIndex = [...userIndexes].reverse().find((i) => i < firstVisible);
	const pinned = pinnedIndex === undefined ? undefined : session.blocks.get(order[pinnedIndex] ?? "");

	const jump = (index: number, align: "start" | "center" = "start") => {
		pauseFollowing();
		virtualizer.scrollToIndex(index, { align });
	};

	useEffect(() => {
		if (!keyboard) return;
		const onKey = (e: KeyboardEvent) => {
			if (document.querySelector('[data-slot="dialog"], [data-slot="picker"]')) return;
			const el = scroller.current;
			if (!el) return;
			const mod = e.ctrlKey || e.metaKey;
			if (mod && e.key.toLowerCase() === "f" && !e.shiftKey) {
				e.preventDefault();
				useUi.setState({ findOpen: true });
			} else if (mod && e.key === "ArrowUp") {
				e.preventDefault();
				const prev = [...userIndexes].reverse().find((i) => i < firstVisible) ?? userIndexes[0];
				if (prev !== undefined) jump(prev);
			} else if (mod && e.key === "ArrowDown") {
				e.preventDefault();
				const next = userIndexes.find((i) => i > firstVisible);
				if (next !== undefined) jump(next);
				else followLatest();
			} else if (mod && e.key === "Home") {
				e.preventDefault();
				jump(0);
			} else if (mod && e.key === "End") {
				e.preventDefault();
				followLatest();
			} else if (e.key === "PageUp" || e.key === "PageDown") {
				e.preventDefault();
				if (e.key === "PageUp") pauseFollowing();
				el.scrollBy({ top: (e.key === "PageUp" ? -1 : 1) * el.clientHeight * 0.85 });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [keyboard, userIndexes, firstVisible]);

	useEffect(() => {
		if (!findOpen) {
			paintMatches(null, "");
			return;
		}
		const target = matches[hit];
		if (target !== undefined) jump(target, "center");
		const id = requestAnimationFrame(() => paintMatches(inner.current, query.trim()));
		return () => cancelAnimationFrame(id);
	}, [findOpen, query, hit, matches.length]);

	const onScroll = () => {
		const el = scroller.current;
		if (!el) return;
		// Growth is not user intent. Resume only after moving down to the actual
		// bottom (1px allows fractional scrollTop), never merely within a near-bottom band.
		const top = el.scrollTop;
		if (top < lastScrollTop.current) setFollowing(false);
		else if (top > lastScrollTop.current && el.scrollHeight - top - el.clientHeight <= 1) setFollowing(true);
		lastScrollTop.current = top;
		if (el.scrollTop < 200 && order.length < side.total && !anchor.current) {
			anchor.current = { id: order[0] ?? "" };
			session.loadEarlier();
		}
		if (findOpen && query) requestAnimationFrame(() => paintMatches(inner.current, query.trim()));
	};

	const render = (block: BlockView, index: number): ReactNode => {
		switch (block.kind) {
			case "nudge":
				return <NudgeRow block={block} version={block.version} activeSearch={findOpen && matches[hit] === index} />;
			case "user":
				return <UserRow block={block} version={block.version} />;
			case "agent":
				return <AgentRow block={block} version={block.version} />;
			case "thinking": {
				const next = session.blocks.get(order[index + 1] ?? "");
				if (next?.kind === "thinking") return null; // folded into the last of the run
				const earlier: string[] = [];
				for (let j = index - 1; j >= 0; j--) {
					const b = session.blocks.get(order[j] ?? "");
					if (b?.kind !== "thinking") break;
					earlier.unshift(b.text);
				}
				return <ThinkingRow key={String(thinkingExpanded)} block={block} version={block.version} earlier={earlier} expanded={thinkingExpanded} />;
			}
			case "tool": {
				const group = groups.get(block.id);
				if (group === null) return null;
				if (group) return <ToolGroupRow members={group} now={now} expanded={toolsExpanded} />;
				return <ToolRow block={block} version={block.version} now={block.status === "running" ? now : 0} expanded={toolsExpanded} />;
			}
			case "subagent":
				return <SubagentRow block={block} version={block.version} now={block.progress.status === "running" ? now : 0} />;
			case "notice":
				return block.recall ? <MemoryRecall items={block.recall} /> : <NoticeRow block={block} version={block.version} />;
		}
	};

	const loading = side.snapshots === 0;
	return (
		<SessionContext.Provider value={session}>
			<div className="relative min-h-0 flex-1">
				{findOpen ? (
					<div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-float" data-testid="find-bar">
						<input
							autoFocus
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setHit(0);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									if (matches.length) setHit((h) => (h + (e.shiftKey ? matches.length - 1 : 1)) % matches.length);
								} else if (e.key === "Escape") {
									e.preventDefault();
									useUi.setState({ findOpen: false });
								}
							}}
							placeholder="이 대화에서 찾기"
							aria-label="이 대화에서 찾기"
							className="h-7 w-52 bg-transparent px-2 text-sm outline-none placeholder:text-fg-3"
						/>
						<span className="min-w-12 text-center font-mono text-micro text-fg-3">{matches.length ? `${hit + 1}/${matches.length}` : query ? "0" : ""}</span>
						<Button size="icon-xs" variant="ghost" aria-label="이전" onClick={() => matches.length && setHit((h) => (h + matches.length - 1) % matches.length)}>
							<IconChevronUp />
						</Button>
						<Button size="icon-xs" variant="ghost" aria-label="다음" onClick={() => matches.length && setHit((h) => (h + 1) % matches.length)}>
							<IconChevronDown />
						</Button>
						<Button size="icon-xs" variant="ghost" aria-label="닫기" onClick={() => useUi.setState({ findOpen: false })}>
							<IconX />
						</Button>
					</div>
				) : null}
				{pinned?.kind === "user" && !stuck ? (
					<button
						type="button"
						onClick={() => pinnedIndex !== undefined && jump(pinnedIndex)}
						className="absolute top-0 right-0 left-0 z-[5] mx-auto flex max-w-3xl cursor-pointer items-center gap-2 border-b border-line bg-bg/95 px-6 py-1.5 text-left text-xs text-fg-2"
						data-testid="pinned-prompt"
					>
						<IconCornerLeftUp size={13} className="shrink-0 text-fg-3" />
						<span className="truncate">{pinned.text}</span>
					</button>
				) : null}
				<div
					ref={scroller}
					onScroll={onScroll}
					onWheelCapture={(e) => {
						// Stop before the browser scroll event: a render/resize can arrive first.
						if (e.deltaY < 0 && !e.ctrlKey) pauseFollowing();
					}}
					onKeyDownCapture={(e) => {
						if (e.target === e.currentTarget && (e.key === "ArrowUp" || e.key === "Home" || e.key === "PageUp" || (e.key === " " && e.shiftKey))) pauseFollowing();
					}}
					className="h-full overflow-y-auto [overflow-anchor:none]"
					data-testid="transcript"
					tabIndex={-1}
				>
					{loading ? (
						<div className="flex flex-col items-center gap-3 py-24 text-sm text-fg-3">
							<Dino state="running" size={90} ground />
							불러오는 중
						</div>
					) : order.length === 0 ? (
						<Welcome />
					) : (
						<div ref={inner} className="relative mx-auto w-full max-w-3xl px-6" style={{ height: virtualizer.getTotalSize() + 64 }}>
							{order.length < side.total ? <div className="absolute top-2 right-0 left-0 text-center text-micro text-fg-3">위로 스크롤하면 이전 대화를 불러와요</div> : null}
							{items.map((item) => {
								const block = session.blocks.get(order[item.index] ?? "");
								if (!block) return null;
								const prev = session.blocks.get(order[item.index - 1] ?? "");
								const agent = isAgentOutput(block);
								const startsGroup = agent && !isAgentOutput(prev);
								const body = render(block, item.index);
								return (
									<div
										key={item.key}
										data-index={item.index}
										ref={virtualizer.measureElement}
										className={cn("absolute right-6 left-6", agent ? "pl-9" : "", body === null && !startsGroup ? "" : startsGroup ? "pt-6" : block.kind === "user" ? "pt-6" : "pt-2.5")}
										style={{ transform: `translateY(${item.start + 24}px)` }}
									>
										{startsGroup ? <AssistantHeader /> : null}
										{body}
									</div>
								);
							})}
						</div>
					)}
				</div>
				{!stuck && order.length ? (
					<Button
						variant="secondary"
						size="sm"
						shape="pill"
						className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-float"
						onClick={followLatest}
					>
						<IconArrowDown /> 최신으로 <Kbd className="ml-0.5">Ctrl End</Kbd>
					</Button>
				) : null}
			</div>
		</SessionContext.Provider>
	);
}

