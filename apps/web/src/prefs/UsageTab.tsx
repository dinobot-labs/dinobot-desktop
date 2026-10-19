import { localeTag } from "@dinobot/ui/i18n";
import type { Usage, UsageAccount } from "@dinobot/contracts";
import { Badge, Button, cn, formatCost, formatTokens, Meter } from "@dinobot/ui";
import { IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo } from "react";
import { useSession } from "../lib/hooks.ts";
import { threadLabel } from "../shell/thread-label.ts";
import { useAccounts } from "../state/accounts.ts";
import { selectThread, sessionFor, openSettings, useApp } from "../state/app.ts";
import { refreshUsage, useUsage } from "../state/usage.ts";
import { Section } from "./kit.tsx";

const sum = (list: Usage[]) =>
	list.reduce(
		(a, u) => ({ input: a.input + u.input, output: a.output + u.output, cacheRead: a.cacheRead + u.cacheRead, cacheWrite: a.cacheWrite + u.cacheWrite, reasoning: a.reasoning + (u.reasoning ?? 0), total: a.total + u.totalTokens, cost: a.cost + u.cost.total }),
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, cost: 0 },
	);

function resetText(at?: number): string {
	if (!at) return "";
	const d = new Date(at);
	const today = new Date();
	const time = d.toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit", hour12: false });
	return d.toDateString() === today.toDateString() ? `${time} 재설정` : `${d.toLocaleDateString(localeTag(), { month: "short", day: "numeric" })} ${time} 재설정`;
}

const WINDOW_KO: Record<string, string> = { "5h": "5시간", "1h": "1시간", "1d": "하루", "24h": "하루", "7d": "주간", "1w": "주간", "30d": "월간", "1m": "월간", monthly: "월간", weekly: "주간" };
/** Window label in Korean when the window is a known length (provider labels are English: "5 Hour", "7 Day"). */
function windowLabel(l: { windowId?: string; windowLabel?: string; label: string }): string {
	const known = (l.windowId && WINDOW_KO[l.windowId.toLowerCase()]) || (l.windowLabel && WINDOW_KO[l.windowLabel.toLowerCase().replace(/s+/g, "").replace(/hours?$/, "h").replace(/days?$/, "d")]);
	return `${known ?? l.windowLabel ?? l.label} 한도`;
}

/** One limit window, Codex-style: label, a bar of what is LEFT, "NN% 남음", muted reset time. */
function LimitRow({ label, used, resetsAt }: { label: string; used?: number | undefined; resetsAt?: number | undefined }) {
	const left = used === undefined ? undefined : Math.max(0, 1 - used);
	return (
		<div className="grid grid-cols-[120px_1fr_auto] items-center gap-3 py-1 text-sm" data-testid="limit-row">
			<span className="truncate text-fg-2">{label}</span>
			{left === undefined ? <span className="text-xs text-fg-3">데이터 없음</span> : <Meter value={left} thresholds={{ warn: 0.75, danger: 0.9, of: "rest" }} label={label} />}
			<span className="shrink-0 text-right font-mono text-xs tabular-nums">
				{left === undefined ? null : <span className={cn(used !== undefined && used >= 0.9 ? "text-status-failed-fg" : used !== undefined && used >= 0.75 ? "text-status-running-fg" : "text-fg")}>{Math.round(left * 100)}% 남음</span>}
				{resetsAt ? <span className="ml-1.5 text-fg-3">({resetText(resetsAt)})</span> : null}
			</span>
		</div>
	);
}

function AccountLimits({ name, account }: { name: string; account: UsageAccount }) {
	const stale = account.stale || (account.report && Date.now() - account.report.fetchedAt > 15 * 60_000);
	return (
		<div className="rounded-lg border border-line bg-surface p-3">
			<div className="mb-1 flex items-center gap-2 text-sm">
				<span className="font-medium text-fg">{name}</span>
				<span className="truncate text-xs text-fg-3">{account.label ?? `#${account.id}`}</span>
				{account.active ? <Badge variant="success">사용 중</Badge> : null}
				{account.blockedUntil && account.blockedUntil > Date.now() ? <Badge variant="waiting">{account.lastFailure === "quota" ? "사용량 한도" : account.lastFailure === "auth" ? "인증 실패" : "속도 제한"} · {resetText(account.blockedUntil)}</Badge> : null}
				{stale ? <Badge variant="outline">오래된 값일 수 있어요</Badge> : null}
			</div>
			{account.report?.limits.length ? (
				account.report.limits.map((l) => <LimitRow key={l.id} label={windowLabel(l)} used={l.usedFraction} resetsAt={l.resetsAt} />)
			) : (
				<div className="py-1 text-xs text-fg-3">{account.error ? `한도를 불러오지 못했어요: ${account.error}` : "이 공급자는 한도 정보를 제공하지 않아요"}</div>
			)}
		</div>
	);
}

