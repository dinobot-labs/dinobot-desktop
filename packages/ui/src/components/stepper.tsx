import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { StatusMark } from "./status.tsx";

export interface Step {
	id: string;
	label: ReactNode;
	state: "done" | "running" | "failed" | "pending";
	detail?: ReactNode;
}

/** Vertical progress steps (login card, setup apply): the newest spins, earlier ones settle to a check. */
export function Stepper({ steps, className, max = 6 }: { steps: Step[]; className?: string; max?: number }) {
	const hidden = Math.max(0, steps.length - max);
	return (
		<ol data-slot="stepper" className={cn("flex flex-col gap-1.5", className)}>
			{hidden ? <li className="pl-6 text-micro text-fg-3">… 이전 단계 {hidden}개</li> : null}
			{steps.slice(hidden).map((s) => (
				<li key={s.id} className="flex min-w-0 items-start gap-2 text-sm">
					<StatusMark kind={s.state === "done" ? "done" : s.state === "running" ? "running" : s.state === "failed" ? "failed" : "pending"} size={14} className="mt-0.5" />
					<div className="min-w-0 flex-1">
						<div className={cn(s.state === "done" ? "text-fg-3" : "text-fg")}>{s.label}</div>
						{s.detail ? <div className="mt-0.5 text-xs text-fg-3">{s.detail}</div> : null}
					</div>
				</li>
			))}
		</ol>
	);
}
