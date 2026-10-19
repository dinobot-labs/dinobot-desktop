import { Dino, Kbd } from "@dinobot/ui";
import { IconArrowsExchange, IconListDetails, IconPlus, IconWand } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { newThread, runCommandUi, useApp } from "../state/app.ts";
import { useUi } from "../state/ui.ts";

function Action({ icon, label, hint, keys, onClick }: { icon: ReactNode; label: string; hint: string; keys?: string; onClick: () => void }) {
	return (
		<button type="button" onClick={onClick} className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-left hover:border-line-strong hover:bg-hover">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-hover text-fg-2 group-hover:bg-surface [&_svg]:size-4">{icon}</span>
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium text-fg">{label}</span>
				<span className="block truncate text-xs text-fg-3">{hint}</span>
			</span>
			{keys ? <Kbd>{keys}</Kbd> : null}
		</button>
	);
}

/** Empty thread (TUI welcome screen): mascot, wordmark, version, quick actions, model note. */
export function Welcome() {
	const daemon = useApp((s) => s.daemon);
	const model = useApp((s) => (s.activeKey ? s.models[s.activeKey] : undefined));
	return (
		<div className="dot-paper flex min-h-full items-center justify-center px-6 py-12" data-testid="welcome">
			<div className="grid w-full max-w-3xl items-center gap-10 md:grid-cols-[1fr_1.1fr]">
				<div className="flex flex-col items-center gap-4 text-center md:items-start md:text-left">
					<Dino state="idle" size={180} />
					<div>
						<div className="flex items-baseline gap-2">
							<span className="text-display font-semibold tracking-[var(--tr-display)] text-fg">dinobot</span>
							{daemon?.version ? <span className="font-mono text-xs text-fg-3">{daemon.version}</span> : null}
						</div>
						<p className="text-md text-fg-2">팀을 위한 에이전트. 무엇을 맡길까요?</p>
					</div>
					<div className="grid w-full grid-cols-5 overflow-hidden rounded-full">
						{[1, 2, 3, 4, 5].map((s) => (
							<span key={s} className="h-1" style={{ background: `var(--brand-${s})` }} />
						))}
					</div>
					{model ? <div className="font-mono text-micro text-fg-3">{model.model} · 추론 {model.thinkingLevel}</div> : null}
				</div>
				<div className="flex flex-col gap-2">
					<Action icon={<IconPlus />} label="새 스레드" hint="빈 대화를 하나 더 열어요" keys="Ctrl N" onClick={() => newThread()} />
					<Action icon={<IconArrowsExchange />} label="스레드로 이동" hint="이름이나 내용으로 찾아요" keys="Ctrl P" onClick={() => useUi.setState({ switcherOpen: true })} />
					<Action icon={<IconListDetails />} label="세션 둘러보기" hint="지금 일하는 스레드와 최근 스레드" onClick={() => useUi.setState({ switcherOpen: true })} />
					<Action icon={<IconWand />} label="설정 마법사" hint="채널·기능·문제 보고 설정 (/setup)" onClick={() => runCommandUi("setup")} />
				</div>
			</div>
		</div>
	);
}
