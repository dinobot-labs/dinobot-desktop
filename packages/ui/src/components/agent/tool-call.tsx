import { Collapsible } from "@base-ui/react/collapsible";
import { IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Shimmer } from "../shimmer.tsx";
import { type StatusKind, StatusMark } from "../status.tsx";

export interface ToolCallProps {
	/** Tool name, e.g. "bash", "read", "edit". */
	name: string;
	/** One-line summary of the call (command, path). */
	summary?: ReactNode;
	status: StatusKind;
	/** Elapsed or final duration, preformatted ("2.4s"). */
	duration?: string;
	icon?: ReactNode;
	/** Output or arguments, shown when expanded. */
	children?: ReactNode;
	defaultOpen?: boolean;
	className?: string;
}

/**
 * One tool call in the work log: a 32px row (mark, icon, name, summary, duration) that expands into its output.
 * While running, the summary shimmers and a scan line runs along the bottom edge.
 */
export function ToolCall({ name, summary, status, duration, icon, children, defaultOpen = false, className }: ToolCallProps) {
	const running = status === "running";
	return (
		<Collapsible.Root
			defaultOpen={defaultOpen}
			data-slot="tool-call"
			data-status={status}
			className={cn("group/tool relative overflow-hidden rounded-md border border-line bg-surface", status === "failed" && "border-l-2 border-l-status-failed", className)}
		>
			<Collapsible.Trigger
				disabled={!children}
				className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 text-left text-sm outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:hover:bg-transparent"
			>
				<StatusMark kind={status} size={14} />
				{icon ? <span className="flex text-fg-3 [&_svg]:size-3.5">{icon}</span> : null}
				<span className="shrink-0 font-mono text-xs font-medium text-fg">{name}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-3">
					{running && typeof summary === "string" ? <Shimmer>{summary}</Shimmer> : summary}
				</span>
				{duration ? <span className="shrink-0 font-mono text-micro tabular-nums text-fg-3">{duration}</span> : null}
				{children ? <IconChevronRight className="size-3.5 shrink-0 text-fg-3 transition-transform duration-(--dur-state) group-data-[open]/tool:rotate-90" /> : null}
			</Collapsible.Trigger>
			{children ? (
				<Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-(--dur-enter) ease-(--motion-out) data-ending-style:h-0 data-starting-style:h-0">
					<div className="border-t border-line bg-sunken px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-2">{children}</div>
				</Collapsible.Panel>
			) : null}
			{running ? <span className="dn-scan" style={{ ["--scan-color" as string]: "var(--status-running)" }} /> : null}
		</Collapsible.Root>
	);
}
