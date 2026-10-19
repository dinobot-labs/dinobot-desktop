import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * A centered dialog (`side="center"`) or a sheet sliding in from the right (`side="right"`). Flat surface, one
 * floating shadow, a scrim behind. Escape and outside clicks close it.
 */
export function DialogPopup({
	className,
	children,
	side = "center",
	heading,
	description,
	showClose = true,
	...props
}: DialogPrimitive.Popup.Props & { side?: "center" | "right" | "top"; heading?: ReactNode; description?: ReactNode; showClose?: boolean }) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-scrim transition-opacity duration-(--dur-state) data-ending-style:opacity-0 data-starting-style:opacity-0" />
			<DialogPrimitive.Popup
				data-slot="dialog"
				className={cn(
					"fixed z-50 flex flex-col border border-line bg-surface text-fg shadow-pop outline-none transition-[opacity,transform] duration-(--dur-enter) ease-(--motion-out) data-ending-style:opacity-0 data-starting-style:opacity-0",
					side === "center" && "top-1/2 left-1/2 max-h-[min(80vh,720px)] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-xl data-ending-style:scale-[0.98] data-starting-style:scale-[0.98]",
					side === "top" && "top-[12vh] left-1/2 max-h-[70vh] w-[min(92vw,620px)] -translate-x-1/2 rounded-xl data-ending-style:-translate-y-1 data-starting-style:-translate-y-1",
					side === "right" && "top-0 right-0 bottom-0 w-[min(92vw,640px)] border-y-0 border-r-0 data-ending-style:translate-x-6 data-starting-style:translate-x-6",
					className,
				)}
				{...props}
			>
				{heading || showClose ? (
					<div className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
						<div className="min-w-0 flex-1">
							{heading ? <DialogPrimitive.Title className="text-lg font-semibold tracking-[-0.01em]">{heading}</DialogPrimitive.Title> : null}
							{description ? <DialogPrimitive.Description className="mt-0.5 text-sm text-fg-3">{description}</DialogPrimitive.Description> : null}
						</div>
						{showClose ? (
							<DialogPrimitive.Close aria-label="닫기" className="-mr-1.5 flex size-7 cursor-pointer items-center justify-center rounded-sm text-fg-3 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
								<IconX size={16} />
							</DialogPrimitive.Close>
						) : null}
					</div>
				) : null}
				{children}
			</DialogPrimitive.Popup>
		</DialogPrimitive.Portal>
	);
}
