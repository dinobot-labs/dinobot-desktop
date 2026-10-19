import { cn } from "@dinobot/ui";
import { Block, Caption, Section, Stage } from "../kit.tsx";

const NEUTRALS = Array.from({ length: 12 }, (_, i) => `n-${i + 1}`);
const SIGNALS = ["mint", "teal", "cyan", "blue", "indigo", "red", "amber"] as const;
const ROLES = [
	["bg", "창 배경"],
	["bg-band", "사이드바"],
	["surface", "카드·입력"],
	["surface-sunken", "웰·출력"],
	["surface-hover", "hover"],
	["surface-pressed", "선택"],
	["line", "헤어라인"],
	["line-ui", "컨트롤 경계"],
	["text-1", "본문"],
	["text-2", "보조"],
	["text-3", "캡션"],
	["surface-inverse", "잉크"],
] as const;
const STATUS = [
	["running", "실행 중"],
	["waiting", "사람 대기"],
	["success", "완료"],
	["failed", "실패"],
] as const;

// Literal class names so the Tailwind scanner sees them.
const TEXT_CLASS: Record<string, string> = { display: "text-display", "2xl": "text-2xl", xl: "text-xl", lg: "text-lg", md: "text-md", sm: "text-sm", xs: "text-xs", micro: "text-micro" };
const RADIUS_CLASS: Record<string, string> = { xs: "rounded-xs", sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg", xl: "rounded-xl", "2xl": "rounded-2xl" };

function Swatch({ token, label, className }: { token: string; label?: string; className?: string }) {
	return (
		<div className={cn("min-w-0", className)}>
			<div className="h-12 rounded-md border border-line" style={{ background: `var(--${token})` }} />
			<div className="mt-1.5 truncate font-mono text-micro text-fg-2">--{token}</div>
			{label ? <div className="truncate text-micro text-fg-3">{label}</div> : null}
		</div>
	);
}

export function FoundationsSection() {
	return (
		<>
			<Section id="color" eyebrow="Foundations · 01" title="Color" lede="종이에서 잉크까지 12단계 무채색, 브랜드 신호 다섯 개, 그리고 상태 색. 다크 테마는 같은 이름에 TUI 팔레트 값을 넣습니다. 모든 글자 조합은 4.5:1, 상태 마크와 경계선은 3:1 이상을 테스트로 지킵니다.">
				<Block title="Neutrals" note="paper → ink, 한 색상 계열(OKLCH h≈170)">
					<div className="grid grid-cols-6 gap-3 md:grid-cols-12">
						{NEUTRALS.map((t) => (
							<Swatch key={t} token={t} />
						))}
					</div>
				</Block>
				<Block title="Signals" note="solid는 점·띠·마스코트, deep은 글자, tint·soft는 배경">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{SIGNALS.map((s) => (
							<Stage key={s} className="p-3">
								<div className="grid grid-cols-4 gap-1.5">
									{["", "-deep", "-tint", "-soft"].map((suffix) => (
										<div key={suffix} className="h-10 rounded-sm border border-line" style={{ background: `var(--${s}${suffix})` }} />
									))}
								</div>
								<div className="mt-2 flex items-baseline justify-between">
									<span className="font-mono text-xs font-medium" style={{ color: `var(--${s}-deep)` }}>
										{s}
									</span>
									<Caption>solid · deep · tint · soft</Caption>
								</div>
							</Stage>
						))}
					</div>
				</Block>
				<Block title="Roles" note="컴포넌트는 원시 값이 아니라 역할 이름을 씁니다">
					<div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
						{ROLES.map(([t, l]) => (
							<Swatch key={t} token={t} label={l} />
						))}
					</div>
				</Block>
				<Block title="Status" note="TUI와 같은 의미: 실행 amber, 완료 green, 실패 coral. 색만으로 말하지 않습니다">
					<div className="grid gap-3 sm:grid-cols-4">
						{STATUS.map(([s, l]) => (
							<div key={s} className="rounded-md px-3 py-2.5" style={{ background: `var(--status-${s}-tint)` }}>
								<div className="flex items-center gap-2">
									<span className="size-2.5 rounded-full" style={{ background: `var(--status-${s})` }} />
									<span className="text-sm font-medium" style={{ color: `var(--status-${s}-fg)` }}>
										{s}
									</span>
								</div>
								<div className="mt-0.5 text-xs text-fg-2">{l}</div>
							</div>
						))}
					</div>
				</Block>
			</Section>
			<Section id="type" eyebrow="Foundations · 02" title="Type & shape" lede="Geist와 Geist Mono, 한글은 Pretendard. 데스크톱 UI라 크기는 고정입니다. 기본 UI 글자는 13px, 채팅 본문은 14px입니다.">
				<Block title="Scale">
					<Stage className="flex flex-col gap-3">
						{[
							["display", "44 / 600", "dinobot이 일합니다"],
							["2xl", "28 / 600", "오늘 맡긴 일 3개"],
							["xl", "20 / 600", "DAG 실행 결과"],
							["lg", "16 / 500", "패널 제목 Panel title"],
							["md", "14 / 400", "채팅 본문입니다. The quick brown dino jumps over the lazy bug."],
							["sm", "13 / 400", "기본 UI 글자: 버튼, 목록, 메뉴"],
							["xs", "12 / 500", "메타 정보 · 12s · 3/7 done"],
							["micro", "11 / 400", "주석, 단축키, 작은 라벨"],
						].map(([size, spec, sample]) => (
							<div key={size} className="flex items-baseline gap-4">
								<Caption className="w-24 shrink-0">
									text-{size}
									<br />
									{spec}
								</Caption>
								<span className={cn("min-w-0 truncate text-fg", TEXT_CLASS[size as string], (size === "display" || size === "2xl" || size === "xl") && "font-semibold tracking-[var(--tr-title)]")}>{sample}</span>
							</div>
						))}
						<div className="flex items-baseline gap-4">
							<Caption className="w-24 shrink-0">font-mono</Caption>
							<span className="font-mono text-sm text-fg">bun test packages · 19 pass · 0 fail</span>
						</div>
					</Stage>
				</Block>
				<Block title="Radius & elevation" note="평평함이 기본. 그림자는 떠 있는 층(메뉴·팝오버·토스트)만">
					<div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
						{["xs", "sm", "md", "lg", "xl", "2xl"].map((r) => (
							<div key={r}>
								<div className={cn("h-16 border border-line-strong bg-surface", RADIUS_CLASS[r])} />
								<Caption className="mt-1.5">rounded-{r}</Caption>
							</div>
						))}
					</div>
					<div className="mt-5 grid gap-4 sm:grid-cols-3">
						<div className="rounded-lg border border-line bg-surface p-4 text-sm text-fg-2">flat · hairline</div>
						<div className="rounded-lg bg-surface p-4 text-sm text-fg-2 shadow-float">shadow-float · 메뉴</div>
						<div className="rounded-lg bg-surface p-4 text-sm text-fg-2 shadow-pop">shadow-pop · 다이얼로그</div>
					</div>
				</Block>
			</Section>
			<Section id="motion" eyebrow="Foundations · 03" title="Motion" lede="transform과 opacity만 움직입니다. 반복 애니메이션은 50ms 단위(20fps)로 끊어 같은 프레임에 같이 그려지게 맞춥니다. 동작 줄이기를 켜면 반복은 모두 멈추고 읽을 수 있는 정지 화면이 남습니다.">
				<Stage>
					<div className="grid gap-x-8 gap-y-3 font-mono text-xs sm:grid-cols-2">
						{[
							["--dur-micro", "120ms", "hover, press"],
							["--dur-state", "200ms", "toggle, tooltip, tab"],
							["--dur-enter", "320ms", "panel, toast, disclosure"],
							["--dur-scene", "560ms", "scene swap"],
							["--dur-character", "900ms", "mascot moments"],
							["--loop-shimmer", "2000ms / 40 steps", "shimmer sweep"],
							["--loop-spinner", "1300ms / 26 steps", "spinner, running arc"],
							["dino run", "250ms / 2 frames", "run cycle"],
						].map(([t, v, u]) => (
							<div key={t} className="flex items-baseline gap-3">
								<span className="w-32 shrink-0 text-fg">{t}</span>
								<span className="w-36 shrink-0 text-accent-deep">{v}</span>
								<span className="text-fg-3">{u}</span>
							</div>
						))}
					</div>
				</Stage>
			</Section>
		</>
	);
}
