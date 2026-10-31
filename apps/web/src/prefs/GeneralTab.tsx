import { resolveLanguage } from "@dinobot/ui/i18n";
import { Button, cn, DinoMark, Input, SPECIES, SPECIES_IDS, type SpeciesId, Switch } from "@dinobot/ui";
import { IconFolder } from "@tabler/icons-react";
import { desktop, isDesktop } from "../lib/bridge.ts";
import { type ThemeSetting, useSettings } from "../lib/settings.ts";
import { Row, Section } from "./kit.tsx";
import { BrowserLoginImport } from "./BrowserLoginImport.tsx";
import { useMemo } from "react";
import { canvasMeasure, DEFAULT_FONT_SIZE, FONT_OPTIONS, type FontFamilySetting, fontLabel, MAX_FONT_SIZE, MIN_FONT_SIZE } from "../lib/typography.ts";

const THEMES: { value: ThemeSetting; label: string }[] = [
	{ value: "system", label: "시스템" },
	{ value: "light", label: "밝게" },
	{ value: "dark", label: "어둡게" },
	{ value: "dos-blue", label: "DOS 파랑" },
	{ value: "dos-black", label: "DOS 검정" },
];

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
	return (
		<div className="flex flex-wrap rounded-md bg-hover p-0.5" role="radiogroup">
			{options.map((t) => (
				<button
					key={t.value}
					type="button"
					role="radio"
					aria-checked={value === t.value}
					onClick={() => onChange(t.value)}
					className={cn("cursor-pointer rounded-sm px-2.5 py-1 text-xs", value === t.value ? "bg-surface text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-fg-3 hover:text-fg")}
				>
					{t.label}
				</button>
			))}
		</div>
	);
}

/** Dinosaur theme (ADR 0100): each choice is its own [data-dino] frame (head mark, name, species surface); it swaps the mascot and the whole theme. */
export function DinoThemePicker({ value, onChange }: { value: SpeciesId; onChange: (v: SpeciesId) => void }) {
	return (
		<div className="flex gap-1.5" role="radiogroup" aria-label="공룡 테마">
			{SPECIES_IDS.map((id) => {
				const species = SPECIES[id];
				const checked = value === id;
				return (
					<button
						key={id}
						type="button"
						role="radio"
						aria-checked={checked}
						data-dino={id}
						title={`${species.name.ko} · ${species.theme}`}
						onClick={() => onChange(id)}
						className={cn(
							"flex min-w-[4.75rem] cursor-pointer flex-col items-center gap-1 whitespace-nowrap rounded-md border px-2.5 pb-1.5 pt-2 text-xs",
							checked ? "border-accent bg-accent-tint text-fg" : "border-line bg-surface text-fg-3 hover:bg-hover hover:text-fg",
						)}
					>
						<DinoMark species={id} size={33} />
						<span>{species.name.ko}</span>
					</button>
				);
			})}
		</div>
	);
}

