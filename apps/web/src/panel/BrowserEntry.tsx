import { Button, cn, Tooltip } from "@dinobot/ui";
import { IconWorld } from "@tabler/icons-react";
import { useSettings } from "../lib/settings.ts";
import { usePanelTab } from "./Artifacts.tsx";

/** Select the existing browser view, or collapse it if already visible. No browser or conversation is created here. */
export function toggleBrowserPanel(enabled: boolean): void {
	if (!enabled) return;
	const panel = useSettings.getState();
	const tabs = usePanelTab.getState();
	if (panel.panelOpen && tabs.tab === "browser") {
		panel.set({ panelOpen: false });
	} else {
		tabs.set("browser");
		panel.set({ panelOpen: true });
	}
}

/** Always discoverable in app chrome; unavailable states stay focusable so their reason can be read. */
export function BrowserEntry({ activeKey, online }: { activeKey: string | null; online: boolean }) {
	const panelOpen = useSettings((s) => s.panelOpen);
	const tab = usePanelTab((s) => s.tab);
	const enabled = Boolean(activeKey) && online;
	const pressed = enabled && panelOpen && tab === "browser";
	const hint = !activeKey ? "대화를 선택하면 브라우저를 열 수 있어요" : !online ? "데몬에 연결한 뒤 브라우저를 열 수 있어요" : pressed ? "브라우저 닫기" : "브라우저 열기";
	return (
		<Tooltip content={hint}>
			<Button
				variant="ghost"
				size="icon-sm"
				data-testid="browser-entry"
				aria-label="브라우저"
				aria-pressed={pressed}
				aria-disabled={!enabled}
				aria-description={!enabled ? hint : undefined}
				className={cn("aria-disabled:cursor-not-allowed aria-disabled:opacity-50", pressed && "bg-pressed text-fg")}
				onClick={() => toggleBrowserPanel(enabled)}
			>
				<IconWorld aria-hidden="true" />
			</Button>
		</Tooltip>
	);
}
