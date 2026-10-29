import { ContextMeter, Tooltip } from "@dinobot/ui";

export type ContextUsageData = { contextTokens: number; sent: number; output: number };

/** Only provider-reported counts. Transcript characters cannot separate system, images and messages. */
export function ContextUsageDetails({ usage }: { usage: ContextUsageData }) {
	const count = (n: number) => n.toLocaleString("en-US");
	return (
		<div className="flex flex-col gap-1.5" data-testid="context-usage-details">
			<span className="font-medium">마지막 제공자 보고 토큰</span>
			<span>합계 {count(usage.contextTokens)}</span>
			<span>입력 (캐시 포함) {count(usage.sent)}</span>
			<span>출력 {count(usage.output)}</span>
			<span>시스템·메시지·이미지별 사용량은 구분할 수 없어요.</span>
			<span>이후 추가된 내용은 다음 보고에 반영돼요.</span>
		</div>
	);
}

/** Footer meter; no guessed split, reserved space, or text-only token estimate. */
export function ContextUsage({ usage, window }: { usage: ContextUsageData; window?: number | undefined }) {
	if (!usage.contextTokens) return null;
	const capacity = window && Number.isFinite(window) && window > 0 ? window : undefined;
	return (
		<Tooltip side="top" content={<ContextUsageDetails usage={usage} />}>
			<span tabIndex={0} aria-label="마지막 제공자 보고 컨텍스트" className="flex h-6 cursor-default items-center rounded-sm px-1.5 hover:bg-hover" data-testid="context-usage">
				<ContextMeter used={usage.contextTokens} window={capacity} />
			</span>
		</Tooltip>
	);
}
