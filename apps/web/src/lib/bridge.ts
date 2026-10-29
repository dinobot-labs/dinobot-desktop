import type { DesktopBridge } from "../../../desktop/src/bridge-types.ts";

declare global {
	interface Window {
		dinobotDesktop?: DesktopBridge;
	}
}

/** The Electron bridge, or undefined in a plain browser (vite dev). */
export const desktop: DesktopBridge | undefined = typeof window === "undefined" ? undefined : window.dinobotDesktop;
export const isDesktop = desktop !== undefined;
export const platform: string = desktop?.platform ?? (typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "darwin" : "web");
export type { DaemonConfig, DaemonStartResult, MenuCommand, StagedAttachment } from "../../../desktop/src/bridge-types.ts";
