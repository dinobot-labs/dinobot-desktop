import { Badge, Button, cn, Input, StatusMark } from "@dinobot/ui";
import { IconLogin, IconRefresh, IconSearch } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { refreshAccounts, useAccounts } from "../state/accounts.ts";
import { runCommandUi } from "../state/app.ts";
import { Section } from "./kit.tsx";

/** Accounts: stored credentials and pools (/accounts, /logout) and every provider the daemon can log in to (/login). */
export function AccountsTab() {
	const { providers, stored, pools, loading, error } = useAccounts();
	const [query, setQuery] = useState("");
	useEffect(() => {
		void refreshAccounts();
	}, []);
	const q = query.trim().toLowerCase();
	const groups = useMemo(() => {
		const list = q ? providers.filter((p) => `${p.label} ${p.value}`.toLowerCase().includes(q)) : providers;
		const by = new Map<string, typeof list>();
		for (const p of list) by.set(p.group ?? "", [...(by.get(p.group ?? "") ?? []), p]);
		return [...by.entries()];
	}, [providers, q]);
	const typeOf = (key: string) => stored.find((s) => s.value === key)?.description;
	return (
		<div className="flex flex-col gap-7" data-testid="accounts-tab">
			<Section
				title="로그인된 계정"
				description="여러 계정을 넣으면 사용량 한도에 걸릴 때 다음 계정으로 넘어가요."
				aside={
					<Button size="xs" variant="ghost" onClick={() => void refreshAccounts()} disabled={loading}>
						<IconRefresh /> 새로고침
					</Button>
				}
			>
				{error ? <div className="text-sm text-status-failed-fg">{error}</div> : null}
				{!pools.length && !loading ? <div className="text-sm text-fg-3">저장된 로그인이 없어요. 아래에서 공급자를 골라 로그인하세요.</div> : null}
				<div className="grid gap-2 md:grid-cols-2">
					{pools.map((pool) => (
						<div key={pool.key} className="rounded-lg border border-line bg-surface p-3" data-testid="account-pool">
							<div className="flex items-center gap-2">
								<span className="font-mono text-sm font-medium text-fg">{pool.key}</span>
								{typeOf(pool.key) ? <Badge shape="tag">{typeOf(pool.key) === "oauth" ? "OAuth" : typeOf(pool.key) === "api_key" ? "API 키" : typeOf(pool.key)}</Badge> : null}
								{pool.rotates ? <Badge variant="signal">{pool.accounts.length}개 계정 순환</Badge> : null}
								<span className="flex-1" />
								<Button size="xs" variant="ghost" onClick={() => runCommandUi("login", pool.key)}>
									계정 추가
								</Button>
							</div>
							<div className="mt-2 flex flex-col gap-1">
								{pool.accounts.map((a) => {
									const blocked = /limit|failed/.test(a.state);
									return (
										<div key={a.id} className="flex min-w-0 items-center gap-2 text-sm">
											<StatusMark kind={blocked ? "waiting" : a.active ? "done" : "ready"} size={13} />
											<span className="font-mono text-micro text-fg-3">#{a.id}</span>
											<span className="min-w-0 flex-1 truncate text-fg">{a.label}</span>
											<span className={cn("shrink-0 text-xs", blocked ? "text-status-waiting-fg" : "text-fg-3")}>{a.state}</span>
											{!a.active && pool.accounts.length > 1 ? (
												<Button size="xs" variant="ghost" onClick={() => runCommandUi("accounts", `use ${pool.key} ${a.id}`)}>
													사용
												</Button>
											) : null}
											<Button size="xs" variant="ghost" className="text-status-failed-fg" onClick={() => runCommandUi("logout", pool.accounts.length > 1 ? `${pool.key} ${a.id}` : pool.key)}>
												로그아웃
											</Button>
										</div>
									);
								})}
							</div>
						</div>
					))}
				</div>
			</Section>
			<Section title="공급자" description={`dinobot이 로그인할 수 있는 공급자 ${providers.length}곳. 목록은 데몬이 알려 줘요.`}>
				<div className="relative">
					<IconSearch size={14} className="pointer-events-none absolute top-2 left-2.5 text-fg-3" />
					<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="공급자 찾기 (예: claude, codex, openrouter)" className="pl-8" aria-label="공급자 찾기" />
				</div>
				{groups.map(([group, list]) => (
					<div key={group}>
						<div className="mt-2 mb-1 font-mono text-micro uppercase tracking-[var(--tr-label)] text-fg-3">{group === "Chat providers" ? "채팅 공급자" : group.startsWith("Login only") ? "로그인만 (채팅 전송 아직 없음)" : group}</div>
						<div className="divide-y divide-line rounded-lg border border-line bg-surface">
							{list.map((p) => (
								<div key={p.value} className="flex min-w-0 items-center gap-3 px-3 py-2" data-testid="provider-row" data-provider={p.value}>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm text-fg">{p.label}</div>
										<div className="truncate font-mono text-micro text-fg-3">{p.value}</div>
									</div>
									{p.badge ? <Badge variant="success">로그인됨</Badge> : null}
									<Button size="sm" variant={p.badge ? "ghost" : "secondary"} onClick={() => runCommandUi("login", p.value)}>
										<IconLogin /> {p.badge ? "다시 로그인" : "로그인"}
									</Button>
								</div>
							))}
						</div>
					</div>
				))}
			</Section>
		</div>
	);
}
