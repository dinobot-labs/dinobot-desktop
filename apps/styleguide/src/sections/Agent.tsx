import { AskCard, AssistantMessage, Composer, ThinkingIndicator, TodoList, ToolCall, UserMessage } from "@dinobot/ui";
import { IconFileText, IconPencil, IconTerminal2 } from "@tabler/icons-react";
import { useState } from "react";
import { todos } from "../fixtures.ts";
import { Block, Section, Stage } from "../kit.tsx";

export function AgentSection() {
	const [busy, setBusy] = useState(true);
	return (
		<Section id="agent" eyebrow="Agent" title="Agent" lede="대화, 도구 호출, 진행 상태, 사람에게 묻기. 답변은 말풍선 없이 본문으로, 사용자 메시지는 둥근 블록으로 둡니다.">
			<div className="grid gap-6 lg:grid-cols-[1fr_300px]">
				<Stage className="flex flex-col gap-5">
					<UserMessage meta="오후 3:12">디자인 시스템부터 만들고, DAG도 어떻게 보여 줄지 리서치해 줘.</UserMessage>
					<AssistantMessage meta="3:12 · 2m 18s">
						<p>
							랜딩의 Signal Paper 토큰을 가져오고 TUI 팔레트로 다크 테마를 만들었어요. DAG는 좁은 패널에서는 <code>rail</code>, 넓은 화면에서는 <code>graph</code>로 보여 줍니다.
						</p>
						<div className="flex flex-col gap-1.5">
							<ToolCall name="read" icon={<IconFileText />} summary="services/landing/src/brand/mascot.ts" status="done" duration="0.2s" />
							<ToolCall name="edit" icon={<IconPencil />} summary="packages/ui/src/styles/tokens.css" status="done" duration="0.4s">
								{"+ --mark-amber: #c77700;\n+ --mark-mint: #0f9e79;\n+ --mark-red: #e5534b;"}
							</ToolCall>
							<ToolCall name="bash" icon={<IconTerminal2 />} summary="bun test packages" status="running" duration="12s" />
							<ToolCall name="bash" icon={<IconTerminal2 />} summary="bun run typecheck" status="failed" duration="3.1s" defaultOpen>
								{"packages/ui/src/components/badge.tsx(33,92): error TS2353: '\"data-slot\"' does not exist in type …"}
							</ToolCall>
						</div>
					</AssistantMessage>
					<ThinkingIndicator label="Running bun test" detail="packages/ui · 19 tests" state="running" />
					<ThinkingIndicator />
					<Composer busy={busy} onStop={() => setBusy(false)} onSubmit={() => setBusy(true)} footer="tmdgusya/dinobot-desktop · main" />
				</Stage>
				<div className="flex flex-col gap-4">
					<Stage>
						<TodoList todos={todos} />
					</Stage>
					<AskCard question="DAG 기본 보기를 무엇으로 할까요?" options={["Rail (목록)", "Graph (그래프)", "둘 다 탭으로"]} />
				</div>
			</div>
			<Block title="Composer (idle)">
				<Composer />
			</Block>
		</Section>
	);
}
