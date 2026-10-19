import { cn } from "../lib/cn.ts";

export type MeterTone = "neutral" | "accent" | "warning" | "danger";

/**
 * A flat horizontal bar. `value` is 0..1 of the filled part. Tone follows thresholds when `thresholds` is given
 * (fraction used: >= warn amber, >= danger coral), else stays neutral ink. Transform-only animation.
 */
export function Meter({
	value,
	tone,
	thresholds,
	className,
	label,
	size = "md",
}: {
	value: number;
	tone?: MeterTone;
	thresholds?: { warn: number; danger: number; of?: "value" | "rest" };
	className?: string;
	label?: string;
	size?: "sm" | "md";
}) {
	const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
	const used = thresholds?.of === "rest" ? 1 - v : v;
	const t: MeterTone = tone ?? (thresholds ? (used >= thresholds.danger ? "danger" : used >= thresholds.warn ? "warning" : "neutral") : "neutral");
	const fill = { neutral: "bg-inverse", accent: "bg-accent", warning: "bg-status-running", danger: "bg-status-failed" }[t];
	return (
		<div
			role="meter"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(v * 100)}
			aria-label={label}
			data-tone={t}
			className={cn("relative w-full overflow-hidden rounded-full bg-hover", size === "sm" ? "h-1" : "h-1.5", className)}
		>
			<div className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-(--dur-state) ease-(--motion-standard)", fill)} style={{ transform: `scaleX(${v})` }} />
		</div>
	);
}

/** Context window meter (TUI header): used / window with the same color stops (blue from 50%, amber from 75%, coral from 95%). */
export function ContextMeter({ used, window, className }: { used: number; window?: number | undefined; className?: string }) {
	const fraction = window ? used / window : 0;
	const tone: MeterTone = !window ? "neutral" : fraction >= 0.95 ? "danger" : fraction >= 0.75 ? "warning" : fraction >= 0.5 ? "accent" : "neutral";
	return (
		<div className={cn("flex min-w-0 items-center gap-2", className)} data-slot="context-meter" title={window ? `컨텍스트 ${Math.round(fraction * 100)}% 사용` : "컨텍스트 토큰"}>
			{window ? <Meter value={fraction} tone={tone} size="sm" className="w-16" label="context" /> : null}
			<span className="shrink-0 font-mono text-micro tabular-nums text-fg-3">
				{formatShort(used)}
				{window ? ` / ${formatShort(window)}` : ""}
			</span>
		</div>
	);
}
const formatShort = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
