import { contextBridge, ipcRenderer, webUtils } from "electron";
import { type DesktopBridge, MAX_IN_MEMORY_ATTACHMENT_BYTES, type MenuCommand } from "./bridge-types.ts";

/** A dropped or picked file's path on disk (Electron 32+ has no File.path), or "" for in-memory data. */
function pathOf(file: File): string {
	try {
		return webUtils.getPathForFile(file);
	} catch {
		return "";
	}
}

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
	stageAttachment: async (file) => {
		if (typeof file === "string") return ipcRenderer.invoke("attachment:stage-path", file);
		const path = pathOf(file);
		if (path !== "") return ipcRenderer.invoke("attachment:stage-path", path);
		if (file.size > MAX_IN_MEMORY_ATTACHMENT_BYTES) {
			return { error: `${file.name || "file"}: a file without a path on disk can be up to ${MAX_IN_MEMORY_ATTACHMENT_BYTES / 1024 / 1024} MB` };
		}
		return ipcRenderer.invoke("attachment:stage-data", file.name, new Uint8Array(await file.arrayBuffer()));
	},
	artifactStat: (paths) => ipcRenderer.invoke("artifact:stat", paths),
	artifactRead: (path) => ipcRenderer.invoke("artifact:read", path),
	artifactOpen: (path, how) => ipcRenderer.invoke("artifact:open", path, how),
	checkUpdate: (current, pid) => ipcRenderer.invoke("update:check", current, pid),
	checkDesktopUpdate: () => ipcRenderer.invoke("desktop-update:check"),
	applyDesktopUpdate: () => ipcRenderer.invoke("desktop-update:apply"),
	setupApply: (request, daemon, port) => ipcRenderer.invoke("setup:apply", request, daemon, port),
	setupRecover: () => ipcRenderer.invoke("setup:recover"),
	reportConsent: () => ipcRenderer.invoke("report:consent"),
	reportAgree: (version, auto) => ipcRenderer.invoke("report:agree", version, auto),
	reportSend: (request) => ipcRenderer.invoke("report:send", request),
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
