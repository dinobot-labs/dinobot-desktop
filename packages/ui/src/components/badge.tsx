import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

export const badgeVariants = cva(
	"inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium [&_svg]:size-3 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				neutral: "bg-hover text-fg-2",
				outline: "border border-line-strong text-fg-2",
				signal: "bg-accent-tint text-accent-deep",
				solid: "bg-accent text-[#141515]",
				ink: "bg-inverse text-fg-inverse",
				running: "bg-status-running-tint text-status-running-fg",
				waiting: "bg-status-waiting-tint text-status-waiting-fg",
				success: "bg-status-success-tint text-status-success-fg",
				failed: "bg-status-failed-tint text-status-failed-fg",
			},
			shape: { pill: "", tag: "rounded-xs px-1.5 font-mono text-micro uppercase tracking-[0.06em]" },
		},
		defaultVariants: { variant: "neutral", shape: "pill" },
	},
);

export interface BadgeProps extends useRender.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, shape, render, ...props }: BadgeProps) {
	const defaultProps = { className: cn(badgeVariants({ variant, shape }), className), "data-slot": "badge" };
	return useRender({ defaultTagName: "span", render, props: mergeProps<"span">(defaultProps, props) });
}
