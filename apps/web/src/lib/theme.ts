import type { SpeciesId } from "@dinobot/ui/brand";
import { useEffect } from "react";
import { desktop } from "./bridge.ts";
import { useSettings } from "./settings.ts";

/**
 * Applies the theme setting to <html class="dark"> and the dinosaur theme (ADR 0100) to <html data-dino>, then
 * repaints the native caption buttons from the resulting band and ink: both change the surfaces, so both repaint.
 */
export function useThemeSync(): void {
	const theme = useSettings((s) => s.theme);
	const dino = useSettings((s) => s.dino);
	useEffect(() => {
		const media = matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const dark = theme === "dark" || (theme === "system" && media.matches);
			document.documentElement.classList.toggle("dark", dark);
			document.documentElement.dataset.dino = dino;
			const css = getComputedStyle(document.documentElement);
			desktop?.setTitleBarTheme({ background: css.getPropertyValue("--bg-band").trim() || (dark ? "#191c1b" : "#f3f6f5"), foreground: css.getPropertyValue("--text-1").trim() || (dark ? "#ecf0ee" : "#141515") });
		};
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [theme, dino]);
}

/** The dinosaur theme for the mascot context; useThemeSync puts it on <html data-dino> for tokens.css. */
export function useDinoSync(): SpeciesId {
	return useSettings((s) => s.dino);
}
