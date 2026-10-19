import { Badge, Banner, Button, Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle, ContextMeter, HintBar, Input, Kbd, Meter, Picker, Separator, Stepper, Switch, Tabs, TabsList, TabsPanel, TabsTab, Textarea, Toaster, toast, Tooltip } from "@dinobot/ui";
import { useState } from "react";
import { IconBolt, IconGitBranch, IconLayoutSidebar, IconPlus, IconSettings, IconTrash } from "@tabler/icons-react";
import { Block, Section, Stage } from "../kit.tsx";

const VARIANTS = ["primary", "signal", "secondary", "ghost", "subtle", "danger", "link"] as const;

function PickerDemo() {
	const [open, setOpen] = useState<"select" | "checklist" | null>(null);
	return (
		<>
			<div className="flex gap-2">
				<Button onClick={() => setOpen("select")}>Picker (select)</Button>
				<Button onClick={() => setOpen("checklist")}>Picker (checklist)</Button>
			</div>
			<Picker
				open={open !== null}
				mode={open ?? "select"}
				title={open === "checklist" ? "스킬" : "모델 고르기"}
				header="입력해서 찾고 Enter로 고르세요"
				options={[
					{ id: "a/sonnet", label: "Claude Sonnet 4.6", group: "Anthropic", current: true, checked: true },
					{ id: "a/opus", label: "Claude Opus 4.1", group: "Anthropic", badge: "logged in", checked: false },
					{ id: "o/gpt", label: "GPT-6", group: "OpenAI", tag: "~2k tok", checked: true },
					{ id: "o/old", label: "GPT-4 (지원 종료)", group: "OpenAI", disabled: true, description: "not available; log in first" },
				]}
				onChoose={(ids) => {
					setOpen(null);
					toast({ tone: "success", title: `고름: ${ids.join(", ")}` });
				}}
				onCancel={() => setOpen(null)}
			/>
		</>
	);
}

