import { cn, StatusMark } from "@dinobot/ui";
import type { PluginView } from "../state/plugins.ts";
import { IconBrandGithub, IconBrandGoogle, IconBrowser, IconCompass, IconDeviceDesktop, IconPhotoSpark, IconPlug, IconPlugConnected, IconSparkles, IconWorldSearch } from "@tabler/icons-react";
import type { ComponentType } from "react";

const ICONS: Record<string, ComponentType<{ className?: string; stroke?: number }>> = {
	web: IconWorldSearch,
	image_gen: IconPhotoSpark,
	browser: IconBrowser,
	computer: IconDeviceDesktop,
	google: IconBrandGoogle,
	github: IconBrandGithub,
	mcp: IconPlugConnected,
	aside: IconCompass,
	skills: IconSparkles,
};

/** "켜짐" / "꺼짐" with a status mark: status is never color alone. */
export function PluginState({ view }: { view: Pick<PluginView, "enabled"> }) {
	return (
		<span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", view.enabled ? "text-status-success-fg" : "text-fg-3")} data-testid="plugin-state" data-state={view.enabled ? "on" : "off"}>
			<StatusMark kind={view.enabled ? "done" : "pending"} size={12} />
			{view.enabled ? "켜짐" : "꺼짐"}
		</span>
	);
}

/**
 * Plugin tile: flat, hairline ring. On: accent tint fill and accent-deep glyph (the one brand signal of the card).
 * Off: sunken fill and muted glyph. Size in px: 40 on cards, 56 in the detail header.
 */
export function PluginIcon({ id, enabled, size = 40 }: { id: string; enabled: boolean; size?: 40 | 56 }) {
	const Icon = ICONS[id] ?? IconPlug;
	return (
		<span
			aria-hidden="true"
			data-testid="plugin-icon"
			data-state={enabled ? "on" : "off"}
			className={cn(
				"flex shrink-0 items-center justify-center border",
				size === 56 ? "size-14 rounded-xl" : "size-10 rounded-lg",
				enabled ? "border-accent/40 bg-accent-tint text-accent-deep" : "border-line bg-sunken text-fg-3",
			)}
		>
			<Icon className={size === 56 ? "size-7" : "size-5"} stroke={1.75} />
		</span>
	);
}
