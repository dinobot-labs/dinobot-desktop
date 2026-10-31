import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "../lib/cn.ts";

export const Popover = PopoverPrimitive.Root;

/** Anchored overlay outside scrolling ancestors; positioning tracks scroll and resize. */
export function PopoverPopup({
	anchor,
	className,
	children,
	...props
}: PopoverPrimitive.Popup.Props & { anchor: PopoverPrimitive.Positioner.Props["anchor"] }) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner anchor={anchor} side="top" align="start" sideOffset={8} positionMethod="fixed" className="z-50 w-(--anchor-width) max-w-(--available-width) data-[anchor-hidden]:invisible">
				<PopoverPrimitive.Popup className={cn("max-h-[min(18rem,var(--available-height))] overflow-y-auto rounded-lg border border-line bg-surface shadow-float", className)} {...props}>
					{children}
				</PopoverPrimitive.Popup>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}
