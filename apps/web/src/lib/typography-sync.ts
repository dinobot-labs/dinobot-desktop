import { useSettings } from "./settings.ts";
import { applyTypography } from "./typography.ts";

/** Apply before React paints, then subscribe to the existing settings owner. */
export function startTypographySync(style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">): () => void {
	applyTypography(style, useSettings.getState());
	return useSettings.subscribe((next, previous) => {
		if (next.fontFamily !== previous.fontFamily || next.fontSize !== previous.fontSize) applyTypography(style, next);
	});
}
