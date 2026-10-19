import { Badge, Button } from "@dinobot/ui";
import { IconArrowLeft, IconLock, IconServer, IconSparkles, IconTool, IconWand } from "@tabler/icons-react";
import { type ReactNode, useEffect } from "react";
import { runCommandUi } from "../state/app.ts";
import type { PluginView, SkillRow } from "../state/plugins.ts";
import { PluginIcon, PluginState } from "./plugin-icon.tsx";

function Block({ icon, title, count, children, testid }: { icon: ReactNode; title: string; count?: number; children: ReactNode; testid: string }) {
	return (
		<section className="flex flex-col gap-2" data-testid={testid}>
			<div className="flex items-center gap-2 text-fg-2 [&_svg]:size-4">
				{icon}
				<h4 className="text-sm font-semibold text-fg">{title}</h4>
				{count !== undefined ? <Badge variant="neutral">{count}</Badge> : null}
			</div>
			{children}
		</section>
	);
}

const DEFAULTS: Record<PluginView["catalog"]["defaults"], string> = { on: "기본 켜짐 (끌 수 있음)", off: "직접 켜야 함", always: "항상 켜짐 (끌 수 없음)" };

/** One plugin: header, description, facts, then its components (tools, MCP servers, skills). Esc goes back. */
export function PluginDetail({ view, skills, onBack }: { view: PluginView; skills: SkillRow[]; onBack: () => void }) {
	const c = view.catalog;
	useEffect(() => {
		// Capture phase, before the settings dialog: the first Esc only leaves the detail.
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			e.preventDefault();
			e.stopPropagation();
			onBack();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [onBack]);
	const facts: [string, ReactNode][] = [
		["상태", <PluginState key="s" view={view} />],
		["기본값", DEFAULTS[c.defaults]],
		["필요한 것", c.needs],
		...(c.runtime ? ([["실행 환경", c.runtime]] as [string, ReactNode][]) : []),
		...(c.config ? ([["설정", <code key="c" className="font-mono text-xs text-fg-2">{c.config}</code>]] as [string, ReactNode][]) : []),
	];
	return (
		<div className="flex flex-col gap-6" data-testid="plugin-detail" data-plugin={view.id}>
			<div className="flex items-center gap-1.5 text-sm">
				<Button size="xs" variant="ghost" onClick={onBack} aria-label="플러그인 목록으로">
					<IconArrowLeft /> 플러그인
				</Button>
				<span className="text-fg-3">/</span>
				<span className="text-fg">{c.title}</span>
			</div>

			<div className="flex items-start gap-4 rounded-lg border border-line bg-surface p-4">
				<PluginIcon id={view.id} enabled={view.enabled} size={56} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-xl font-semibold tracking-[-0.01em] text-fg">{c.title}</h3>
						<PluginState view={view} />
					</div>
					<div className="font-mono text-xs text-fg-3">{view.id}</div>
					<p className="mt-2 text-sm text-fg-2" data-testid="plugin-description">
						{c.description}
					</p>
				</div>
				{c.setup ? (
					<Button size="sm" onClick={() => runCommandUi("setup", "plugins")}>
						<IconWand /> {view.enabled ? "설정 바꾸기" : "켜기"}
					</Button>
				) : null}
			</div>

			<dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 rounded-lg border border-line bg-sunken p-4 text-sm">
				{facts.map(([k, v]) => (
					<div key={k} className="contents">
						<dt className="text-fg-3">{k}</dt>
						<dd className="min-w-0 text-fg">{v}</dd>
					</div>
				))}
			</dl>
			{c.privacy ? <p className="-mt-3 text-xs text-fg-3">{c.privacy}</p> : null}

			<Block icon={<IconTool />} title="도구" count={view.tools.length} testid="plugin-tools">
				{!view.live && view.tools.length ? <p className="text-xs text-fg-3">켜면 에이전트가 쓸 수 있는 도구예요.</p> : null}
				{view.tools.length ? (
					<ul className="divide-y divide-line rounded-lg border border-line bg-surface">
						{view.tools.map((t) => (
							<li key={t.name} className="flex min-w-0 items-center gap-3 px-3 py-2" data-testid="plugin-tool">
								<code className="shrink-0 font-mono text-xs text-fg">{t.name}</code>
								<span className="min-w-0 flex-1 truncate text-xs text-fg-3">{t.description}</span>
								{t.readOnly ? (
									<Badge variant="outline">
										<IconLock /> 읽기 전용
									</Badge>
								) : null}
							</li>
						))}
					</ul>
				) : (
					<p className="text-xs text-fg-3">{c.dynamicTools ? `${c.dynamicTools}. 켜고 연결하면 여기에 보여요.` : "이 플러그인은 자체 도구가 없어요."}</p>
				)}
				{view.live && c.dynamicTools && view.tools.length ? <p className="text-xs text-fg-3">{c.dynamicTools}.</p> : null}
			</Block>

			{view.mcpServers?.length ? (
				<Block icon={<IconServer />} title="MCP 서버" count={view.mcpServers.length} testid="plugin-servers">
					<div className="grid gap-2 sm:grid-cols-2">
						{view.mcpServers.map((s) => (
							<div key={s.server} className="rounded-lg border border-line bg-surface p-3">
								<div className="font-mono text-sm font-medium text-fg">{s.server}</div>
								<div className="mt-1 flex flex-wrap gap-1">
									{s.tools.map((t) => (
										<code key={t} className="rounded-xs bg-hover px-1.5 py-0.5 font-mono text-micro text-fg-2">
											{t}
										</code>
									))}
								</div>
							</div>
						))}
					</div>
				</Block>
			) : null}

			{view.id === "skills" ? (
				<Block icon={<IconSparkles />} title="스킬" count={skills.length} testid="plugin-skills">
					{skills.length ? (
						<ul className="divide-y divide-line rounded-lg border border-line bg-surface">
							{skills.map((s) => (
								<li key={s.name} className="flex min-w-0 items-center gap-3 px-3 py-2">
									<span className="shrink-0 font-mono text-xs text-fg">{s.name}</span>
									<span className="min-w-0 flex-1 truncate text-xs text-fg-3">{s.description}</span>
									<Badge variant={s.enabled ? "success" : "outline"}>{s.enabled ? "켜짐" : "꺼짐"}</Badge>
									{s.locked ? <Badge variant="neutral">내장</Badge> : null}
								</li>
							))}
						</ul>
					) : (
						<p className="text-xs text-fg-3">불러온 스킬이 없어요.</p>
					)}
					<div>
						<Button size="xs" variant="ghost" onClick={() => runCommandUi("skills")}>
							스킬 켜고 끄기
						</Button>
					</div>
				</Block>
			) : null}
		</div>
	);
}
