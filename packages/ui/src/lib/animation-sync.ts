/**
 * Loop phase alignment. CSS loops that mount at different moments step on different frames; restarting them from
 * the document timeline origin puts every loop with the same duration and step count in phase, so concurrent
 * shimmers, spinners and dinos repaint together.
 *
 * Reading animations forces a style flush, so alignment is batched: mounting loops only request it, and one
 * document-wide pass runs on the next frame. Only infinite loops are touched; one-shot animations (entrances, the
 * dino's jump) keep their own start.
 */
import { type RefObject, useLayoutEffect } from "react";

let scheduled = false;

function alignAll(): void {
	scheduled = false;
	if (typeof document === "undefined" || typeof document.getAnimations !== "function") return;
	for (const loop of document.getAnimations()) {
		if (loop.startTime === 0 || loop.playState !== "running") continue;
		const iterations = loop.effect?.getTiming().iterations;
		if (iterations !== Number.POSITIVE_INFINITY) continue;
		loop.startTime = 0;
	}
}

/** Ask for one alignment pass on the next frame (cheap to call from many components). */
export function alignLoops(_root?: Element | null): void {
	if (scheduled || typeof requestAnimationFrame !== "function") return;
	scheduled = true;
	requestAnimationFrame(alignAll);
}

/** Request alignment after mount and whenever one of `deps` changes. Pass `active: false` to skip non-looping states. */
export function useAlignedLoops(ref: RefObject<Element | null>, deps: readonly unknown[] = [], active = true): void {
	// biome-ignore lint: deps are caller-provided re-align triggers
	useLayoutEffect(() => {
		if (active) alignLoops(ref.current);
	}, [ref, active, ...deps]);
}
