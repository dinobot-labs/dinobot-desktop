import { readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, type BrowserWindow, type Rectangle, screen } from "electron";

interface WindowState {
	bounds: Rectangle;
	maximized: boolean;
}

const file = () => join(app.getPath("userData"), "window-state.json");
const DEFAULT: WindowState = { bounds: { x: 0, y: 0, width: 1320, height: 860 }, maximized: false };

/** Saved bounds, dropped when they no longer intersect a display (monitor unplugged). */
export function loadWindowState(): WindowState & { centered: boolean } {
	try {
		const saved = JSON.parse(readFileSync(file(), "utf8")) as WindowState;
		const b = saved.bounds;
		const visible = screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y);
		if (visible && b.width >= 640 && b.height >= 480) return { ...saved, centered: false };
	} catch {}
	return { ...DEFAULT, centered: true };
}

export function trackWindowState(win: BrowserWindow): void {
	let timer: NodeJS.Timeout | undefined;
	const snapshot = (): string | undefined => {
		if (win.isDestroyed()) return undefined;
		return JSON.stringify({ bounds: win.isMaximized() ? win.getNormalBounds() : win.getBounds(), maximized: win.isMaximized() } satisfies WindowState);
	};
	// Moves and resizes save asynchronously; only the final save on close is synchronous (the process is ending).
	const save = () => {
		timer = undefined;
		const state = snapshot();
		if (state) void writeFile(file(), state).catch(() => {});
	};
	const saveNow = () => {
		const state = snapshot();
		if (!state) return;
		try {
			writeFileSync(file(), state);
		} catch {}
	};
	const later = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(save, 400);
	};
	win.on("resize", later);
	win.on("move", later);
	win.on("maximize", later);
	win.on("unmaximize", later);
	win.on("close", saveNow);
}
