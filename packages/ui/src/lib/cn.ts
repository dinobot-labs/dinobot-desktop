import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge that knows the design system's custom text sizes and shadows. */
const merge = extendTailwindMerge({
	extend: {
		theme: {
			text: ["micro", "xs", "sm", "md", "lg", "xl", "2xl", "display"],
			shadow: ["float", "pop"],
		},
	},
});

export function cn(...inputs: ClassValue[]): string {
	return merge(clsx(inputs));
}
