/** Public UI contract. Cookies and local transport credentials never cross this bridge. */
export interface BrowserTab { index: number; title: string; url: string; owned: boolean }
export interface BrowserViewState {
 connected: boolean; mode: "dedicated" | "attach"; control: "agent" | "user";
 tabs: BrowserTab[]; current: number; url: string; title: string;
 width: number; height: number; frame?: string;
 dialog?: { type: string; message: string };
}
export interface ChromeProfile { id: string; name: string }
export type BrowserUiAction = "state" | "frame" | "open" | "back" | "forward" | "reload" | "tab" | "close_tab" | "input" | "takeover" | "resume" | "profiles" | "import" | "dialog" | "close";
export interface BrowserReply { ok: boolean; error?: string; text?: string; state?: BrowserViewState; profiles?: ChromeProfile[]; imported?: number; skipped?: number }
export interface BrowserUiBridge { browserCall(action: BrowserUiAction, args?: Record<string, unknown>): Promise<BrowserReply> }
