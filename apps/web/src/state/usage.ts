/**
 * Usage data: GET /v1/usage (summary across conversations + provider limit windows) polled while the app is online.
 * Limit warnings follow the 50/75/90/95 % thresholds once per window reset (toast), and >= 90 % raises a banner.
 */
import { localeTag } from "@dinobot/ui/i18n";
import type { UsageLimitRow, UsageResponse } from "@dinobot/contracts";
import { toast } from "@dinobot/ui";
import { create } from "zustand";
import { api, HttpError } from "../lib/api.ts";

interface UsageState {
	data: UsageResponse | null;
	/** The daemon has no /v1/usage (older version). */
	unsupported: boolean;
	error?: string;
	loading: boolean;
	fetchedAt?: number;
}

export const useUsage = create<UsageState>(() => ({ data: null, unsupported: false, loading: false }));

const WARN = [0.5, 0.75, 0.9, 0.95];
const SEEN = "dn-usage-warned";

export interface LimitView extends UsageLimitRow {
	provider: string;
	account: string;
}

export function limitRows(data: UsageResponse | null): LimitView[] {
	if (!data) return [];
	return data.limits.providers.flatMap((p) => p.accounts.flatMap((a) => (a.report?.limits ?? []).map((l) => ({ ...l, provider: p.name, account: a.label ?? String(a.id) }))));
}

function warn(data: UsageResponse) {
	let seen: Record<string, number> = {};
	try {
		seen = JSON.parse(localStorage.getItem(SEEN) ?? "{}") as Record<string, number>;
	} catch {}
	for (const l of limitRows(data)) {
		if (l.usedFraction === undefined) continue;
		// One warning per level per window: the window is identified by its reset time (rounded, fetches jitter).
		const key = `${l.provider}/${l.account}/${l.id}/${l.resetsAt ? Math.round(l.resetsAt / 600_000) : ""}`;
		const level = WARN.filter((t) => (l.usedFraction ?? 0) >= t).at(-1);
		if (level === undefined || (seen[key] ?? 0) >= level) continue;
		seen[key] = level;
		toast({
			tone: level >= 0.9 ? "error" : "waiting",
			title: `${l.provider} ${l.label} ${Math.round((l.usedFraction ?? 0) * 100)}% 사용`,
			body: l.resetsAt ? `${new Date(l.resetsAt).toLocaleString(localeTag(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}에 재설정돼요` : undefined,
			duration: level >= 0.9 ? 0 : 8000,
		});
	}
	try {
		localStorage.setItem(SEEN, JSON.stringify(seen));
	} catch {}
}

export async function refreshUsage(force = false): Promise<void> {
	if (useUsage.getState().unsupported && !force) return;
	useUsage.setState({ loading: true });
	try {
		const data = await api.usage(force);
		useUsage.setState({ data, unsupported: false, loading: false, fetchedAt: Date.now(), error: undefined });
		warn(data);
	} catch (error) {
		if (error instanceof HttpError && error.status === 404) useUsage.setState({ unsupported: true, loading: false });
		else useUsage.setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
	}
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startUsagePolling(): void {
	if (timer) return;
	void refreshUsage();
	timer = setInterval(() => void refreshUsage(), 60_000);
}
