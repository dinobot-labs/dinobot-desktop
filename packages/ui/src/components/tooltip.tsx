import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;

export function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/** Ink tooltip: the one inverse surface, 12px text, a small pop. */
export function TooltipPopup({
	className,
	side = "top",
	sideOffset = 6,
	align = "center",
	children,
	...props
}: TooltipPrimitive.Popup.Props & {
	side?: TooltipPrimitive.Positioner.Props["side"];
	sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
	align?: TooltipPrimitive.Positioner.Props["align"];
}) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="z-50">
				<TooltipPrimitive.Popup
					data-slot="tooltip-popup"
					className={cn(
						"max-w-72 origin-(--transform-origin) rounded-sm bg-inverse px-2 py-1 text-xs text-fg-inverse shadow-float transition-[opacity,scale] duration-(--dur-state) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
						className,
					)}
					{...props}
				>
					{children}
				</TooltipPrimitive.Popup>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	);
}

/** Convenience: wrap one element with a text tooltip. */
export function Tooltip({ content, children, side }: { content: ReactNode; children: TooltipPrimitive.Trigger.Props["render"]; side?: TooltipPrimitive.Positioner.Props["side"] }) {
	return (
		<TooltipRoot>
			<TooltipTrigger render={children} />
			<TooltipPopup side={side}>{content}</TooltipPopup>
		</TooltipRoot>
	);
}