export function GeneralTab() {
	const s = useSettings();
	const fontLabels = useMemo(() => { const measure = canvasMeasure(); return FONT_OPTIONS.map((font) => fontLabel(font, measure)); }, []);
	return (
		<div className="flex flex-col gap-6">
			<Section title="화면">
				<div className="divide-y divide-line">
					<Row label="테마" hint="DOS는 내장 Neo둥근모 16px로 표시하며 기존 글꼴 설정은 보존해요. CRT 효과는 사용하지 않아요.">
						<Segmented value={s.theme} options={THEMES} onChange={(theme) => s.set({ theme })} />
					</Row>
					<Row label="공룡 테마" hint="마스코트와 화면 전체 색이 공룡에 맞춰 바뀌어요. 상태 색은 그대로예요.">
						<DinoThemePicker value={s.dino} onChange={(dino) => s.set({ dino })} />
					</Row>
					<Row label="글꼴" hint="설치되지 않은 글꼴은 내장 Pretendard로 표시돼요. 코드 글꼴은 유지돼요.">
						<select aria-label="글꼴" value={s.fontFamily} onChange={(e) => s.set({ fontFamily: e.target.value as FontFamilySetting })} className="min-w-0 max-w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg">
							{FONT_OPTIONS.map((font, i) => <option key={font.value} value={font.value}>{fontLabels[i]}</option>)}
						</select>
					</Row>
					<Row label="글꼴 크기" hint="대화 본문 기준이에요. 화면 전체가 비례해서 조정돼요.">
						<div className="flex items-center gap-2">
							<input aria-label="글꼴 크기" type="range" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1} value={s.fontSize} onChange={(e) => s.set({ fontSize: Number(e.target.value) })} className="w-24 accent-current" />
							<Input key={s.fontSize} aria-label="글꼴 크기 직접 입력" type="number" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1} defaultValue={s.fontSize} className="w-16 text-right tabular-nums" onBlur={(e) => {
								const value = e.currentTarget.valueAsNumber;
								if (Number.isFinite(value)) s.set({ fontSize: value });
								e.currentTarget.value = String(useSettings.getState().fontSize);
							}} onKeyDown={(e) => {
								if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
								if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.value = String(s.fontSize); e.currentTarget.blur(); }
							}} />
							<span className="text-sm text-fg-3">px</span>
							<Button size="sm" variant="ghost" onClick={() => s.set({ fontFamily: "default", fontSize: DEFAULT_FONT_SIZE })}>기본값</Button>
						</div>
					</Row>
					<div aria-label="글꼴 미리보기" className="selectable rounded-md bg-hover p-3 text-md">
						<p>다이노봇과 함께 생각을 정리해 보세요.</p>
						<p>The quick brown fox · 0123456789</p>
						<code className="font-mono text-sm">const answer = 42;</code>
					</div>
					<Row label="생각 과정 펼쳐 보기" hint="Ctrl+E. 모델의 thinking 블록을 펼쳐서 보여 줘요">
						<Switch checked={s.thinkingExpanded} onCheckedChange={(v) => s.set({ thinkingExpanded: v })} />
					</Row>
					<Row label="도구 결과 펼쳐 보기" hint="Ctrl+O. 도구 호출의 출력을 처음부터 펼쳐 둬요">
						<Switch checked={s.toolsExpanded} onCheckedChange={(v) => s.set({ toolsExpanded: v })} />
					</Row>
					<Row label="단축키 안내 줄" hint="입력창 아래 상황별 단축키">
						<Switch checked={s.showHints} onCheckedChange={(v) => s.set({ showHints: v })} />
					</Row>
				</div>
			</Section>
			<BrowserLoginImport />
			<Section title="대화">
				<div className="divide-y divide-line">
					<Row label="새 스레드 작업 폴더" hint={s.defaultCwd ?? "설정 파일의 workspaceRoot, 없으면 홈 폴더"}>
						<div className="flex gap-1.5">
							{isDesktop ? (
								<Button size="sm" onClick={() => void desktop?.pickDirectory().then((dir) => dir && s.set({ defaultCwd: dir }))}>
									<IconFolder /> 고르기
								</Button>
							) : null}
							{s.defaultCwd ? (
								<Button size="sm" variant="ghost" onClick={() => s.set({ defaultCwd: null })}>
									기본값
								</Button>
							) : null}
						</div>
					</Row>
					<Row label="보내는 사람 이름" hint="메시지에 붙는 <from user=…> 값">
						<Input value={s.userName} onChange={(e) => s.set({ userName: e.target.value })} className="w-40" />
					</Row>
					<Row label="끝나면 알림" hint="창을 보고 있지 않을 때 작업이 끝나거나 질문이 오면 알려 줘요">
						<Switch checked={s.notifications} onCheckedChange={(v) => s.set({ notifications: v })} />
					</Row>
					<Row label="언어" hint="화면과 /setup 같은 명령 안내 문구의 언어. 바꾸면 창을 다시 불러와요">
						<Segmented
							value={s.locale || "auto"}
							options={[{ value: "auto", label: "시스템" }, { value: "ko", label: "한국어" }, { value: "en", label: "English" }]}
							onChange={(v) => {
								const locale = v === "auto" ? "" : v;
								const before = resolveLanguage(s.locale, desktop?.locale ?? navigator.language);
								s.set({ locale });
								// Text in module scope is looked up once per load (language-boot.ts): reload to apply a new language.
								if (resolveLanguage(locale, desktop?.locale ?? navigator.language) !== before) location.reload();
							}}
						/>
					</Row>
				</div>
			</Section>
		</div>
	);
}
