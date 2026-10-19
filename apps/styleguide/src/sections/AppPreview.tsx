import {
	AssistantMessage,
	Badge,
	Button,
	Composer,
	DagHeader,
	DagMini,
	DagRail,
	DinoMark,
	Input,
	StatusMark,
	ThinkingIndicator,
	TodoList,
	ToolCall,
	UserMessage,
} from "@dinobot/ui";
import { IconLayoutSidebarRight, IconPlus, IconSearch, IconTerminal2 } from "@tabler/icons-react";
import { useState } from "react";
import { runningView, todos } from "../fixtures.ts";
import { Section, useNow } from "../kit.tsx";

const THREADS = [
	["running", "dinobot desktop 디자인 시스템", "지금"],
	["waiting", "신한라이프 인계 문서", "12분 전"],
	["done", "Slack 연결 옮기기", "어제"],
	["failed", "k3s 재배포", "어제"],
	["done", "블로그 글: DAG 오케스트레이션", "3일 전"],
] as const;

export function AppPreviewSection() {
	const [t0] = useState(() => Date.now());
	const now = useNow(1000);
	const view = runningView(t0);
	const live = { now, activity: { bot: "Running: read" } };
	return (
		<Section id="app" eyebrow="Preview" title="App preview" lede="같은 부품으로 조립한 데스크톱 창: 왼쪽 스레드, 가운데 대화, 오른쪽 작업 패널(DAG rail과 Todo).">
			<div className="overflow-hidden rounded-xl border border-line-strong bg-bg shadow-pop">
				<div className="flex h-10 items-center gap-2 border-b border-line bg-band px-3">
					<span className="flex gap-1.5">
						<span className="size-3 rounded-full bg-line-strong" />
						<span className="size-3 rounded-full bg-line-strong" />
						<span className="size-3 rounded-full bg-line-strong" />
					</span>
					<span className="ml-3 truncate text-xs font-medium text-fg-2">dinobot desktop 디자인 시스템</span>
					<Badge variant="running" className="ml-1">running</Badge>
					<div className="ml-auto flex items-center gap-1">
						<DagMini view={view} live={live} dot={6} gap={3} />
						<Button size="icon-sm" variant="ghost" aria-label="Toggle panel"><IconLayoutSidebarRight /></Button>
					</div>
				</div>
				<div className="grid h-[640px] grid-cols-[220px_1fr_340px]">
					<aside className="flex min-h-0 flex-col border-r border-line bg-band p-2.5">
						<div className="flex items-center gap-2 px-1.5 pb-2.5">
							<DinoMark size={22} />
							<span className="text-sm font-semibold">dinobot</span>
							<Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="New thread"><IconPlus /></Button>
						</div>
						<div className="relative">
							<IconSearch size={14} className="pointer-events-none absolute top-2 left-2 text-fg-3" />
							<Input placeholder="검색" className="h-7 pl-7 text-xs" />
						</div>
						<div className="mt-3 px-1.5 font-mono text-micro uppercase tracking-[var(--tr-label)] text-fg-3">Threads</div>
						<div className="mt-1 flex flex-col gap-0.5">
							{THREADS.map(([s, title, when], i) => (
								<div key={title} className={i === 0 ? "flex items-center gap-2 rounded-sm bg-pressed px-1.5 py-1.5" : "flex items-center gap-2 rounded-sm px-1.5 py-1.5 hover:bg-hover"}>
									<StatusMark kind={s} size={12} />
									<span className="min-w-0 flex-1 truncate text-xs text-fg">{title}</span>
									<span className="shrink-0 text-micro text-fg-3">{when}</span>
								</div>
							))}
						</div>
					</aside>
					<main className="flex min-h-0 flex-col">
						<div className="min-h-0 flex-1 overflow-auto px-6 py-5">
							<div className="mx-auto flex max-w-2xl flex-col gap-5">
								<UserMessage>DAG 표현 방식 리서치해서 디자인 시스템부터 만들자.</UserMessage>
								<AssistantMessage meta="2m 18s">
									<p>토큰과 Dino, Shimmer를 먼저 만들고, DAG는 리서치 결과대로 rail과 graph 두 보기로 구현할게요.</p>
									<ToolCall name="bash" icon={<IconTerminal2 />} summary="bun test packages" status="running" duration="12s" />
								</AssistantMessage>
								<ThinkingIndicator label="Running bun test" detail="19 tests" state="running" />
							</div>
						</div>
						<div className="px-6 pb-5">
							<div className="mx-auto max-w-2xl">
								<Composer busy footer="tmdgusya/dinobot-desktop · main" />
							</div>
						</div>
					</main>
					<aside className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-line bg-surface p-3">
						<DagHeader view={view} live={live} />
						<DagRail view={view} live={live} />
						<div className="border-t border-line pt-3">
							<TodoList todos={todos} />
						</div>
					</aside>
				</div>
			</div>
		</Section>
	);
}
