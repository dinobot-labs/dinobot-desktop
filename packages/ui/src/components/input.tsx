import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

const field =
	"w-full min-w-0 rounded-md border border-line-strong bg-surface text-fg outline-none transition-[border-color] duration-(--dur-micro) placeholder:text-fg-3 hover:border-line-ui focus-visible:border-focus focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-deep";

export function Input({ className, ...props }: ComponentProps<"input">) {
	return <input data-slot="input" className={cn(field, "h-8 px-2.5 text-sm", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
	return <textarea data-slot="textarea" className={cn(field, "min-h-20 resize-y px-2.5 py-2 text-sm leading-[var(--lh-ui)]", className)} {...props} />;
}
