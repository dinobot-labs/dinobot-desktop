import { Dino, DinoMark, DINO_STATES, type DinoState, POSE_NAMES, Shimmer, SPECIES, SPECIES_IDS, Spinner, STATUS, StatusChip, type StatusKind, StatusMark } from "@dinobot/ui";
import { useState } from "react";
import { Block, Caption, Section, Stage } from "../kit.tsx";

const STATE_NOTE: Record<DinoState, string> = {
	idle: "6s 주기 깜빡임, 가끔 앞을 봄",
	thinking: "위·가운데·앞을 번갈아 봄",
	running: "250ms 두 프레임 달리기, 땅이 흘러감",
	waiting: "사용자를 보고 천천히 끄덕임",
	done: "한 번 점프하고 웃음",
	failed: "한 번 흔들리고 멈춤",
};
const KINDS = Object.keys(STATUS) as StatusKind[];

/** One dinosaur theme (ADR 0100) in its own [data-dino] frame on its species paper: mascot states, the head marks and the accent family. */
function ThemeCard({ id }: { id: (typeof SPECIES_IDS)[number] }) {
	const species = SPECIES[id];
	return (
		<Stage className="flex flex-col gap-4 p-4">
			<div data-dino={id} id={`dino-theme-${id}`} className="flex flex-col gap-4 rounded-md bg-bg p-3 text-fg">
				<div className="flex items-baseline justify-between gap-2">
					<div className="flex items-center gap-2">
						<DinoMark species={id} size={22} />
						<span className="text-md font-semibold text-fg">{species.name.ko}</span>
						<span className="text-sm text-fg-3">{species.name.en}</span>
					</div>
					<span className="rounded-sm bg-accent-tint px-1.5 py-0.5 font-mono text-micro text-accent-deep">{species.theme}</span>
				</div>
				<div className="dot-paper grid grid-cols-3 gap-2 rounded-md bg-bg p-3">
					{(["idle", "done", "failed"] as const).map((pose) => (
						<div key={pose} className="flex flex-col items-center gap-1">
							<Dino species={id} pose={pose === "done" ? "happy" : pose} size={90} />
							<Caption>{pose}</Caption>
						</div>
					))}
				</div>
				<div className="flex items-end justify-between gap-3">
					<div className="flex flex-col items-center gap-1">
						<Dino species={id} state="running" size={60} ground />
						<Caption>running</Caption>
					</div>
					<div className="flex flex-col items-center gap-1">
						<div className="flex items-end gap-2">
							<DinoMark species={id} size={22} />
							<DinoMark species={id} size={33} />
							<DinoMark species={id} size={44} />
						</div>
						<Caption>mark</Caption>
					</div>
				</div>
				<div>
					<div className="grid grid-cols-4 gap-1.5">
						{["accent", "accent-deep", "accent-tint", "accent-soft"].map((token) => (
							<div key={token} className="min-w-0">
								<div className="h-8 rounded-sm border border-line" style={{ background: `var(--${token})` }} />
								<div className="mt-1 truncate font-mono text-micro text-fg-3">{token.replace("accent", "") || "solid"}</div>
							</div>
						))}
					</div>
					<div className="mt-2 flex h-2 overflow-hidden rounded-full">
						{species.stops.map((stop, i) => (
							<div key={stop} className="flex-1" style={{ background: stop }} title={species.stopNames[i]} />
						))}
					</div>
					<p className="mt-2 text-sm text-fg-2">
						<span className="font-medium text-accent-deep">강조 글자</span> · <span className="rounded-sm bg-selection px-1 text-fg">선택 영역</span> · <StatusChip kind="running" />
					</p>
				</div>
			</div>
		</Stage>
	);
}

function Replay({ state }: { state: DinoState }) {
	const [k, setK] = useState(0);
	return (
		<button type="button" onClick={() => setK((v) => v + 1)} className="flex flex-col items-center gap-2 rounded-md p-2 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus" aria-label={`Replay ${state}`}>
			<Dino key={k} state={state} size={120} ground={state === "running"} />
		</button>
	);
}

