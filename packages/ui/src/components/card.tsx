import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

/** Flat card: surface + hairline ring, 12px radius. `sunken` for wells, `interactive` for clickable cards. */
export function Card({ className, variant = "default", ...props }: ComponentProps<"div"> & { variant?: "default" | "sunken" | "interactive" }) {
	return (
		<div
			data-slot="card"
			className={cn(
				"rounded-lg border border-line text-fg",
				variant === "sunken" ? "bg-sunken" : "bg-surface",
				variant === "interactive" && "cursor-pointer transition-colors duration-(--dur-micro) hover:border-line-strong hover:bg-hover",
				className,
			)}
			{...props}
		/>
	);
}
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
	return <div data-slot="card-header" className={cn("flex flex-col gap-1 px-4 pt-4", className)} {...props} />;
}
export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
	return <h3 data-slot="card-title" className={cn("text-md font-semibold tracking-[-0.01em]", className)} {...props} />;
}
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
	return <p data-slot="card-description" className={cn("text-sm text-fg-2", className)} {...props} />;
}
export function CardBody({ className, ...props }: ComponentProps<"div">) {
	return <div data-slot="card-body" className={cn("px-4 py-3", className)} {...props} />;
}
export function CardFooter({ className, ...props }: ComponentProps<"div">) {
	return <div data-slot="card-footer" className={cn("flex items-center gap-2 border-t border-line px-4 py-3", className)} {...props} />;
}
