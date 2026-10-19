import type { AskView } from "@dinobot/contracts";
import { Badge, Button, Dino, Input } from "@dinobot/ui";
import { IconSend } from "@tabler/icons-react";
import { useState } from "react";
import { formatElapsed, useNow } from "../lib/hooks.ts";

const KIND: Record<string, string> = { decision: "결정", clarification: "확인", acceptance: "승인", authority: "권한", conflict: "충돌", external: "외부" };

/** Questions dinobot is waiting on: options as buttons (best first), the default and its deadline, or a free answer. */
export function AskBar({ asks, onChoose, onAnswer }: { asks: AskView[]; onChoose: (ask: AskView, index: number) => Promise<void>; onAnswer: (ask: AskView, text: string) => Promise<void> }) {
	const now = useNow(asks.length > 0, 1000);
	const [text, setText] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState<string | null>(null);
	if (!asks.length) return null;
	return (
		<div className="flex flex-col gap-2" data-testid="ask-bar">
			{asks.map((ask) => (
				<div key={ask.id} className="rounded-lg border border-status-waiting bg-status-waiting-tint p-3">
					<div className="flex items-start gap-2.5">
						<Dino state="waiting" size={30} shape="pixel" className="mt-0.5" />
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-1.5 text-micro text-status-waiting-fg">
								<Badge variant="waiting" shape="tag">
									{KIND[ask.kind] ?? ask.kind}
								</Badge>
								<span>답이 필요해요 · {formatElapsed(ask.deadlineAt - now)} 뒤 기본값 "{ask.default}" 적용</span>
							</div>
							<p className="selectable mt-1 text-sm whitespace-pre-wrap text-fg">{ask.question}</p>
						</div>
					</div>
					{ask.options?.length ? (
						<div className="mt-2.5 flex flex-wrap gap-1.5 pl-10">
							{ask.options.map((option, i) => (
								<Button
									key={option}
									size="sm"
									variant={i === 0 ? "primary" : "secondary"}
									disabled={busy === ask.id}
									onClick={() => {
										setBusy(ask.id);
										void onChoose(ask, i).finally(() => setBusy(null));
									}}
								>
									<span className="font-mono text-micro opacity-60">{i + 1}</span>
									{option}
									{option === ask.default ? <span className="text-micro opacity-60">기본</span> : null}
								</Button>
							))}
						</div>
					) : null}
					<form
						className="mt-2 flex gap-1.5 pl-10"
						onSubmit={(e) => {
							e.preventDefault();
							const value = text[ask.id]?.trim();
							if (!value) return;
							setBusy(ask.id);
							void onAnswer(ask, value).finally(() => {
								setBusy(null);
								setText((t) => ({ ...t, [ask.id]: "" }));
							});
						}}
					>
						<Input value={text[ask.id] ?? ""} onChange={(e) => setText((t) => ({ ...t, [ask.id]: e.target.value }))} placeholder="직접 답하기" className="h-7 bg-surface text-xs" />
						<Button type="submit" size="icon-sm" variant="secondary" aria-label="답 보내기" disabled={busy === ask.id || !text[ask.id]?.trim()}>
							<IconSend />
						</Button>
					</form>
				</div>
			))}
		</div>
	);
}
