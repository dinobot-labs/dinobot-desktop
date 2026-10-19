import { cn } from "../../lib/cn.ts";
import { Button } from "../button.tsx";
import { Dino } from "../dino/Dino.tsx";

/** A question from the agent (ask protocol): numbered options as buttons, best first. */
export function AskCard({
	question,
	options,
	onChoose,
	className,
}: {
	question: string;
	options: readonly string[];
	onChoose?: (option: string, index: number) => void;
	className?: string;
}) {
	return (
		<div data-slot="ask-card" className={cn("rounded-lg border border-status-waiting bg-status-waiting-tint p-3", className)}>
			<div className="flex items-start gap-2.5">
				<Dino state="waiting" size={30} shape="pixel" className="mt-0.5" />
				<div className="min-w-0 flex-1">
					<div className="font-mono text-micro uppercase tracking-[var(--tr-label)] text-status-waiting-fg">답이 필요해요</div>
					<p className="mt-0.5 text-sm text-fg">{question}</p>
				</div>
			</div>
			<div className="mt-2.5 flex flex-wrap gap-1.5 pl-10">
				{options.map((o, i) => (
					<Button key={o} size="sm" variant={i === 0 ? "primary" : "secondary"} onClick={() => onChoose?.(o, i)}>
						<span className="font-mono text-micro opacity-60">{i + 1}</span>
						{o}
					</Button>
				))}
			</div>
		</div>
	);
}
