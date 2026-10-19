import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "../lib/cn.ts";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, children, ...props }: TabsPrimitive.List.Props) {
	return (
		<TabsPrimitive.List data-slot="tabs-list" className={cn("relative z-0 inline-flex h-8 items-center gap-0.5 rounded-md bg-hover p-0.5", className)} {...props}>
			{children}
			<TabsPrimitive.Indicator className="absolute top-0.5 left-(--active-tab-left) -z-1 h-(--active-tab-height) w-(--active-tab-width) rounded-sm border border-line bg-surface transition-[left,width] duration-(--dur-state) ease-(--motion-standard)" />
		</TabsPrimitive.List>
	);
}

export function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-tab"
			className={cn("inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium text-fg-3 outline-none transition-colors hover:text-fg data-[selected]:text-fg focus-visible:outline-2 focus-visible:outline-focus [&_svg]:size-3.5", className)}
			{...props}
		/>
	);
}

export function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
	return <TabsPrimitive.Panel data-slot="tabs-panel" className={cn("outline-none", className)} {...props} />;
}
