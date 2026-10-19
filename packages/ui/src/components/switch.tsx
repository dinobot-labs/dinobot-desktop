import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../lib/cn.ts";

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn("relative inline-flex h-5 w-8.5 shrink-0 cursor-pointer items-center rounded-full bg-line-strong p-0.5 transition-colors duration-(--dur-state) data-[checked]:bg-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus", className)}
			{...props}
		>
			<SwitchPrimitive.Thumb className="size-4 rounded-full bg-surface transition-transform duration-(--dur-state) ease-(--spring-snappy) data-[checked]:translate-x-3.5 dark:bg-[var(--n-12)] dark:data-[checked]:bg-[var(--n-1)]" />
		</SwitchPrimitive.Root>
	);
}
