import { Badge, Button, cn, Input } from "@dinobot/ui";
import { IconChevronRight, IconRefresh, IconSearch, IconWand } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { runCommandUi } from "../state/app.ts";
import { type PluginView, refreshPlugins, usePlugins } from "../state/plugins.ts";
import { Section } from "./kit.tsx";
import { PluginDetail } from "./PluginDetail.tsx";
import { PluginIcon, PluginState } from "./plugin-icon.tsx";

/** Component counts shown under a card: tools, servers, skills. */
export function componentSummary(view: PluginView, skillCount: number): string[] {
	const parts: string[] = [];
	if (view.id === "skills") parts.push(`스킬 ${skillCount}`);
	if (view.mcpServers?.length) parts.push(`서버 ${view.mcpServers.length}`);
	if (view.tools.length) parts.push(`도구 ${view.tools.length}`);
	else if (view.catalog.dynamicTools) parts.push("도구는 연결 후 표시");
	if (view.catalog.defaults === "on") parts.push("기본 켜짐");
	if (view.catalog.defaults === "always") parts.push("항상 켜짐");
	return parts;
}

function PluginCard({ view, skillCount, onOpen }: { view: PluginView; skillCount: number; onOpen: () => void }) {
	return (
		<button
			type="button"
			onClick={onOpen}
			data-testid="plugin-card"
			data-plugin={view.id}
			aria-label={`${view.catalog.title} ${view.enabled ? "켜짐" : "꺼짐"}, 자세히 보기`}
			className="group flex min-w-0 cursor-pointer flex-col gap-2.5 rounded-lg border border-line bg-surface p-3.5 text-left transition-colors duration-(--dur-micro) hover:border-line-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus)"
		>
			<div className="flex items-start gap-3">
				<PluginIcon id={view.id} enabled={view.enabled} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate text-sm font-semibold text-fg">{view.catalog.title}</span>
						<span className="flex-1" />
						<PluginState view={view} />
					</div>
					<div className="truncate font-mono text-micro text-fg-3">{view.id}</div>
				</div>
			</div>
			<p className="line-clamp-2 min-h-[2lh] text-xs text-fg-2">{view.catalog.tagline}</p>
			<div className="flex items-center gap-1.5">
				{componentSummary(view, skillCount).map((p) => (
					<Badge key={p} variant="neutral">
						{p}
					</Badge>
				))}
				<span className="flex-1" />
				<IconChevronRight className="size-4 shrink-0 text-fg-3 transition-transform duration-(--dur-micro) group-hover:translate-x-0.5" />
			</div>
		</button>
	);
}

type Filter = "all" | "on" | "off";

/** Plugins: icon cards grouped on/off; a card opens the plugin's description and components. */
export function PluginsTab() {
	const { views, skills, loading, loaded, error } = usePlugins();
	const [openId, setOpenId] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	useEffect(() => {
		void refreshPlugins();
	}, []);
	const q = query.trim().toLowerCase();
	const shown = useMemo(
		() =>
			views.filter((v) => (filter === "all" || (filter === "on") === v.enabled) && (!q || `${v.id} ${v.catalog.title} ${v.catalog.tagline} ${v.tools.map((t) => t.name).join(" ")}`.toLowerCase().includes(q))),
		[views, filter, q],
	);
	const open = openId ? views.find((v) => v.id === openId) : undefined;
	if (open) return <PluginDetail view={open} skills={skills} onBack={() => setOpenId(null)} />;
	const on = shown.filter((v) => v.enabled);
	const off = shown.filter((v) => !v.enabled);
	const enabledCount = views.filter((v) => v.enabled).length;
	const toolCount = views.filter((v) => v.enabled).reduce((n, v) => n + v.tools.length, 0);
	const grid = (list: PluginView[]) => (
		<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="plugins-grid">
			{list.map((v) => (
				<PluginCard key={v.id} view={v} skillCount={skills.length} onOpen={() => setOpenId(v.id)} />
			))}
		</div>
	);
	return (
		<div className="flex flex-col gap-6" data-testid="plugins-tab">
			<Section
				title="플러그인"
				description={loaded ? `${views.length}개 중 ${enabledCount}개 켜짐 · 도구 ${toolCount}개 사용 중` : "데몬에서 불러오는 중…"}
				aside={
					<div className="flex gap-1.5">
						<Button size="xs" variant="ghost" disabled={loading} onClick={() => void refreshPlugins()}>
							<IconRefresh /> 새로고침
						</Button>
						<Button size="xs" variant="ghost" onClick={() => runCommandUi("setup", "channels")}>
							채널 설정
						</Button>
						<Button size="xs" onClick={() => runCommandUi("setup", "plugins")}>
							<IconWand /> 플러그인 설정
						</Button>
					</div>
				}
			>
				{error ? <div className="text-sm text-status-failed-fg">{error}</div> : null}
				<div className="flex items-center gap-2">
					<div className="relative flex-1">
						<IconSearch size={14} className="pointer-events-none absolute top-2 left-2.5 text-fg-3" />
						<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="플러그인이나 도구 이름으로 찾기" className="pl-8" aria-label="플러그인 찾기" />
					</div>
					<div className="flex rounded-md bg-hover p-0.5" role="radiogroup" aria-label="상태">
						{(
							[
								["all", "전체"],
								["on", "켜짐"],
								["off", "꺼짐"],
							] as const
						).map(([value, label]) => (
							<button
								key={value}
								type="button"
								role="radio"
								aria-checked={filter === value}
								onClick={() => setFilter(value)}
								className={cn("cursor-pointer rounded-sm px-2.5 py-1 text-xs", filter === value ? "bg-surface text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-fg-3 hover:text-fg")}
							>
								{label}
							</button>
						))}
					</div>
				</div>
			</Section>
			{on.length ? (
				<Section title="켜진 플러그인" description="지금 데몬이 불러온 플러그인이에요.">
					{grid(on)}
				</Section>
			) : null}
			{off.length ? (
				<Section title="사용할 수 있는 플러그인" description="이 빌드에 들어 있지만 꺼져 있어요. 설정 마법사나 dinobot.yaml로 켤 수 있어요.">
					{grid(off)}
				</Section>
			) : null}
			{!on.length && !off.length ? <div className="text-sm text-fg-3">찾는 플러그인이 없어요.</div> : null}
		</div>
	);
}
