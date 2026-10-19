import { useRef } from "react";
import { cn } from "../lib/cn.ts";
import { useAlignedLoops } from "../lib/animation-sync.ts";

const DOTS = Array.from({ length: 8 }, (_, i) => {
	const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
	return { cx: 8 + Math.cos(a) * 5.5, cy: 8 + Math.sin(a) * 5.5, o: 0.18 + (i / 7) * 0.82 };
});

/** The dot spinner: eight dots of the dot language, stepped rotation (1.3 s / 26 steps). */
export function Spinner({ className, size = 16, label = "Loading" }: { className?: string; size?: number; label?: string }) {
	const ref = useRef<SVGSVGElement>(null);
	useAlignedLoops(ref);
	return (
		<svg ref={ref} role="status" aria-label={label} viewBox="0 0 16 16" width={size} height={size} className={cn("shrink-0", className)}>
			<g className="dn-spin" fill="currentColor">
				{DOTS.map((d, i) => (
					<circle key={i} cx={d.cx} cy={d.cy} r={1.35} opacity={d.o} />
				))}
			</g>
		</svg>
	);
}
