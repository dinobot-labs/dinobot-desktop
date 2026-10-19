import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from "electron";
import type { MenuCommand } from "./bridge-types.ts";
import { cachedConfig, daemonLogPath, readDaemonConfig, setBundledDaemonDir } from "./daemon.ts";
import { ensureDaemon } from "./daemon-ensure.ts";
import { registerFeatureIpc } from "./ipc-features.ts";
import { DesktopBrowser } from "./features/browser/runtime.ts";
import { trustedBrowserSender } from "./features/browser/trust.ts";
import { loadWindowState, trackWindowState } from "./window-state.ts";

/**
 * Main process. The renderer is served from dinobot-app://app/ (packaged) or the Vite dev server (DINOBOT_DESKTOP_DEV_URL).
 * Daemon traffic goes through dinobot-app://app/daemon/* -> http://127.0.0.1:<api.port>/*, so the renderer stays
 * same-origin (no CORS, no private-network preflights) and the daemon API stays loopback-only.
 */
const SCHEME = "dinobot-app";
const DEV_URL = process.env.DINOBOT_DESKTOP_DEV_URL;
const TITLEBAR_HEIGHT = 40;

protocol.registerSchemesAsPrivileged([
	{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } },
]);

// Perf harness (qa/perf.mjs): uncap the frame rate so frame-time headroom above the display refresh is measurable,
// and record main-process event-loop delay so a blocked loop shows up.
if (process.env.DINOBOT_PERF === "1") {
	app.commandLine.appendSwitch("disable-frame-rate-limit");
	app.commandLine.appendSwitch("disable-gpu-vsync");
	const histogram = monitorEventLoopDelay({ resolution: 10 });
	histogram.enable();
	(globalThis as { __dinobotPerf?: unknown }).__dinobotPerf = {
		reset: () => histogram.reset(),
		stats: () => ({ maxMs: histogram.max / 1e6, p99Ms: histogram.percentile(99) / 1e6, meanMs: histogram.mean / 1e6, count: histogram.count }),
	};
}

// QA runs use their own profile so they never share the single-instance lock or settings with the person's app.
if (process.env.DINOBOT_USER_DATA) app.setPath("userData", process.env.DINOBOT_USER_DATA);

