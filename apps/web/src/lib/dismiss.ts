/**
 * App dialogs are separate portals, so a click inside a dialog opened on top (login card, command run, picker, toast)
 * counts as an "outside press" for the dialog underneath. Ignore those so stacked dialogs behave like a stack.
 */
export function ignoreStackedPress(details: { reason?: string; event?: Event } | undefined): boolean {
	if (details?.reason !== "outside-press") return false;
	const target = details.event?.target as Element | null | undefined;
	return Boolean(target?.closest?.('[data-slot="dialog"], [data-slot="picker"], [data-slot="toaster"]'));
}
