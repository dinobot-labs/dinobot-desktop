import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, MenuCommand } from "./bridge-types.ts";

const bridge: DesktopBridge = {
	browserCall: (action, args) => ipcRenderer.invoke("browser:call", action, args ?? {}),
	platform: process.platform,
	launch: ipcRenderer.sendSync("app:launch") as DesktopBridge["launch"],
	version: String(ipcRenderer.sendSync("app:version")),
	locale: String(ipcRenderer.sendSync("app:locale")),
	gitBranch: (cwd) => ipcRenderer.invoke("git:branch", cwd),
	refsComplete: (cwd, token) => ipcRenderer.invoke("refs:complete", cwd, token),
	refsExpand: (cwd, text, opts) => ipcRenderer.invoke("refs:expand", cwd, text, opts ?? {}),
	clipboardImage: () => ipcRenderer.invoke("clipboard:image"),
	clipboardFilePaths: () => ipcRenderer.invoke("clipboard:file-paths"),
	readImageFile: (path) => ipcRenderer.invoke("image:read-file", path),
	artifactStat: (paths) => ipcRenderer.invoke("artifact:stat", paths),
	artifactRead: (path) => ipcRenderer.invoke("artifact:read", path),
	artifactOpen: (path, how) => ipcRenderer.invoke("artifact:open", path, how),
	checkUpdate: (current) => ipcRenderer.invoke("update:check", current),
	checkDesktopUpdate: () => ipcRenderer.invoke("desktop-update:check"),
	applyDesktopUpdate: () => ipcRenderer.invoke("desktop-update:apply"),
	setupApply: (request, daemon, port) => ipcRenderer.invoke("setup:apply", request, daemon, port),
	setupRecover: () => ipcRenderer.invoke("setup:recover"),
	daemonConfig: () => ipcRenderer.invoke("daemon:config"),
	startDaemon: () => ipcRenderer.invoke("daemon:start"),
	openDaemonLog: () => ipcRenderer.invoke("daemon:open-log"),
	pickDirectory: () => ipcRenderer.invoke("dialog:pick-directory"),
	openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
	setTitleBarTheme: (theme) => ipcRenderer.send("window:titlebar-theme", theme),
	setBadge: (count) => ipcRenderer.send("app:badge", count),
	onMenuCommand: (listener) => {
		const handler = (_: unknown, command: MenuCommand) => listener(command);
		ipcRenderer.on("menu:command", handler);
		return () => ipcRenderer.removeListener("menu:command", handler);
	},
};

contextBridge.exposeInMainWorld("dinobotDesktop", bridge);