if (process.env.DINOBOT_PERF !== "1" && !app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let desktopBrowser: DesktopBrowser | null = null;
let browserQuitting = false;
// app.getAppPath(): apps/desktop in development, resources/app.asar when packaged. (Bundlers may inline __dirname.)
const appRoot = () => app.getAppPath();
const webRoot = () => (app.isPackaged ? join(process.resourcesPath, "web") : join(appRoot(), "..", "web", "dist"));

function sendMenu(command: MenuCommand) {
	win?.webContents.send("menu:command", command);
}

function buildMenu() {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [
		...(isMac ? [{ role: "appMenu" as const }] : []),
		{
			label: "File",
			submenu: [
				{ label: "New thread", accelerator: "CmdOrCtrl+N", click: () => sendMenu("new-thread") },
				{ label: "Command palette", accelerator: "CmdOrCtrl+K", click: () => sendMenu("command-palette") },
				{ type: "separator" },
				{ label: "Settings", accelerator: "CmdOrCtrl+,", click: () => sendMenu("settings") },
				{ type: "separator" },
				isMac ? { role: "close" } : { role: "quit" },
			],
		},
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [
				{ label: "Toggle work panel", accelerator: "CmdOrCtrl+B", click: () => sendMenu("toggle-panel") },
				{ type: "separator" },
				{ role: "reload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{ role: "windowMenu" },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerProtocol() {
	protocol.handle(SCHEME, async (request) => {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/daemon/")) {
			// Sandboxed artifact frames have an opaque origin ("null"): they never reach the daemon.
			if (request.headers.get("origin") === "null") return Response.json({ error: "forbidden" }, { status: 403 });
			const port = (cachedConfig() ?? (await readDaemonConfig())).port;
			const target = `http://127.0.0.1:${port}${url.pathname.slice("/daemon".length)}${url.search}`;
			const init: RequestInit & { duplex?: "half" } = { method: request.method, headers: request.headers, signal: request.signal };
			if (request.method !== "GET" && request.method !== "HEAD") {
				init.body = await request.arrayBuffer();
			}
			try {
				return await net.fetch(target, init);
			} catch (error) {
				return Response.json({ error: `daemon unreachable: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
			}
		}
		const root = webRoot();
		let file = normalize(join(root, decodeURIComponent(url.pathname)));
		if (!file.startsWith(root) || url.pathname === "/" || !existsSync(file)) file = join(root, "index.html");
		return net.fetch(pathToFileURL(file).toString());
	});
}

function createWindow() {
	const state = loadWindowState();
	const dark = nativeTheme.shouldUseDarkColors;
	win = new BrowserWindow({
		...(state.centered ? { width: state.bounds.width, height: state.bounds.height } : state.bounds),
		minWidth: 760,
		minHeight: 520,
		show: false,
		title: "dinobot",
		backgroundColor: dark ? "#141615" : "#f9fbfa",
		titleBarStyle: "hidden",
		...(process.platform === "darwin"
			? { trafficLightPosition: { x: 14, y: 13 } }
			: { titleBarOverlay: { color: dark ? "#191c1b" : "#f3f6f5", symbolColor: dark ? "#ecf0ee" : "#141515", height: TITLEBAR_HEIGHT } }),
		icon: join(appRoot(), "build", "icon.png"),
		webPreferences: {
			preload: join(appRoot(), "dist", "preload.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			spellcheck: false,
		},
	});
	if (state.maximized) win.maximize();
	trackWindowState(win);
	win.once("ready-to-show", () => win?.show());
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(`${SCHEME}://app/`);
		if (!allowed) {
			event.preventDefault();
			if (/^https?:\/\//.test(url)) void shell.openExternal(url);
		}
	});
	// Artifact frames (about:srcdoc) stay put: their links open in the browser instead of replacing the frame.
	win.webContents.on("will-frame-navigate", (details) => {
		if (details.isMainFrame || details.url.startsWith("about:srcdoc") || details.url === "about:blank") return;
		details.preventDefault();
		if (/^https?:\/\//.test(details.url)) void shell.openExternal(details.url);
	});
	win.on("closed", () => {
		win = null;
	});
	void win.loadURL(DEV_URL ?? `${SCHEME}://app/`);
}

/** `--thread <name>`, `--resume`, `--setup [section]` from the command line (packaged or `electron . --thread x`). */
function launchArgs(argv: string[]): { thread?: string; setup?: string } {
	const out: { thread?: string; setup?: string } = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if ((a === "--thread" || a === "-t") && argv[i + 1]) out.thread = argv[++i];
		else if (a === "--resume" || a === "-r") out.thread ??= "main";
		else if (a === "--setup") out.setup = argv[i + 1] && !argv[i + 1]?.startsWith("-") ? (argv[++i] as string) : "";
	}
	return out;
}

function registerIpc() {
	ipcMain.handle("browser:call", (event, action: unknown, args: unknown) => {
		if (!trustedBrowserSender(event, win, DEV_URL)) return { ok: false, error: "Forbidden: browser access is limited to the app main frame." };
		return desktopBrowser?.call(action, args ?? {}) ?? { ok: false, error: "BrowserClosed: desktop is shutting down." };
	});
	ipcMain.on("app:launch", (event) => {
		event.returnValue = launchArgs(process.argv.slice(1));
	});
	ipcMain.on("app:version", (event) => {
		event.returnValue = app.getVersion();
	});
	ipcMain.handle("daemon:config", () => readDaemonConfig());
	ipcMain.handle("daemon:start", () => ensureDaemon());
	ipcMain.handle("daemon:open-log", async () => {
		const { dataDir } = cachedConfig() ?? (await readDaemonConfig());
		if (dataDir) await shell.openPath(daemonLogPath(dataDir));
	});
	ipcMain.handle("dialog:pick-directory", async () => {
		if (!win) return null;
		const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
		return result.canceled ? null : (result.filePaths[0] ?? null);
	});
	ipcMain.handle("shell:open-external", async (_event, url: unknown) => {
		if (typeof url === "string" && /^https?:\/\//.test(url)) await shell.openExternal(url);
	});
	ipcMain.on("window:titlebar-theme", (_event, theme: { background?: unknown; foreground?: unknown }) => {
		if (!win || process.platform === "darwin") return;
		if (typeof theme?.background !== "string" || typeof theme.foreground !== "string") return;
		try {
			win.setTitleBarOverlay({ color: theme.background, symbolColor: theme.foreground, height: TITLEBAR_HEIGHT });
			win.setBackgroundColor(theme.background);
		} catch {}
	});
	ipcMain.on("app:badge", (_event, count: unknown) => {
		const n = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
		app.setBadgeCount(n);
		if (process.platform === "win32" && win) win.flashFrame(n > 0 && !win.isFocused());
	});
}

app.on("second-instance", () => {
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.focus();
});

/** The daemon that ships with the app: resources/daemon when packaged, the staged vendor/daemon/<os>-<arch> in development. */
function bundledDaemonDir(): string {
	if (app.isPackaged) return join(process.resourcesPath, "daemon");
	const os = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
	return join(appRoot(), "vendor", "daemon", `${os}-${process.arch}`);
}

app.whenReady().then(async () => {
	setBundledDaemonDir(bundledDaemonDir());
	await readDaemonConfig();
	// Start (or find) the daemon while the window loads; the renderer's first connect joins this same run.
	void ensureDaemon();
	app.setAppUserModelId("dev.dinobot.desktop");
	registerProtocol();
	desktopBrowser = new DesktopBrowser(appRoot());
	registerIpc();
	registerFeatureIpc();
	buildMenu();
	createWindow();
	// Publish the local broker before the first agent/browser-tab action. ui_state is metadata-only: Chrome remains lazy.
	void desktopBrowser.call("state");
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("before-quit", (event) => {
	if (!desktopBrowser || browserQuitting) return;
	event.preventDefault();
	browserQuitting = true;
	const browser = desktopBrowser;
	desktopBrowser = null;
	void browser.close().catch(() => {}).finally(() => app.quit());
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
