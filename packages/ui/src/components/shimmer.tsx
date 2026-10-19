import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { useRef } from "react";
import { cn } from "../lib/cn.ts";
import { useAlignedLoops } from "../lib/animation-sync.ts";

export interface ShimmerProps extends useRender.ComponentProps<"span"> {
	/** Sweep the brand signal instead of a lighter ink. */
	signal?: boolean;
	/** Turn the sweep off without unmounting (e.g. the step finished). */
	active?: boolean;
}

/**
 * A light band sweeping across a one-line status label ("Thinking", "Running bun test"). Stepped at 20 fps and
 * phase-locked to the document timeline so every shimmer on screen repaints together. Stops under reduced motion.
 */
export function Shimmer({ signal = false, active = true, className, render, ...props }: ShimmerProps) {
	const ref = useRef<HTMLSpanElement>(null);
	useAlignedLoops(ref, [active, signal], active);
	const defaultProps = {
		"data-slot": "shimmer",
		className: cn("inline-block whitespace-nowrap", active && "shimmer", active && signal && "shimmer-signal", className),
	};
	return useRender({ defaultTagName: "span", render, ref, props: mergeProps<"span">(defaultProps, props) });
}