export function ComponentsSection() {
	return (
		<Section id="components" eyebrow="Components" title="Components" lede="Base UI 위에 cva 변형과 data-slot을 붙여 만듭니다. 평평하게: 색, 헤어라인, hover 채움만 쓰고 그림자는 없습니다.">
			<Block title="Button" note="variant × size, 아이콘 버튼은 같은 높이">
				<Stage className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center gap-2">
						{VARIANTS.map((v) => (
							<Button key={v} variant={v}>
								{v}
							</Button>
						))}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button size="xs">xs</Button>
						<Button size="sm">sm</Button>
						<Button size="md">md</Button>
						<Button size="lg">lg</Button>
						<Separator orientation="vertical" className="mx-2 h-6" />
						<Button size="icon-xs" variant="ghost" aria-label="Add"><IconPlus /></Button>
						<Button size="icon-sm" variant="ghost" aria-label="Sidebar"><IconLayoutSidebar /></Button>
						<Button size="icon" aria-label="Settings"><IconSettings /></Button>
						<Button size="icon-lg" variant="primary" shape="pill" aria-label="Run"><IconBolt /></Button>
						<Separator orientation="vertical" className="mx-2 h-6" />
						<Button variant="primary"><IconPlus /> 새 스레드</Button>
						<Button variant="danger" size="sm"><IconTrash /> 삭제</Button>
						<Button disabled>disabled</Button>
					</div>
				</Stage>
			</Block>
			<div className="grid gap-10 lg:grid-cols-2">
				<Block title="Badge">
					<Stage className="flex flex-wrap items-center gap-2">
						<Badge>neutral</Badge>
						<Badge variant="outline">outline</Badge>
						<Badge variant="signal">signal</Badge>
						<Badge variant="solid">solid</Badge>
						<Badge variant="ink">ink</Badge>
						<Badge variant="running">running</Badge>
						<Badge variant="waiting">waiting</Badge>
						<Badge variant="success">success</Badge>
						<Badge variant="failed">failed</Badge>
						<Badge shape="tag">delegate</Badge>
						<Badge shape="tag" variant="signal">
							<IconGitBranch /> main
						</Badge>
					</Stage>
				</Block>
				<Block title="Tabs · Switch · Tooltip · Kbd">
					<Stage className="flex flex-col gap-4">
						<Tabs defaultValue="rail">
							<TabsList>
								<TabsTab value="rail">Rail</TabsTab>
								<TabsTab value="graph">Graph</TabsTab>
								<TabsTab value="timeline">Timeline</TabsTab>
							</TabsList>
							<TabsPanel value="rail" className="pt-2 text-sm text-fg-3">rail panel</TabsPanel>
							<TabsPanel value="graph" className="pt-2 text-sm text-fg-3">graph panel</TabsPanel>
							<TabsPanel value="timeline" className="pt-2 text-sm text-fg-3">timeline panel</TabsPanel>
						</Tabs>
						<div className="flex flex-wrap items-center gap-4 text-sm text-fg-2">
							<label className="flex items-center gap-2">
								<Switch defaultChecked /> follow live
							</label>
							<Tooltip content="dinobot에게 다시 맡기기">
								<Button size="sm" variant="secondary">hover me</Button>
							</Tooltip>
							<span className="flex items-center gap-1">
								<Kbd>Ctrl</Kbd>
								<Kbd>K</Kbd>
								<span className="ml-1 text-fg-3">명령</span>
							</span>
						</div>
					</Stage>
				</Block>
			</div>
			<div className="grid gap-10 lg:grid-cols-2">
				<Block title="Feedback" note="Banner · Toast · Meter · Stepper · HintBar">
					<Stage className="flex flex-col gap-3">
						<Banner tone="running">업데이트가 있어요: 0.7.13 → 0.7.14</Banner>
						<Banner tone="failed" onDismiss={() => {}}>실행 중인 데몬이 이 앱보다 오래됐어요</Banner>
						<div className="grid grid-cols-[90px_1fr_auto] items-center gap-3 text-sm">
							<span className="text-fg-2">5시간 한도</span>
							<Meter value={0.58} thresholds={{ warn: 0.75, danger: 0.9, of: "rest" }} />
							<span className="font-mono text-xs">58% 남음</span>
							<span className="text-fg-2">주간 한도</span>
							<Meter value={0.07} thresholds={{ warn: 0.75, danger: 0.9, of: "rest" }} />
							<span className="font-mono text-xs text-status-failed-fg">7% 남음</span>
						</div>
						<ContextMeter used={162_000} window={200_000} />
						<Stepper steps={[{ id: "1", label: "브라우저 콜백을 기다리는 중", state: "done" }, { id: "2", label: "코드를 교환하는 중", state: "running" }]} />
						<HintBar hints={[{ keys: "Enter", label: "보내기" }, { keys: "Shift+Tab", label: "추론" }, { keys: "Esc", label: "멈추기" }]} />
						<div className="flex gap-2">
							<Button size="sm" onClick={() => toast({ title: "링크를 복사했어요" })}>Toast</Button>
							<Button size="sm" onClick={() => toast({ tone: "error", title: "주간 한도 93% 사용", body: "10월 21일 재설정", duration: 0 })}>
								고정 Toast
							</Button>
						</div>
						<PickerDemo />
						<Toaster />
					</Stage>
				</Block>
				<Block title="Input · Textarea">
					<Stage className="flex flex-col gap-3">
						<Input placeholder="스레드 검색" />
						<Input aria-invalid defaultValue="잘못된 값" />
						<Textarea placeholder="여러 줄 입력" />
					</Stage>
				</Block>
				<Block title="Card">
					<Card>
						<CardHeader>
							<CardTitle>dinobot-desktop</CardTitle>
							<CardDescription>Signal Paper 디자인 시스템과 데스크톱 셸</CardDescription>
						</CardHeader>
						<CardBody className="flex flex-wrap gap-1.5">
							<Badge variant="running">2 running</Badge>
							<Badge variant="waiting">1 waiting</Badge>
							<Badge variant="success">5 done</Badge>
						</CardBody>
						<CardFooter>
							<Button size="sm" variant="primary">열기</Button>
							<Button size="sm" variant="ghost">설정</Button>
						</CardFooter>
					</Card>
				</Block>
			</div>
		</Section>
	);
}
