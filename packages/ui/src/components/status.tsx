import { useRef } from "react";
import { cn } from "../lib/cn.ts";
import { useAlignedLoops } from "../lib/animation-sync.ts";

/**
 * Every status the agent UI shows, for tool calls, subagents, DAG nodes and runs. A status is never color alone:
 * each has a distinct mark shape (readable in grayscale) and a word. Only `running` moves.
 * Parity with the TUI (ADR 0015, src/tui/panes/dag.ts displayState): running amber, done green, failed coral.
 */
export type StatusKind =
	| "pending"
	| "ready"
	| "running"
	| "settling"
	| "waiting"
	| "retry"
	| "done"
	| "failed"
	| "skipped"
	| "lastseen"
	| "compiling"
	| "verified"
	| "blocked"
	| "cancelled";

type Tone = "idle" | "fg" | "running" | "waiting" | "success" | "failed" | "cancelled";

export const STATUS: Readonly<Record<StatusKind, { label: string; tone: Tone }>> = {
	pending: { label: "pending", tone: "idle" },
	ready: { label: "ready", tone: "fg" },
	running: { label: "running", tone: "running" },
	settling: { label: "settling", tone: "fg" },
	waiting: { label: "waiting", tone: "waiting" },
	retry: { label: "retry", tone: "running" },
	done: { label: "done", tone: "success" },
	failed: { label: "failed", tone: "failed" },
	skipped: { label: "skipped", tone: "cancelled" },
	lastseen: { label: "last seen", tone: "cancelled" },
	compiling: { label: "compiling", tone: "running" },
	verified: { label: "verified", tone: "success" },
	blocked: { label: "blocked", tone: "failed" },
	cancelled: { label: "cancelled", tone: "cancelled" },
};

/** Mark color (solid hue) per tone. */
export const TONE_MARK: Readonly<Record<Tone, string>> = {
	idle: "text-status-idle",
	fg: "text-fg-2",
	running: "text-status-running",
	waiting: "text-status-waiting",
	success: "text-status-success",
	failed: "text-status-failed",
	cancelled: "text-status-cancelled",
};
/** Readable word color class for a status. */
export const statusTextClass = (kind: StatusKind): string => TONE_TEXT[STATUS[kind].tone];

/** Readable word color per tone. */
export const TONE_TEXT: Readonly<Record<Tone, string>> = {
	idle: "text-fg-3",
	fg: "text-fg-2",
	running: "text-status-running-fg",
	waiting: "text-status-waiting-fg",
	success: "text-status-success-fg",
	failed: "text-status-failed-fg",
	cancelled: "text-fg-3",
};

const ring = (dash?: string) => <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dash} />;

function MarkShape({ kind }: { kind: StatusKind }) {
	switch (kind) {
		case "running":
			return (
				<>
					<circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
					<path className="dn-spin" d="M8 2.75a5.25 5.25 0 1 1-5.25 5.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</>
			);
		case "compiling":
			return (
				<>
					{ring("1.6 1.6")}
					<circle cx="8" cy="8" r="1.6" fill="currentColor" />
				</>
			);
		case "pending":
			return ring("2.2 2");
		case "ready":
			return ring();
		case "settling":
			return (
				<>
					{ring()}
					<circle cx="8" cy="8" r="1.75" fill="currentColor" />
				</>
			);
		case "waiting":
			return (
				<>
					{ring()}
					<path d="M6.6 6v4M9.4 6v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</>
			);
		case "retry":
			return (
				<>
					<path d="M12.6 6.2A5.25 5.25 0 1 0 13.25 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					<path d="M13.4 3.6v2.9h-2.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
				</>
			);
		case "done":
		case "verified":
			return (
				<>
					<circle cx="8" cy="8" r="6" fill="currentColor" />
					<path d="M5.4 8.2l1.8 1.8 3.5-3.7" fill="none" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
				</>
			);
		case "failed":
		case "blocked":
			return (
				<>
					<circle cx="8" cy="8" r="6" fill="currentColor" />
					<path d="M8 4.9v3.6" stroke="var(--surface)" strokeWidth="1.7" strokeLinecap="round" />
					<circle cx="8" cy="11" r="0.95" fill="var(--surface)" />
				</>
			);
		case "skipped":
		case "cancelled":
			return (
				<>
					{ring()}
					<path d="M5.2 10.8l5.6-5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</>
			);
		case "lastseen":
			return (
				<>
					{ring("2.2 2")}
					<path d="M6.7 6.6a1.4 1.4 0 1 1 1.9 1.3c-.4.2-.6.5-.6.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
					<circle cx="8" cy="10.9" r="0.75" fill="currentColor" />
				</>
			);
	}
}

/** The 16-unit status mark. `size` in px (default 14). */
export function StatusMark({ kind, size = 14, className, title }: { kind: StatusKind; size?: number; className?: string; title?: string }) {
	const ref = useRef<SVGSVGElement>(null);
	useAlignedLoops(ref, [kind], kind === "running");
	const meta = STATUS[kind];
	return (
		<svg
			ref={ref}
			data-slot="status-mark"
			data-status={kind}
			viewBox="0 0 16 16"
			width={size}
			height={size}
			role="img"
			aria-label={title ?? meta.label}
			className={cn("shrink-0", TONE_MARK[meta.tone], className)}
		>
			<MarkShape kind={kind} />
		</svg>
	);
}

/** Mark + word. `pill` adds the tone tint for chips in dense rows. */
export function StatusChip({ kind, label, variant = "inline", className }: { kind: StatusKind; label?: string; variant?: "inline" | "pill"; className?: string }) {
	const meta = STATUS[kind];
	const tint: Partial<Record<Tone, string>> = {
		running: "bg-status-running-tint",
		waiting: "bg-status-waiting-tint",
		success: "bg-status-success-tint",
		failed: "bg-status-failed-tint",
	};
	return (
		<span
			data-slot="status-chip"
			className={cn(
				"inline-flex min-w-0 items-center gap-1.5 text-xs font-medium",
				TONE_TEXT[meta.tone],
				variant === "pill" && cn("h-5.5 rounded-full pr-2 pl-1", tint[meta.tone] ?? "bg-hover"),
				className,
			)}
		>
			<StatusMark kind={kind} size={variant === "pill" ? 13 : 14} />
			<span className="truncate">{label ?? meta.label}</span>
		</span>
	);
}
