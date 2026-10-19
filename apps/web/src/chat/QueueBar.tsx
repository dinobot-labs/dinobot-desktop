import type { QueuedInput } from "@dinobot/contracts";
import { Badge, Button } from "@dinobot/ui";
import { IconPlayerTrackNext, IconX } from "@tabler/icons-react";

/** Inputs waiting in the thread inbox: steer (after this tool round) or follow-up (after the answer). */
export function QueueBar({ queue, onSendNow, onWithdraw }: { queue: QueuedInput[]; onSendNow: () => void; onWithdraw: (item: QueuedInput) => void }) {
	if (!queue.length) return null;
	return (
		<div className="rounded-lg border border-line bg-surface" data-testid="queue-bar">
			<div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-fg-3">
				<span className="font-mono uppercase tracking-[var(--tr-label)]">대기 중 {queue.length}</span>
				<span className="flex-1" />
				<Button size="xs" variant="ghost" onClick={onSendNow}>
					<IconPlayerTrackNext /> 지금 보내기
				</Button>
			</div>
			{queue.map((item) => (
				<div key={item.id} className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm">
					<Badge variant={item.mode === "steer" ? "running" : "neutral"} shape="tag">
						{item.mode === "steer" ? "steer" : "follow-up"}
					</Badge>
					<span className="min-w-0 flex-1 truncate text-fg-2">{item.text}</span>
					<Button size="icon-xs" variant="ghost" aria-label="보내지 않기" onClick={() => onWithdraw(item)}>
						<IconX />
					</Button>
				</div>
			))}
		</div>
	);
}