export function ToolsSection() {
	return (
		<>
			<Section id="dino" eyebrow="Tools · 01" title="Dino" lede="랜딩 mascot.ts의 30×18 격자 공룡(티라노·익룡·브라키오사우루스)을 그대로 씁니다. 자세는 눈·입·다리 세 영역만 바뀌므로, 몸통은 한 번 그리고 영역별 변형을 CSS로 켜고 끕니다. JS 타이머 없이 순수 CSS라 가볍고, 동작 줄이기에서는 상태를 대표하는 정지 자세로 멈춥니다.">
				<Block title="Dinosaur themes" note="[data-dino] · 마스코트·강조색·배경·글자·경계선·브랜드 신호가 함께 바뀌고 상태 색만 그대로">
					<div className="grid gap-3 lg:grid-cols-3">
						{SPECIES_IDS.map((id) => (
							<ThemeCard key={id} id={id} />
						))}
					</div>
				</Block>
				<Block title="States" note="<Dino state=… /> · 클릭하면 다시 재생">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{DINO_STATES.map((s) => (
							<Stage key={s} dots className="flex flex-col items-center gap-1 p-4">
								<Replay state={s} />
								<span className="font-mono text-xs font-medium text-fg">{s}</span>
								<Caption className="text-center">{STATE_NOTE[s]}</Caption>
							</Stage>
						))}
					</div>
				</Block>
				<Block title="Poses" note="<Dino pose=… /> · 11개 정지 자세">
					<Stage>
						<div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
							{POSE_NAMES.map((p) => (
								<div key={p} className="flex flex-col items-center gap-1.5">
									<Dino pose={p} size={90} />
									<Caption>{p}</Caption>
								</div>
							))}
						</div>
					</Stage>
				</Block>
				<Block title="Sizes & shapes" note="72px 미만은 픽셀 칸(30의 배수에서 선명), 그 이상은 둥근 점">
					<Stage className="flex flex-wrap items-end gap-8">
						{[30, 60, 90].map((s) => (
							<div key={s} className="flex flex-col items-center gap-1.5">
								<Dino state="running" size={s} />
								<Caption>{s}px pixel</Caption>
							</div>
						))}
						<div className="flex flex-col items-center gap-1.5">
							<Dino pose="happy" size={150} />
							<Caption>150px dot</Caption>
						</div>
						<div className="flex flex-col items-center gap-1.5">
							<Dino pose="idle" size={90} palette="current" className="text-fg" />
							<Caption>palette=current</Caption>
						</div>
						<div className="flex flex-col items-center gap-1.5">
							<div className="flex items-end gap-3">
								<DinoMark size={22} />
								<DinoMark size={33} />
								<DinoMark size={44} />
							</div>
							<Caption>DinoMark 22 · 33 · 44</Caption>
						</div>
					</Stage>
				</Block>
			</Section>
			<Section id="shimmer" eyebrow="Tools · 02" title="Shimmer & status" lede="진행 중인 한 줄 라벨 위로 밝은 띠가 지나갑니다. 2000ms/40단계로 끊고 문서 타임라인에 위상을 맞춰, 화면의 모든 shimmer와 spinner가 같은 프레임에 그려집니다.">
				<Block title="Shimmer" note="<Shimmer> · signal은 브랜드 색 띠">
					<Stage className="flex flex-col gap-4">
						<div className="flex flex-wrap items-center gap-8 text-md">
							<Shimmer className="font-medium text-fg-2">Thinking…</Shimmer>
							<Shimmer signal className="font-medium text-fg">Running bun test packages</Shimmer>
							<Shimmer className="font-mono text-sm text-fg-3">edit packages/ui/src/components/dag/layout.ts</Shimmer>
						</div>
						<div className="flex items-center gap-2 text-sm text-fg-2">
							<Spinner className="text-status-running" />
							<Shimmer>Compiling plan · 7 nodes</Shimmer>
						</div>
					</Stage>
				</Block>
				<Block title="Scan line" note="실행 중인 카드 아래 2px 트랙에 띠 하나가 지나감 (transform만 사용)">
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="relative overflow-hidden rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-fg-2">
							accent scan
							<span className="dn-scan" />
						</div>
						<div className="relative overflow-hidden rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-fg-2">
							running scan
							<span className="dn-scan" style={{ ["--scan-color" as string]: "var(--status-running)" }} />
						</div>
					</div>
				</Block>
				<Block title="Status marks" note="모양만으로도 구분됩니다. 오른쪽은 흑백 확인">
					<div className="grid gap-3 lg:grid-cols-2">
						<Stage className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
							{KINDS.map((k) => (
								<StatusChip key={k} kind={k} />
							))}
						</Stage>
						<Stage className="grid grid-cols-7 items-center gap-3 grayscale">
							{KINDS.map((k) => (
								<div key={k} className="flex flex-col items-center gap-1">
									<StatusMark kind={k} size={20} />
									<Caption className="text-center">{k}</Caption>
								</div>
							))}
						</Stage>
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						{(["running", "waiting", "done", "failed", "pending", "skipped"] as const).map((k) => (
							<StatusChip key={k} kind={k} variant="pill" />
						))}
					</div>
				</Block>
			</Section>
		</>
	);
}
