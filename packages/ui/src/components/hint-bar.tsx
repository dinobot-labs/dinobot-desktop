import { Fragment } from "react";
import { cn } from "../lib/cn.ts";
import { Kbd } from "./kbd.tsx";

/** Context-sensitive key hints (TUI footer): pairs of keys and labels separated by hairlines. */
export function HintBar({ hints, className }: { hints: { keys: string; label: string }[]; className?: string }) {
	return (
		<div data-slot="hint-bar" className={cn("flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden text-micro text-fg-3", className)}>
			{hints.map((h, i) => (
				<Fragment key={h.keys + h.label}>
					{i ? <span data-slot="hint-separator" className="h-3 w-px bg-line" /> : null}
					<span className="flex items-center gap-1 whitespace-nowrap">
						{h.keys.split(" ").map((k) => (
							<Kbd key={k} className="h-4 min-w-4 px-0.5 text-[10px]">
								{k}
							</Kbd>
						))}
						<span>{h.label}</span>
					</span>
				</Fragment>
			))}
		</div>
	);
}
