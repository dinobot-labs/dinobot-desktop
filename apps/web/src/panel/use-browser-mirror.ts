import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserReply, BrowserViewState } from "../../../desktop/src/browser-types.ts";
import { browserAvailable, browserClient } from "./browser-client.ts";
import { jpegSource } from "./browser-input.ts";

export interface DecodedBrowserFrame { src: string; width: number; height: number; current: number; url: string }

/** Only mounted by the visible browser tab. One state/frame cycle, at most four frames per second. */
export function useBrowserMirror() {
	const [state, setState] = useState<BrowserViewState | null>(null);
	const [frame, setFrame] = useState<DecodedBrowserFrame | null>(null);
	const [error, setError] = useState("");
	const generation = useRef(0);
	const current = useRef<BrowserViewState | null>(null);
	const invalidate = useCallback(() => { generation.current++; setFrame(null); }, []);
	const accept = useCallback((reply: BrowserReply) => {
		if (!reply.state) return;
		const next = reply.state, prev = current.current;
		if (!next.connected || next.current !== prev?.current || next.url !== prev?.url || next.width !== prev?.width || next.height !== prev?.height) setFrame(null);
		current.current = next;
		setState(next);
	}, []);
	useEffect(() => {
		if (!browserAvailable) return;
		let live = true, running = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const visible = () => live && document.visibilityState !== "hidden";
		const poll = async () => {
			if (!visible() || running) return;
			running = true;
			const version = generation.current;
			try {
				if (browserClient.pending) return;
				await browserClient.transaction(async (call) => {
					const reply = await call("state");
					if (!visible() || version !== generation.current) return;
					accept(reply);
					if (!reply.state?.connected) { setFrame(null); setError(""); return; }
					// A blocking page dialog can prevent screenshots; preserve its controls instead of treating it as a disconnect.
					if (reply.state.dialog) { setError(""); return; }
					const shot = await call("frame");
					if (!visible() || version !== generation.current) return;
					accept(shot);
					const view = shot.state ?? reply.state;
					if (!view.connected) { setFrame(null); return; }
					if (view.dialog) { setError(""); return; }
					const src = jpegSource(shot.state?.frame);
					if (!src || !Number.isFinite(view.width) || !Number.isFinite(view.height) || view.width <= 0 || view.height <= 0) throw new Error("브라우저 화면을 읽지 못했어요. 새로 연결해 주세요.");
					const image = new Image();
					image.src = src;
					await image.decode();
					if (!visible() || version !== generation.current) return;
					if (!image.naturalWidth || !image.naturalHeight) throw new Error("브라우저 화면을 읽지 못했어요. 새로 연결해 주세요.");
					setFrame({ src, width: view.width, height: view.height, current: view.current, url: view.url });
					setError("");
				});
			} catch (error) {
				if (visible() && version === generation.current) {
					setFrame(null);
					current.current = null;
					setState(null);
					setError(error instanceof Error ? error.message : String(error));
				}
			} finally {
				running = false;
				if (visible()) timer = setTimeout(() => void poll(), 250);
			}
		};
		const visibility = () => {
			if (timer) clearTimeout(timer);
			// Invalidate a pre-hide frame even when its transport request completes after re-show.
			invalidate();
			if (visible()) void poll();
		};
		document.addEventListener("visibilitychange", visibility);
		void poll();
		return () => {
			live = false;
			generation.current++;
			if (timer) clearTimeout(timer);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, [accept, invalidate]);
	return { state, frame, error, accept, invalidate };
}
