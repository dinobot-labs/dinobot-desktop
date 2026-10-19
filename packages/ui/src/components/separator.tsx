import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "../lib/cn.ts";

export function Separator({ className, orientation = "horizontal", ...props }: SeparatorPrimitive.Props) {
	return (
		<SeparatorPrimitive
			data-slot="separator"
			orientation={orientation}
			className={cn("shrink-0 bg-line", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
			{...props}
		/>
	);
}
