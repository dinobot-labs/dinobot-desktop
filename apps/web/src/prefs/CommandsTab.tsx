import { Badge, Button } from "@dinobot/ui";
import { IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";
import { readCommand } from "../lib/api.ts";
import { commandThread, runCommandUi } from "../state/app.ts";
import { Section } from "./kit.tsx";

/** Output of a read-only command, shown as monospace text (/plugins, /skills list, /report status). */
export function CommandOutput({ name, args, refreshKey }: { name: string; args?: string; refreshKey?: number }) {
	const [text, setText] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		setText(null);
		void readCommand(commandThread(), name, args).then((r) => {
			if (!live) return;
			setText(r.lines.map((l) => l.text).join("\n"));
			setError(r.error ?? null);
		});
		return () => {
			live = false;
		};
	}, [name, args, refreshKey]);
	return (
		<pre className="selectable max-h-80 overflow-auto rounded-lg border border-line bg-sunken p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-2" data-testid={`output-${name}`}>
			{error ? <span className="text-status-failed-fg">{error}</span> : (text ?? "불러오는 중…") || "(출력 없음)"}
		</pre>
	);
}

function Action({ label, hint, command, args }: { label: ReactNode; hint?: ReactNode; command: string; args?: string }) {
	return (
		<div className="flex items-center gap-3 py-2">
			<div className="min-w-0 flex-1">
				<div className="text-sm text-fg">{label}</div>
				{hint ? <div className="text-xs text-fg-3">{hint}</div> : null}
			</div>
			<code className="hidden shrink-0 font-mono text-micro text-fg-3 md:block">
				/{command}
				{args ? ` ${args}` : ""}
			</code>
			<Button size="sm" onClick={() => runCommandUi(command, args)}>
				<IconPlayerPlay /> 실행
			</Button>
		</div>
	);
}

export function ModelTab() {
	return (
		<Section title="모델" description="바꾸면 이 스레드와 새 대화의 기본값이 함께 바뀌어요.">
			<div className="divide-y divide-line">
				<Action label="모델 고르기" command="model" />
				<Action label="추론 강도" hint="Shift+Tab으로 순서대로 바꿀 수도 있어요" command="reasoning" />
				<Action label="빠른 모드 (우선 처리, 비용 더 큼)" command="fast" />
			</div>
		</Section>
	);
}

export function SkillsTab() {
	const [n, setN] = useState(0);
	return (
		<div className="flex flex-col gap-6">
			<Section title="스킬" description="켜고 끈 결과는 새 대화(/new)부터 적용돼요." aside={<Button size="xs" variant="ghost" onClick={() => setN((v) => v + 1)}><IconRefresh /> 새로고침</Button>}>
				<div className="divide-y divide-line">
					<Action label="스킬 켜고 끄기" hint="목록에서 골라 적용" command="skills" />
					<Action label="제안된 스킬 변경" command="skills" args="pending" />
					<Action label="보관된 스킬" command="skills" args="archived" />
					<Action label="큐레이터 상태" command="skills" args="curator status" />
					<Action label="큐레이터 미리 돌려 보기" command="skills" args="curator dry-run" />
					<Action label="스킬 연구 상태" command="skills" args="evolution status" />
				</div>
				<CommandOutput name="skills" args="list" refreshKey={n} />
			</Section>
		</div>
	);
}

export function ReportsTab() {
	const [n, setN] = useState(0);
	return (
		<div className="flex flex-col gap-6">
			<Section title="문제 보고" description={<>이 대화를 dinobot 개발자에게 보내 하네스 개선에 써요. 보내기 전에 미리보기를 보여 줘요. <Badge shape="tag">동의 필요</Badge></>} aside={<Button size="xs" variant="ghost" onClick={() => setN((v) => v + 1)}><IconRefresh /> 새로고침</Button>}>
				<div className="divide-y divide-line">
					<Action label="이 대화 보고하기" command="report" />
					<Action label="동의 설정" command="report" args="setup" />
					<Action label="자동 보고 켜기" hint="불만 표현이 감지되면 30초 뒤 자동으로 보내요" command="report" args="auto on" />
					<Action label="자동 보고 끄기" command="report" args="auto off" />
					<Action label="동의 철회" hint="보낸 보고도 모두 지워요" command="report" args="withdraw" />
				</div>
				<CommandOutput name="report" args="status" refreshKey={n} />
				<CommandOutput name="report" args="list" refreshKey={n} />
			</Section>
		</div>
	);
}
