import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TooltipProvider } from "@dinobot/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useSettings } from "../../src/lib/settings.ts";
import { usePanelTab } from "../../src/panel/Artifacts.tsx";
import { BrowserEntry, toggleBrowserPanel } from "../../src/panel/BrowserEntry.tsx";

const initialSettings = useSettings.getState();
const initialTabs = usePanelTab.getState();
beforeEach(() => {
	useSettings.setState(initialSettings);
	usePanelTab.setState(initialTabs);
});
afterEach(() => {
	useSettings.setState(initialSettings);
	usePanelTab.setState(initialTabs);
});

describe("globe entry state transitions use the existing panel owners", () => {
	for (const tab of ["work", "artifacts", "browser"] as const) {
		for (const panelOpen of [false, true]) {
			test(`${tab}, open=${panelOpen}: selects browser unless it is already visible`, () => {
				useSettings.setState({ panelOpen, panelWidth: 555 });
				usePanelTab.getState().set(tab);
				const before = useSettings.getState();
				toggleBrowserPanel(true);
				expect(usePanelTab.getState().tab).toBe("browser");
				expect(useSettings.getState()).toEqual({ ...before, panelOpen: !(panelOpen && tab === "browser") });
			});
			test(`${tab}, open=${panelOpen}: unavailable entry cannot change panel or tab`, () => {
				useSettings.setState({ panelOpen });
				usePanelTab.getState().set(tab);
				const before = useSettings.getState();
				toggleBrowserPanel(false);
				expect(useSettings.getState()).toBe(before);
				expect(usePanelTab.getState().tab).toBe(tab);
			});
		}
	}
	test("repeated activation reads current state, and reopening keeps the browser selected", () => {
		for (const expected of [true, false, true, false]) {
			toggleBrowserPanel(true);
			expect(useSettings.getState().panelOpen).toBe(expected);
			expect(usePanelTab.getState().tab).toBe("browser");
		}
	});
});

const markup = (activeKey: string | null, online: boolean) => renderToStaticMarkup(createElement(TooltipProvider, null, createElement(BrowserEntry, { activeKey, online })));
describe("discoverable and accessible globe", () => {
	test("uses the shared icon button with a stable accessible name", () => {
		const html = markup("tui:fixture", true);
		expect(html).toContain('aria-label="브라우저"');
		expect(html).toContain('aria-pressed="false"');
		expect(html).toContain('aria-disabled="false"');
		expect(html).toContain("icon-world");
		expect(html).toContain("size-7");
	});
	for (const [activeKey, online, reason] of [
		[null, true, "대화를 선택하면 브라우저를 열 수 있어요"],
		[null, false, "대화를 선택하면 브라우저를 열 수 있어요"],
		["tui:fixture", false, "데몬에 연결한 뒤 브라우저를 열 수 있어요"],
	] as const) {
		test(`visible disabled globe explains unavailable state: ${activeKey}, online=${online}`, () => {
			const html = markup(activeKey, online);
			expect(html).toContain('data-testid="browser-entry"');
			expect(html).toContain('aria-disabled="true"');
			expect(html).toContain(`aria-description="${reason}"`);
			expect(html).toContain('aria-pressed="false"');
		});
	}
});
