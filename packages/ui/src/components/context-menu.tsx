import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cn } from "../lib/cn.ts";

export const ContextMenu = ContextMenuPrimitive.Root;

/** The right-click area. Renders a block `div` around its children unless `render` says otherwise. */
export function ContextMenuTrigger(props: ContextMenuPrimitive.Trigger.Props) {
	return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

/** Floating menu at the pointer: flat surface, one shadow, a small pop. Escape and outside clicks close it. */
export function ContextMenuPopup({ className, children, ...props }: ContextMenuPrimitive.Popup.Props) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Positioner className="z-50 outline-none">
				<ContextMenuPrimitive.Popup
					data-slot="context-menu"
					className={cn(
						"min-w-36 origin-(--transform-origin) rounded-md border border-line bg-surface p-1 text-sm text-fg shadow-pop outline-none transition-[opacity,scale] duration-(--dur-state) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
						className,
					)}
					{...props}
				>
					{children}
				</ContextMenuPrimitive.Popup>
			</ContextMenuPrimitive.Positioner>
		</ContextMenuPrimitive.Portal>
	);
}

/** One menu row; `tone="danger"` for destructive actions such as deleting. */
export function ContextMenuItem({ className, tone, ...props }: ContextMenuPrimitive.Item.Props & { tone?: "danger" }) {
	return (
		<ContextMenuPrimitive.Item
			data-slot="context-menu-item"
			className={cn(
				"flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-hover [&_svg]:size-4 [&_svg]:shrink-0",
				tone === "danger" ? "text-status-failed-fg" : "text-fg",
				className,
			)}
			{...props}
		/>
	);
}
