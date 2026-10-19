import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { DinoMark } from "../dino/Dino.tsx";

/** The person's turn: a right-aligned sunken bubble ; replies stay prose on the page. */
export function UserMessage({ className, children, meta, ...props }: ComponentProps<"div"> & { meta?: ReactNode }) {
	return (
		<div data-slot="user-message" className={cn("flex flex-col items-end gap-1", className)} {...props}>
			<div className="max-w-[80%] rounded-lg rounded-br-sm bg-hover px-3.5 py-2.5 text-md leading-[var(--lh-chat)] text-fg whitespace-pre-wrap">{children}</div>
			{meta ? <div className="px-1 text-micro text-fg-3">{meta}</div> : null}
		</div>
	);
}

/** dinobot's turn: prose on the page, no bubble, with the small mascot as the speaker mark. */
export function AssistantMessage({
	className,
	children,
	name = "dinobot",
	meta,
	...props
}: ComponentProps<"div"> & { name?: string; meta?: ReactNode }) {
	return (
		<div data-slot="assistant-message" className={cn("flex gap-3", className)} {...props}>
			<div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface">
				<DinoMark size={22} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="mb-1 flex items-center gap-2 text-xs">
					<span className="font-semibold text-fg">{name}</span>
					{meta ? <span className="text-fg-3">{meta}</span> : null}
				</div>
				<div className="flex flex-col gap-2 text-md leading-[var(--lh-chat)] text-fg [&_code]:rounded-xs [&_code]:bg-hover [&_code]:px-1 [&_code]:py-px [&_code]:text-[0.92em]">{children}</div>
			</div>
		</div>
	);
}
