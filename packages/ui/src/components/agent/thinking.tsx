import { cn } from "../../lib/cn.ts";
import { Dino } from "../dino/Dino.tsx";
import type { DinoState } from "../dino/geometry.ts";
import { Shimmer } from "../shimmer.tsx";

/** The live status line under the transcript: a tiny moving dino and a shimmering label. */
export function ThinkingIndicator({ label = "Thinking", detail, state = "thinking", className }: { label?: string; detail?: string; state?: DinoState; className?: string }) {
	return (
		<div data-slot="thinking" role="status" aria-live="polite" className={cn("flex min-w-0 items-center gap-2 text-sm text-fg-2", className)}>
			<Dino state={state} size={30} shape="pixel" />
			<Shimmer className="font-medium">{label}</Shimmer>
			{detail ? <span className="truncate text-fg-3">{detail}</span> : null}
		</div>
	);
}
