/** The browser bridge is a capability of the app main frame, never artifacts, guest pages or another window. */
export function trustedBrowserSender(event: { sender: unknown; senderFrame: { url: string } | null }, window: { webContents: { mainFrame: { url: string } } } | null, devUrl?: string): boolean {
 if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
 try {
  const url = new URL(event.senderFrame.url);
  if (devUrl) { const dev = new URL(devUrl); return ["http:", "https:"].includes(dev.protocol) && url.origin === dev.origin; }
  return url.protocol === "dinobot-app:" && url.hostname === "app" && url.port === "" && url.username === "" && url.password === "";
 } catch { return false; }
}
