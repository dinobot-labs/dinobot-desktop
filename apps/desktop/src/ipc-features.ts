import { isAbsolute, join } from "node:path";
import { app, ipcMain, shell } from "electron";
import type { ManifestApplyRequest, SetupRecovery } from "./bridge-types.ts";
import { bundledDaemon, cachedConfig, readDaemonConfig } from "./daemon.ts";
import { daemonRuntime, shouldCheckDaemonUpdate } from "./features/daemon-process.ts";
import { type ArtifactPolicy, checkArtifact, readArtifact, statArtifacts } from "./features/artifacts.ts";
import { ATTACHMENT_FOLDER, stageAttachmentData, stageAttachmentPath } from "./features/attachments.ts";
import { clipboardFilePaths, clipboardImage } from "./features/clipboard.ts";
import { gitBranch } from "./features/exec.ts";
import { normalizeImagePath, readImageFile } from "./features/images.ts";
import { refsComplete, refsExpand } from "./features/refs.ts";
import { setupApply, setupRecover } from "./features/setup-apply.ts";
import { parseSendRequest, realReportPorts, recordSetupApply, reportAgree, reportConsent, reportSend } from "./features/report.ts";
import { applyDesktopUpdate, checkDesktopUpdate } from "./features/desktop-update.ts";
import { checkUpdate } from "./features/update.ts";

const isString = (value: unknown): value is string => typeof value === "string";
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

function applyRequest(value: unknown): ManifestApplyRequest | undefined {
	const v = value as Partial<ManifestApplyRequest> | null;
	if (!v || !isString(v.manifestPath) || !isString(v.baseSha256) || !isString(v.candidate) || !isStringList(v.changes) || !isStringList(v.summary)) return undefined;
	return { manifestPath: v.manifestPath, baseSha256: v.baseSha256, candidate: v.candidate, changes: v.changes, summary: v.summary, locale: isString(v.locale) ? v.locale : app.getLocale() };
}

let recovery: Promise<SetupRecovery> | undefined;

async function artifactPolicy(): Promise<ArtifactPolicy> {
	const config = cachedConfig() ?? (await readDaemonConfig());
	return { blockedDirs: config.dataDir ? [config.dataDir] : [] };
}

/** Reconcile an interrupted setup apply once per app start (before the renderer connects); later calls get the same answer. */
export function startSetupRecovery(): Promise<SetupRecovery> {
	recovery ??= (async () => {
		const config = cachedConfig() ?? (await readDaemonConfig());
		const result = await setupRecover(config.manifestPath, config.port, app.getLocale());
		if (result.recovered) await readDaemonConfig();
		return result;
	})().catch((error: unknown) => ({ recovered: false, message: error instanceof Error ? error.message : String(error) }));
	return recovery;
}

/** IPC for the renderer's feature calls; registered once from main.ts. */
export function registerFeatureIpc(): void {
	void startSetupRecovery();
	ipcMain.on("app:locale", (event) => {
		event.returnValue = app.getLocale();
	});
	ipcMain.handle("git:branch", (_event, cwd: unknown) => (isString(cwd) && cwd !== "" ? gitBranch(cwd) : null));
	ipcMain.handle("refs:complete", (_event, cwd: unknown, token: unknown) => (isString(cwd) && isString(token) ? refsComplete(cwd, token) : []));
	ipcMain.handle("refs:expand", async (_event, cwd: unknown, text: unknown, opts: unknown) => {
		if (!isString(text)) return { text: "", warnings: [] };
		if (!isString(cwd)) return { text, warnings: [] };
		const window = (opts as { contextWindow?: unknown } | null)?.contextWindow;
		const config = cachedConfig() ?? (await readDaemonConfig());
		return refsExpand(cwd, text, {
			...(typeof window === "number" ? { contextWindow: window } : {}),
			blockedDirs: config.dataDir ? [config.dataDir] : [],
		});
	});
	ipcMain.handle("clipboard:image", () => clipboardImage().catch(() => null));
	ipcMain.handle("clipboard:file-paths", () => clipboardFilePaths());
	ipcMain.handle("image:read-file", (_event, path: unknown) => (isString(path) ? readImageFile(path) : { error: "not a path" }));
	const attachmentRoot = () => join(app.getPath("temp"), ATTACHMENT_FOLDER);
	ipcMain.handle("attachment:stage-path", (_event, path: unknown) => {
		const source = isString(path) ? normalizeImagePath(path) : "";
		return source !== "" && isAbsolute(source) ? stageAttachmentPath(source, attachmentRoot()) : { error: "not an absolute path" };
	});
	ipcMain.handle("attachment:stage-data", (_event, name: unknown, data: unknown) =>
		isString(name) && data instanceof Uint8Array ? stageAttachmentData(name, data, attachmentRoot()) : { error: "not a file" },
	);
	ipcMain.handle("artifact:stat", async (_event, paths: unknown) => statArtifacts(paths, await artifactPolicy()));
	ipcMain.handle("artifact:read", async (_event, path: unknown) => readArtifact(path, await artifactPolicy()));
	ipcMain.handle("artifact:open", async (_event, path: unknown, how: unknown) => {
		const checked = await checkArtifact(path, await artifactPolicy());
		if ("error" in checked) return false;
		if (how === "reveal") {
			shell.showItemInFolder(checked.path);
			return true;
		}
		return (await shell.openPath(checked.path)) === "";
	});
	// Decided by the daemon that answers (its pid), not by the one the app would start: a CLI-installed daemon may hold the port.
	ipcMain.handle("update:check", async (_event, current: unknown, pid: unknown) => {
		if (!isString(current)) return null;
		const config = cachedConfig() ?? (await readDaemonConfig());
		const runtime = typeof pid === "number" ? await daemonRuntime(pid, bundledDaemon()?.main ?? null) : "unknown";
		if (!shouldCheckDaemonUpdate(runtime, config.bundled === true)) return null;
		return checkUpdate(current, { cachePath: join(app.getPath("userData"), "update-check.json") });
	});
	ipcMain.handle("desktop-update:check", () => checkDesktopUpdate(app.getVersion()));
	ipcMain.handle("desktop-update:apply", () => applyDesktopUpdate());
	ipcMain.handle("setup:apply", async (_event, request: unknown, daemon: unknown, port: unknown) => {
		const parsed = applyRequest(request);
		if (parsed === undefined) throw new Error("invalid setup apply request");
		const owner = (daemon as { owner?: unknown } | null)?.owner === "external" ? "external" : "tui";
		const pid = Number((daemon as { pid?: unknown } | null)?.pid) || 0;
		const config = cachedConfig() ?? (await readDaemonConfig());
		const apiPort = typeof port === "number" && Number.isInteger(port) && port > 0 ? port : config.port;
		const outcome = await setupApply(parsed, { pid, owner }, apiPort);
		recordSetupApply(outcome);
		await readDaemonConfig().catch(() => undefined);
		return outcome;
	});
	ipcMain.handle("setup:recover", () => startSetupRecovery());
	const reportPorts = realReportPorts(() => ({ name: app.getName(), version: app.getVersion(), packaged: app.isPackaged, locale: app.getLocale(), versions: { ...process.versions } }));
	ipcMain.handle("report:consent", () => reportConsent(reportPorts));
	ipcMain.handle("report:agree", (_event, version: unknown, auto: unknown) => (isString(version) ? reportAgree(reportPorts, version, auto === true) : { ok: false, error: "invalid consent version" }));
	ipcMain.handle("report:send", (_event, request: unknown) => reportSend(reportPorts, parseSendRequest(request)));
}
