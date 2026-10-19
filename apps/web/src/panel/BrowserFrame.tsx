import { useRef } from "react";
import { browserKey, browserWheel, framePoint, type BrowserInput } from "./browser-input.ts";
import type { DecodedBrowserFrame } from "./use-browser-mirror.ts";

/** A JPEG mirror, not an iframe or another browser engine. Only the focused textarea accepts text/paste. */
export function BrowserFrame({ frame, enabled, send }: { frame: DecodedBrowserFrame; enabled: boolean; send: (input: BrowserInput) => void }) {
	const area = useRef<HTMLTextAreaElement>(null);
	const image = useRef<HTMLImageElement>(null);
	const composing = useRef(false);
	const focused = (target: HTMLTextAreaElement) => enabled && document.activeElement === target;
	return (
		<div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/5 focus-within:ring-1 focus-within:ring-inset focus-within:ring-focus" data-testid="browser-frame"
			onWheel={(e) => {
				if (!enabled || !image.current || !framePoint(image.current.getBoundingClientRect(), frame.width, frame.height, e.clientX, e.clientY)) return;
				e.stopPropagation();
				const input = browserWheel(e.deltaX, e.deltaY, e.deltaMode, frame.height);
				if (input) send(input);
			}}
		>
			<img ref={image} src={frame.src} alt="Chrome 실시간 화면" draggable={false} className="h-full w-full min-h-0 select-none object-contain"
				onContextMenu={(e) => { if (enabled) e.preventDefault(); }}
				onPointerDown={(e) => {
					if (!enabled || ![0, 1, 2].includes(e.button)) return;
					const point = framePoint(e.currentTarget.getBoundingClientRect(), frame.width, frame.height, e.clientX, e.clientY);
					if (!point) return;
					e.preventDefault();
					area.current?.focus({ preventScroll: true });
					send({ kind: "click", ...point, button: e.button === 1 ? "middle" : e.button === 2 ? "right" : "left" });
				}} />
			<textarea ref={area} aria-label="브라우저 키보드 입력" disabled={!enabled} autoComplete="off" autoCapitalize="off" spellCheck={false} className="absolute bottom-0 left-0 h-px w-px resize-none opacity-0"
				onKeyDown={(e) => {
					e.stopPropagation();
					if (!focused(e.currentTarget)) return;
					const key = browserKey({ ...e, isComposing: e.nativeEvent.isComposing || composing.current, altGraph: e.getModifierState("AltGraph") });
					if (key) { e.preventDefault(); send({ kind: "key", key }); }
					if (key === "Escape") e.currentTarget.blur();
				}}
				onCompositionStart={() => { composing.current = true; }}
				onCompositionEnd={(e) => {
					composing.current = false;
					const text = e.currentTarget.value;
					e.currentTarget.value = "";
					if (text && focused(e.currentTarget)) send({ kind: "text", text });
				}}
				onChange={(e) => {
					if (composing.current || (e.nativeEvent as InputEvent).isComposing) return;
					const text = e.currentTarget.value;
					e.currentTarget.value = "";
					if (text && focused(e.currentTarget)) send({ kind: "text", text });
				}}
				onPaste={(e) => {
					e.stopPropagation();
					if (!focused(e.currentTarget)) return;
					e.preventDefault();
					const text = e.clipboardData.getData("text/plain");
					if (text) send({ kind: "text", text });
				}}
				onBlur={(e) => { composing.current = false; e.currentTarget.value = ""; }} />
		</div>
	);
}
