/** Shared number formats (TUI parity: chrome.ts formatTokens). */
export function formatTokens(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "—";
	if (n < 1000) return String(Math.round(n));
	if (n < 10_000) return `${(n / 1000).toFixed(2)}k`;
	if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(2)}m`;
	if (n < 100_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
	return `${Math.round(n / 1_000_000)}m`;
}

export function formatCost(usd: number): string {
	if (!Number.isFinite(usd)) return "—";
	if (usd === 0) return "$0";
	if (usd < 0.01) return "<$0.01";
	if (usd < 100) return `$${usd.toFixed(2)}`;
	return `$${Math.round(usd).toLocaleString()}`;
}

/** 4s · 1m06s · 1h02m (TUI subagent dock). */
export function formatClock(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

export function formatPercent(fraction: number): string {
	return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}
