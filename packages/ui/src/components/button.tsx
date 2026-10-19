import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

/**
 * Variant taxonomy: filled (primary ink, signal, danger), outlined (secondary),
 * ghostly (ghost, subtle). Flat: color + hairline + hover fill only, no shadows. Text sizes pair with square icon
 * sizes of the same height so text and icon buttons share a toolbar baseline.
 */
export const buttonVariants = cva(
	"relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium outline-none transition-[background-color,border-color,color,transform] duration-(--dur-micro) active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				primary: "border-transparent bg-inverse text-fg-inverse hover:bg-[color-mix(in_oklch,var(--surface-inverse)_86%,var(--surface))]",
				signal: "border-transparent bg-accent text-[var(--n-12)] dark:text-[#141515] hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--n-12))]",
				secondary: "border-line-strong bg-surface text-fg hover:bg-hover",
				ghost: "border-transparent bg-transparent text-fg-2 hover:bg-hover hover:text-fg data-[pressed]:bg-pressed",
				subtle: "border-transparent bg-hover text-fg hover:bg-pressed",
				danger: "border-transparent bg-red-deep text-white hover:bg-[color-mix(in_oklch,var(--red-deep)_88%,black)] dark:bg-red dark:text-[#141515]",
				link: "h-auto border-transparent px-0 text-accent-deep underline-offset-4 hover:underline",
			},
			size: {
				xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
				sm: "h-7 px-2.5 text-sm",
				md: "h-8 px-3 text-sm",
				lg: "h-10 px-4 text-md",
				"icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
				"icon-sm": "size-7",
				icon: "size-8",
				"icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-5",
			},
			shape: { default: "", pill: "rounded-full" },
		},
		defaultVariants: { variant: "secondary", size: "md", shape: "default" },
	},
);

export interface ButtonProps extends useRender.ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, shape, render, ...props }: ButtonProps) {
	const defaultProps = {
		className: cn(buttonVariants({ variant, size, shape }), className),
		"data-slot": "button",
		type: render ? undefined : ("button" as const),
	};
	return useRender({ defaultTagName: "button", render, props: mergeProps<"button">(defaultProps, props) });
}
