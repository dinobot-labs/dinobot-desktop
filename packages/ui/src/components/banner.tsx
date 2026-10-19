import { IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/** A one-line band above the composer or at the top of a view (update available, older daemon, reconnecting). */
export function Banner({
	tone = "neutral",
	icon,
	children,
	actions,
	onDismiss,
	className,
}: {
	tone?: "neutral" | "running" | "waiting" | "failed" | "success";
	icon?: ReactNode;
	children: ReactNode;
	actions?: ReactNode;
	onDismiss?: () => void;
	className?: string;
}) {
	const toneClass = {
		neutral: "border-line bg-sunken text-fg-2",
		running: "border-status-running/40 bg-status-running-tint text-status-running-fg",
		waiting: "border-status-waiting/40 bg-status-waiting-tint text-status-waiting-fg",
		failed: "border-status-failed/40 bg-status-failed-tint text-status-failed-fg",
		success: "border-status-success/40 bg-status-success-tint text-status-success-fg",
	}[tone];
	return (
		<div role="status" data-slot="banner" className={cn("flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs", toneClass, className)}>
			{icon ? <span className="flex shrink-0 [&_svg]:size-3.5">{icon}</span> : null}
			<div className="min-w-0 flex-1">{children}</div>
			{actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
			{onDismiss ? (
				<button type="button" aria-label="닫기" onClick={onDismiss} className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs opacity-70 hover:bg-black/5 hover:opacity-100">
					<IconX size={13} />
				</button>
			) : null}
		</div>
	);
}
