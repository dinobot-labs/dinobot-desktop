/** Coordinates are CSS viewport pixels, never scaled screenshot/device pixels. */
export interface FrameBox { left: number; top: number; width: number; height: number }
export type BrowserInput =
	| { kind: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
	| { kind: "text"; text: string }
	| { kind: "key"; key: string }
	| { kind: "wheel"; dx: number; dy: number };

/** object-fit: contain, centered. Letterbox and exclusive right/bottom edges are not page content. */
export function framePoint(box: FrameBox, width: number, height: number, clientX: number, clientY: number): { x: number; y: number } | null {
	if (![box.left, box.top, box.width, box.height, width, height, clientX, clientY].every(Number.isFinite) || box.width <= 0 || box.height <= 0 || width <= 0 || height <= 0) return null;
	const scale = Math.min(box.width / width, box.height / height);
	const x = (clientX - box.left - (box.width - width * scale) / 2) / scale;
	const y = (clientY - box.top - (box.height - height * scale) / 2) / scale;
	return x >= 0 && y >= 0 && x < width && y < height ? { x: Math.floor(x), y: Math.floor(y) } : null;
}

const SPECIAL = new Set(["Enter", "Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Insert"]);
export interface BrowserKey { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean; altGraph?: boolean }

/** Printable text goes through textarea input (including IME); paste stays a focused local paste event. */
export function browserKey(e: BrowserKey): string | null {
	if (e.isComposing || e.altGraph || ["Dead", "Process", "Unidentified", "Control", "Meta", "Alt", "Shift", "CapsLock"].includes(e.key)) return null;
	if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "v") return null;
	if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Insert") return null;
	const shortcut = e.ctrlKey || e.metaKey || e.altKey;
	if (!SPECIAL.has(e.key) && !(shortcut && Array.from(e.key).length === 1)) return null;
	const modifiers = [e.ctrlKey && "Control", e.metaKey && "Meta", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
	return [...modifiers, shortcut && e.key.length === 1 ? e.key.toLowerCase() : e.key].join("+");
}

/** Browsers report lines/pages too. Bound one event so a faulty wheel cannot jump indefinitely. */
export function browserWheel(dx: number, dy: number, mode: number, pageHeight: number): BrowserInput | null {
	if (![dx, dy, pageHeight].every(Number.isFinite) || ![0, 1, 2].includes(mode)) return null;
	const unit = mode === 1 ? 16 : mode === 2 ? Math.max(1, pageHeight) : 1;
	const clamp = (n: number) => Math.max(-1024, Math.min(1024, Math.round(n * unit)));
	const x = clamp(dx), y = clamp(dy);
	return x || y ? { kind: "wheel", dx: x, dy: y } : null;
}

/** A mirrored frame can only load local JPEG data, never an arbitrary remote image URL. */
export function jpegSource(frame: string | undefined): string | null {
	if (!frame || frame.length > 12_000_000) return null;
	const base64 = frame.startsWith("data:image/jpeg;base64,") ? frame.slice(23) : frame;
	return /^\/9j\/[A-Za-z0-9+/=\r\n]+$/.test(base64) ? `data:image/jpeg;base64,${base64}` : null;
}
