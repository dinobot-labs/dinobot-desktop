import { Button, cn, Dialog, DialogPopup, Dino, Spinner, Tooltip } from "@dinobot/ui";
import { IconArrowLeft, IconExternalLink, IconFileTypeHtml, IconFolder, IconMaximize, IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import type { ArtifactContent } from "../../../desktop/src/bridge-types.ts";
import { type ArtifactCandidate, type ArtifactKind, type ArtifactSource, artifactKey } from "../chat/artifacts.ts";
import { desktop } from "../lib/bridge.ts";
import { relativeTime } from "../lib/hooks.ts";
import { ARTIFACT_SANDBOX, artifactSrcdoc, folderOf, formatBytes } from "./artifact-frame.ts";

/** Which view the right panel shows. */
export const usePanelTab = create<{ tab: "work" | "artifacts" | "browser"; set: (tab: "work" | "artifacts" | "browser") => void }>((set) => ({
	tab: "work",
	set: (tab) => set({ tab }),
}));

export interface ArtifactItem {
	path: string;
	name: string;
	kind: ArtifactKind;
	bytes: number;
	mtimeMs: number;
	at: number;
	source: ArtifactSource;
}

export type ArtifactList = { supported: boolean; items: ArtifactItem[]; refresh: () => void };

/** The thread's candidates that exist as files the main process will show, newest first, one per real file. */
export function useArtifacts(candidates: readonly ArtifactCandidate[], settle: unknown): ArtifactList {
	const [items, setItems] = useState<ArtifactItem[]>([]);
	const [tick, setTick] = useState(0);
	const paths = useMemo(() => candidates.map((c) => c.path), [candidates]);
	const key = paths.join("\n");
	useEffect(() => {
		if (!desktop?.artifactStat || paths.length === 0) {
			setItems([]);
			return;
		}
		let live = true;
		void desktop.artifactStat(paths).then((stats) => {
			if (!live) return;
			const seen = new Set<string>();
			const next: ArtifactItem[] = [];
			stats.forEach((s, i) => {
				const c = candidates[i];
				if (!s.ok || !c) return;
				const id = artifactKey(s.path);
				if (seen.has(id)) return;
				seen.add(id);
				next.push({ path: s.path, name: c.name, kind: s.kind, bytes: s.bytes, mtimeMs: s.mtimeMs, at: c.at, source: c.source });
			});
			setItems((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
		}, () => {});
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `paths`
	}, [key, settle, tick]);
	return { supported: Boolean(desktop?.artifactStat), items, refresh: () => setTick((t) => t + 1) };
}

// Recently read contents, keyed by path and modification time (thumbnails and the open preview share them).
const cache = new Map<string, ArtifactContent | { error: string }>();
const CACHE_LIMIT = 24;

function useContent(item: ArtifactItem | undefined): ArtifactContent | { error: string } | undefined {
	const id = item ? `${item.path}\n${item.mtimeMs}` : "";
	const [content, setContent] = useState(() => cache.get(id));
	useEffect(() => {
		if (!item || !desktop?.artifactRead) return;
		const hit = cache.get(id);
		if (hit) {
			setContent(hit);
			return;
		}
		setContent(undefined);
		let live = true;
		void desktop.artifactRead(item.path).then(
			(result) => {
				cache.set(id, result);
				while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
				if (live) setContent(result);
			},
			(error: unknown) => live && setContent({ error: error instanceof Error ? error.message : String(error) }),
		);
		return () => {
			live = false;
		};
	}, [id]);
	return content;
}

const CHECKER = {
	backgroundColor: "var(--color-surface)",
	backgroundImage: "conic-gradient(var(--color-hover) 25%, transparent 0 50%, var(--color-hover) 0 75%, transparent 0)",
	backgroundSize: "16px 16px",
};

const SOURCE: Record<ArtifactSource, string> = { write: "작성", image: "생성", mention: "언급" };
const THUMB_MAX_BYTES = 4 * 1024 * 1024;

function Thumb({ item }: { item: ArtifactItem }) {
	const content = useContent(item.kind === "image" && item.bytes <= THUMB_MAX_BYTES ? item : undefined);
	const box = "flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line";
	if (item.kind === "html")
		return (
			<span className={cn(box, "bg-hover text-fg-3")}>
				<IconFileTypeHtml size={20} />
			</span>
		);
	return (
		<span className={box} style={CHECKER}>
			{content && "data" in content ? <img src={`data:${content.mimeType};base64,${content.data}`} alt="" className="size-full object-cover" /> : null}
		</span>
	);
}

function Preview({ item, large }: { item: ArtifactItem; large?: boolean }) {
	const content = useContent(item);
	if (!content)
		return (
			<div className="flex flex-1 items-center justify-center">
				<Spinner />
			</div>
		);
	if ("error" in content) return <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-status-failed-fg">미리 볼 수 없어요: {content.error}</div>;
	if (content.kind === "image") {
		return (
			<div className={cn("flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md border border-line", large ? "p-2" : "p-3")} style={CHECKER} data-testid="artifact-image">
				<img src={`data:${content.mimeType};base64,${content.data}`} alt={item.name} className="max-h-full max-w-full object-contain" />
			</div>
		);
	}
	return (
		<iframe
			key={`${item.path}:${item.mtimeMs}`}
			title={item.name}
			sandbox={ARTIFACT_SANDBOX}
			srcDoc={artifactSrcdoc(content.text)}
			referrerPolicy="no-referrer"
			className="min-h-0 w-full flex-1 rounded-md border border-line bg-white"
			data-testid="artifact-frame"
		/>
	);
}

function Actions({ item, onLarge, onRefresh }: { item: ArtifactItem; onLarge?: () => void; onRefresh?: () => void }) {
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			{onRefresh ? (
				<Tooltip content="다시 읽기">
					<Button variant="ghost" size="icon-sm" aria-label="다시 읽기" onClick={onRefresh}>
						<IconRefresh />
					</Button>
				</Tooltip>
			) : null}
			{onLarge ? (
				<Tooltip content="크게 보기">
					<Button variant="ghost" size="icon-sm" aria-label="크게 보기" onClick={onLarge}>
						<IconMaximize />
					</Button>
				</Tooltip>
			) : null}
			<Tooltip content={item.kind === "html" ? "브라우저에서 열기" : "기본 앱으로 열기"}>
				<Button variant="ghost" size="icon-sm" aria-label="기본 앱으로 열기" onClick={() => void desktop?.artifactOpen(item.path, "open")}>
					<IconExternalLink />
				</Button>
			</Tooltip>
			<Tooltip content="폴더에서 보기">
				<Button variant="ghost" size="icon-sm" aria-label="폴더에서 보기" onClick={() => void desktop?.artifactOpen(item.path, "reveal")}>
					<IconFolder />
				</Button>
			</Tooltip>
		</div>
	);
}

/** The Artifacts tab of the right panel: a list of the thread's HTML pages and images, and a preview of one. */
export function ArtifactsPanel({ list, running }: { list: ArtifactList; running: boolean }) {
	const [selected, setSelected] = useState<string | null>(null);
	const [large, setLarge] = useState(false);
	const item = list.items.find((i) => i.path === selected);
	const now = Date.now();

	if (!list.supported) {
		return <div className="px-6 py-14 text-center text-sm text-fg-3">아티팩트 미리보기는 데스크톱 앱에서 열 수 있어요.</div>;
	}
	if (item) {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-2 p-3" data-testid="artifact-detail">
				<div className="flex min-w-0 items-center gap-1">
					<Button variant="ghost" size="icon-sm" aria-label="목록으로" onClick={() => setSelected(null)}>
						<IconArrowLeft />
					</Button>
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-medium text-fg" title={item.path}>{item.name}</div>
						<div className="truncate font-mono text-micro text-fg-3" title={item.path}>{formatBytes(item.bytes)} · {relativeTime(item.mtimeMs, now)}</div>
					</div>
					<Actions item={item} onLarge={() => setLarge(true)} onRefresh={list.refresh} />
				</div>
				<Preview item={item} />
				<Dialog open={large} onOpenChange={setLarge}>
					<DialogPopup className="h-[88vh] max-h-none w-[92vw] max-w-none gap-2 p-3" showClose={false}>
						<div className="flex min-w-0 items-center gap-2">
							<div className="min-w-0 flex-1 truncate text-sm font-medium" title={item.path}>{item.name}</div>
							<Actions item={item} />
							<Button variant="ghost" size="sm" onClick={() => setLarge(false)}>닫기</Button>
						</div>
						{large ? <Preview item={item} large /> : null}
					</DialogPopup>
				</Dialog>
			</div>
		);
	}
	if (list.items.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
				<Dino state={running ? "running" : "idle"} size={90} />
				<div className="text-sm text-fg-3">에이전트가 만든 HTML 페이지와 이미지가 여기에 모여요.</div>
			</div>
		);
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2" data-testid="artifact-list">
			{list.items.map((i) => (
				<button
					key={i.path}
					type="button"
					data-testid="artifact-row"
					onClick={() => setSelected(i.path)}
					className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-hover"
				>
					<Thumb item={i} />
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate text-sm text-fg">{i.name}</span>
						<span className="truncate text-micro text-fg-3" dir="rtl" title={i.path}>
							<bdi>{folderOf(i.path)}</bdi>
						</span>
					</span>
					<span className="flex shrink-0 flex-col items-end gap-0.5 font-mono text-micro text-fg-3">
						<span>{relativeTime(i.mtimeMs, now)}</span>
						<span>
							{SOURCE[i.source]} · {formatBytes(i.bytes)}
						</span>
					</span>
				</button>
			))}
		</div>
	);
}
