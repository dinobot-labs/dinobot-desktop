import { localeTag } from "@dinobot/ui/i18n";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatSession } from "../chat/session.ts";

/** Re-render when the session publishes (at most once per frame). */
export function useSession(session: ChatSession | undefined): number {
	return useSyncExternalStore(
		(listener) => (session ? session.subscribe(listener) : () => {}),
		() => session?.getVersion() ?? -1,
	);
}

/** A clock for elapsed times; only ticks while `active`. */
export function useNow(active: boolean, interval = 1000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), interval);
		return () => clearInterval(id);
	}, [active, interval]);
	return now;
}

export function formatElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}초`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}분 ${s % 60}초`;
	return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

const rtf = new Intl.RelativeTimeFormat(localeTag(), { numeric: "auto" });
export function relativeTime(at: number, now = Date.now()): string {
	const diff = (at - now) / 1000;
	const abs = Math.abs(diff);
	if (abs < 45) return "방금";
	if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
	if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
	if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
	return new Date(at).toLocaleDateString(localeTag(), { month: "short", day: "numeric" });
}

export function clockTime(at: number): string {
	return new Date(at).toLocaleTimeString(localeTag(), { hour: "numeric", minute: "2-digit" });
}
