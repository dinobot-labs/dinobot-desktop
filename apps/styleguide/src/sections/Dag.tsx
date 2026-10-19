import { DagCounts, DagGraph, DagHeader, DagMini, DagRail, type DagView, KindIcon, type NodeKind, Switch, Tabs, TabsList, TabsTab } from "@dinobot/ui";
import { useMemo, useState } from "react";
import { blockedView, largeView, runningView } from "../fixtures.ts";
import { Block, Caption, Section, Stage, useNow } from "../kit.tsx";

const KINDS: [NodeKind, string][] = [
	["act", "직접 실행"],
	["delegate", "서브에이전트에 위임"],
	["verify", "검증 (요구사항 인증)"],
	["ask", "사람에게 묻기"],
	["expand", "하위 계획 펼치기"],
];

export function DagSection() {
	const [t0] = useState(() => Date.now());
	const now = useNow(1000);
	const [fixture, setFixture] = useState("running");
	const [selected, setSelected] = useState<string | undefined>("bot");
	const [collapse, setCollapse] = useState(true);
	const views: Record<string, DagView> = useMemo(() => ({ running: runningView(t0), blocked: blockedView(t0), large: largeView(t0) }), [t0]);
	const view = views[fixture] as DagView;
	const live = { now, activity: { bot: "Running: read" } };
	return (
		<Section
			id="dag"
			eyebrow="DAG"
			title="DAG"
			lede={
				<>
					한 데이터(<code className="font-mono text-sm">DagView</code>)를 세 가지로 보여 줍니다. 좁은 패널(320–420px)에서는 웨이브별 <b>Rail</b>, 넓은 화면에서는 층별 <b>Graph</b>, 목록과 헤더에는 점 하나씩의 <b>Mini</b>. 층은 데몬의 longest-path level을 그대로 써서 TUI와 같은 웨이브 번호가 나오고, 배치는 구조에만 의존해 상태가 바뀌어도 노드가 움직이지 않습니다. 움직이는 것은 실행 중인 노드뿐입니다.
				</>
			}
		>
			<div className="flex flex-wrap items-center gap-3">
				<Tabs value={fixture} onValueChange={(v) => setFixture(String(v))}>
					<TabsList>
						<TabsTab value="running">running · 7</TabsTab>
						<TabsTab value="blocked">blocked · 7</TabsTab>
						<TabsTab value="large">large · 39</TabsTab>
					</TabsList>
				</Tabs>
				<label className="flex items-center gap-2 text-sm text-fg-2">
					<Switch checked={collapse} onCheckedChange={setCollapse} /> 끝난 웨이브 접기
				</label>
			</div>
			<Block title="Graph" note="넓으면 LR, 720px 미만이면 TB · 노드에 올리면 위아래 의존만 남김 · 실행 중 노드로 가는 간선만 색">
				<Stage className="p-2">
					<DagGraph view={view} live={live} selected={selected} onSelect={setSelected} className="max-h-[600px]" />
				</Stage>
			</Block>
			<div className="grid items-start gap-4 lg:grid-cols-[380px_1fr]">
				<Block title="Rail" note="380px 패널 · 기본 보기">
					<Stage className="flex flex-col gap-3 p-3">
						<DagHeader view={view} live={live} />
						<DagCounts view={view} live={live} />
						<div className="max-h-[440px] overflow-auto">
							<DagRail view={view} live={live} selected={selected} onSelect={setSelected} collapseDone={collapse} />
						</div>
					</Stage>
				</Block>
				<div className="flex flex-col gap-10">
					<Block title="Graph · narrow (TB)" note="같은 데이터를 좁은 칸에: 노드 폭을 줄여 맞춤">
						<Stage className="max-w-[400px] p-2">
							<DagGraph view={view} live={live} selected={selected} onSelect={setSelected} />
						</Stage>
					</Block>
					<Block title="Mini" note="실행 목록·패널 헤더용 개요">
						<Stage className="flex flex-wrap items-center gap-8">
							{Object.entries(views).map(([k, v]) => (
								<div key={k} className="flex flex-col gap-2">
									<DagMini view={v} live={live} />
									<Caption>{k}</Caption>
								</div>
							))}
						</Stage>
					</Block>
					<Block title="Node kinds" note="종류는 색을 쓰지 않습니다. 색은 상태 몫">
						<Stage className="grid gap-2 sm:grid-cols-2">
							{KINDS.map(([k, label]) => (
								<div key={k} className="flex items-center gap-2 text-sm">
									<KindIcon kind={k} size={16} />
									<span className="w-16 font-mono text-xs text-fg">{k}</span>
									<span className="text-fg-3">{label}</span>
								</div>
							))}
						</Stage>
					</Block>
				</div>
			</div>
		</Section>
	);
}
