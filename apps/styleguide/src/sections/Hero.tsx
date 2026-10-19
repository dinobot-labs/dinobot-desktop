import { Badge, DINO_STATES, Dino, type DinoState, Shimmer } from "@dinobot/ui";
import { useEffect, useState } from "react";
import { Section } from "../kit.tsx";

const LABEL: Record<DinoState, string> = { idle: "기다리는 중", thinking: "생각하는 중", running: "일하는 중", waiting: "답을 기다리는 중", done: "끝났어요", failed: "실패했어요" };

export function HeroSection() {
	const [i, setI] = useState(2);
	const state = DINO_STATES[i % DINO_STATES.length] as DinoState;
	useEffect(() => {
		const id = setInterval(() => setI((v) => v + 1), state === "done" || state === "failed" ? 2200 : 3600);
		return () => clearInterval(id);
	}, [state]);
	return (
		<section id="overview" className="pb-16">
			<div className="dot-paper relative overflow-hidden rounded-xl border border-line bg-bg px-8 pt-10 pb-8">
				<div className="flex flex-wrap items-end justify-between gap-8">
					<div className="max-w-xl">
						<Badge variant="signal">Signal Paper · Signal Night</Badge>
						<h1 className="mt-4 text-display font-semibold tracking-[var(--tr-display)] text-fg">
							dinobot desktop
							<br />
							<span className="text-fg-3">design system</span>
						</h1>
						<p className="mt-4 text-md text-fg-2">
							랜딩의 Signal Paper 토큰과 TUI의 Dinobot Signal 팔레트를 하나로 묶은 데스크톱 디자인 시스템입니다. 화면은 평평하게, 색은 상태를 말할 때만, 움직임은 일하는 순간에만 씁니다.
						</p>
					</div>
					<button type="button" onClick={() => setI((v) => v + 1)} className="group flex flex-col items-center gap-3 rounded-lg p-2 outline-none focus-visible:outline-2 focus-visible:outline-focus" aria-label="Next state">
						<Dino key={state} state={state} size={240} ground title={`dinobot, ${LABEL[state]}`} />
						<span className="flex items-center gap-2 font-mono text-xs text-fg-2">
							<span className="text-fg-3">state=</span>
							{state === "running" || state === "thinking" ? <Shimmer signal>{state}</Shimmer> : state}
							<span className="text-fg-3">· {LABEL[state]}</span>
						</span>
					</button>
				</div>
				<div className="mt-8 grid grid-cols-5 overflow-hidden rounded-full">
					{[1, 2, 3, 4, 5].map((s) => (
						<span key={s} className="h-1.5" style={{ background: `var(--brand-${s})` }} />
					))}
				</div>
			</div>
		</section>
	);
}
