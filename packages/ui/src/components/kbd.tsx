import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd"
			className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-strong border-b-2 bg-surface px-1 font-mono text-micro text-fg-2", className)}
			{...props}
		/>
	);
}