function TokenGrid({ totals }: { totals: ReturnType<typeof sum> }) {
	const cells: [string, number][] = [
		["입력", totals.input],
		["캐시 읽기", totals.cacheRead],
		["캐시 쓰기", totals.cacheWrite],
		["출력", totals.output],
		["추론", totals.reasoning],
	];
	return (
		<div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-6">
			<div className="bg-surface p-3">
				<div className="text-micro text-fg-3">전체 토큰</div>
				<div className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatTokens(totals.total)}</div>
			</div>
			{cells.map(([label, n]) => (
				<div key={label} className="bg-surface p-3">
					<div className="text-micro text-fg-3">{label}</div>
					<div className="mt-1 font-mono text-md tabular-nums text-fg-2">{formatTokens(n)}</div>
				</div>
			))}
		</div>
	);
}

function ModelTable({ models }: { models: Record<string, Usage> }) {
	const rows = Object.entries(models).sort((a, b) => b[1].cost.total - a[1].cost.total);
	if (!rows.length) return <div className="text-xs text-fg-3">아직 기록이 없어요</div>;
	return (
		<table className="w-full text-xs">
			<thead className="text-fg-3">
				<tr className="border-b border-line">
					<th className="py-1.5 text-left font-normal">모델 / 도구</th>
					<th className="py-1.5 text-right font-normal">입력</th>
					<th className="py-1.5 text-right font-normal">캐시</th>
					<th className="py-1.5 text-right font-normal">출력</th>
					<th className="py-1.5 text-right font-normal">비용(추정)</th>
				</tr>
			</thead>
			<tbody className="font-mono tabular-nums">
				{rows.map(([name, u]) => (
					<tr key={name} className="border-b border-line last:border-0">
						<td className="max-w-0 truncate py-1.5 pr-2 font-sans text-fg">{name}</td>
						<td className="py-1.5 text-right text-fg-2">{formatTokens(u.input)}</td>
						<td className="py-1.5 text-right text-fg-2">{formatTokens(u.cacheRead + u.cacheWrite)}</td>
						<td className="py-1.5 text-right text-fg-2">{formatTokens(u.output)}</td>
						<td className="py-1.5 text-right text-fg">{formatCost(u.cost.total)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** Usage: limits (what is left in each provider window), this thread's ledger, and spend across every thread. */
export function UsageTab() {
	const { data, unsupported, loading, error } = useUsage();
	const pools = useAccounts((s) => s.pools);
	const activeKey = useApp((s) => s.activeKey);
	const titles = useApp((s) => s.titles);
	const model = useApp((s) => (s.activeKey ? s.models[s.activeKey] : undefined));
	const session = useMemo(() => (activeKey ? sessionFor(activeKey) : undefined), [activeKey]);
	useSession(session);
	useEffect(() => {
		void refreshUsage(true);
	}, []);
	const side = session?.side;
	const thread = side ? sum([...Object.values(side.ledger.models), ...Object.values(side.ledger.tools)]) : undefined;
	const all = data ? sum(Object.values(data.summary.models)) : undefined;
	return (
		<div className="flex flex-col gap-7" data-testid="usage-tab">
			<Section
				title="한도"
				description="공급자 구독의 사용 한도예요. 막대는 남은 양이에요."
				aside={
					<Button size="xs" variant="ghost" disabled={loading} onClick={() => void refreshUsage(true)}>
						<IconRefresh /> 새로고침
					</Button>
				}
			>
				{model ? (
					<div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
						<span className="text-fg-3">
							모델 <span className="font-mono text-fg">{model.model}</span>
						</span>
						<span className="text-fg-3">
							추론 <span className="text-fg">{model.thinkingLevel}</span>
						</span>
						{model.fast ? <span className="text-fg">fast</span> : null}
					</div>
				) : null}
				{unsupported ? (
					<div className="rounded-lg border border-line bg-sunken p-3 text-sm text-fg-2">
						이 데몬은 한도 정보를 아직 제공하지 않아요. dinobot을 최신 버전으로 업데이트하면 5시간·주간 한도가 여기 나와요. 지금은 계정별 차단 상태만 보여요.
						<div className="mt-2 flex flex-col gap-1">
							{pools.flatMap((p) => p.accounts.filter((a) => /limit|failed/.test(a.state)).map((a) => <div key={`${p.key}${a.id}`} className="text-xs text-status-waiting-fg">{p.key} #{a.id} · {a.state}</div>))}
						</div>
					</div>
				) : null}
				{error ? <div className="text-sm text-status-failed-fg">{error}</div> : null}
				{data?.limits.providers.length ? (
					<div className="grid gap-2">
						{data.limits.providers.flatMap((p) => p.accounts.map((a) => <AccountLimits key={`${p.key}:${a.id}`} name={p.name} account={a} />))}
					</div>
				) : data ? (
					<div className="text-sm text-fg-3">로그인된 구독 계정이 없어요.</div>
				) : null}
			</Section>
			{thread && side ? (
				<Section title="이 스레드" description={activeKey ? threadLabel(activeKey, titles) : undefined}>
					<TokenGrid totals={thread} />
					<div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg-3">
						<span>
							비용(추정) <span className="font-mono text-fg">{formatCost(thread.cost)}</span>
						</span>
						<span>
							컨텍스트{" "}
							<span className="font-mono text-fg">
								{model?.contextWindow ? `${Math.max(0, Math.round((1 - side.usage.contextTokens / model.contextWindow) * 100))}% 남음 (${formatTokens(side.usage.contextTokens)} / ${formatTokens(model.contextWindow)})` : formatTokens(side.usage.contextTokens)}
							</span>
						</span>
						{side.call.tps ? <span>최근 속도 <span className="font-mono text-fg">{side.call.tps < 10 ? side.call.tps.toFixed(1) : Math.round(side.call.tps)} tok/s</span></span> : null}
						{side.call.cacheRatio !== undefined ? <span>캐시 적중 <span className="font-mono text-fg">{Math.round(side.call.cacheRatio * 100)}%</span></span> : null}
					</div>
					<ModelTable models={{ ...side.ledger.models, ...Object.fromEntries(Object.entries(side.ledger.tools).map(([k, v]) => [`도구 · ${k}`, v])) }} />
					<p className="text-micro text-fg-3">비용은 공개 정가로 계산한 추정치예요. 구독 요금제의 실제 청구와 다를 수 있어요.</p>
				</Section>
			) : null}
			{data && all ? (
				<Section title="전체" description={`대화 ${data.summary.conversations}개의 합계 (서브에이전트 포함)`}>
					<TokenGrid totals={all} />
					<div className="text-sm text-fg-3">
						비용(추정) <span className="font-mono text-fg">{formatCost(all.cost)}</span>
					</div>
					<ModelTable models={data.summary.models} />
					{data.summary.threads.length ? (
						<div className="flex flex-col">
							<div className="mb-1 font-mono text-micro uppercase tracking-[var(--tr-label)] text-fg-3">비용이 큰 스레드</div>
							{data.summary.threads.map((t) => (
								<button
									key={t.thread}
									type="button"
									disabled={!t.thread.startsWith("tui:")}
									onClick={() => {
										openSettings(false);
										void selectThread(t.thread);
									}}
									className="flex min-w-0 cursor-pointer items-center gap-3 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-hover disabled:cursor-default"
								>
									<span className="min-w-0 flex-1 truncate text-fg">{threadLabel(t.thread, titles)}</span>
									<span className="shrink-0 font-mono text-xs text-fg-3">{formatTokens(t.totalTokens)}</span>
									<span className="w-16 shrink-0 text-right font-mono text-xs text-fg">{formatCost(t.cost)}</span>
								</button>
							))}
						</div>
					) : null}
				</Section>
			) : null}
		</div>
	);
}
