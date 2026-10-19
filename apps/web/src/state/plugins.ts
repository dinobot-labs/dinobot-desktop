/**
 * Plugins tab data. The daemon only says which plugins loaded and which tools they expose (/plugins), and which
 * skills exist (/skills list). Everything a person reads about a plugin (name, description, what it needs) comes from
 * PLUGIN_CATALOG, which mirrors the dinobot build's plugin catalog (src/plugins/index.ts) and setup copy.
 */
import { create } from "zustand";
import { readCommand } from "../lib/api.ts";
import { commandThread } from "./app.ts";

export type PluginIconId = "web" | "image_gen" | "browser" | "computer" | "google" | "github" | "mcp" | "aside" | "skills" | "unknown";

export interface ToolInfo {
	/** Exposed name, e.g. `web_search`. */
	name: string;
	description: string;
	readOnly?: boolean;
}

export interface CatalogPlugin {
	id: string;
	title: string;
	tagline: string;
	description: string;
	/** "기본 켜짐" plugins load without a manifest entry; "항상" cannot be turned off. */
	defaults: "on" | "off" | "always";
	/** Can be turned on/off in /setup plugins. */
	setup: boolean;
	needs: string;
	runtime?: string;
	/** Known tools; dynamic plugins (mcp, aside) report theirs only when loaded. */
	tools: ToolInfo[];
	dynamicTools?: string;
	config?: string;
	privacy?: string;
}

export const PLUGIN_CATALOG: readonly CatalogPlugin[] = [
	{
		id: "web",
		title: "웹 검색",
		tagline: "키 없이 인터넷을 검색해요",
		description: "Startpage에서 먼저 찾고, 막히면 DuckDuckGo로 넘어가요. site:, after:, \"구문\" 같은 검색 연산자를 이해하고 출처 링크와 요약을 돌려줘요.",
		defaults: "on",
		setup: false,
		needs: "없음",
		tools: [{ name: "web_search", description: "검색어로 웹을 찾아 번호 붙은 출처 목록을 돌려줘요", readOnly: true }],
		config: "plugins.web: false 로 끄기 · engines, timeoutSeconds",
		privacy: "대화에서 나온 검색어가 Startpage·DuckDuckGo로 전송돼요.",
	},
	{
		id: "image_gen",
		title: "이미지 생성",
		tagline: "ChatGPT 로그인으로 그림을 만들고 고쳐요",
		description: "저장된 OpenAI Codex(ChatGPT) 로그인으로 이미지를 새로 만들거나, 가진 이미지를 고쳐요. 결과는 작업 폴더의 generated_images/에 저장돼요.",
		defaults: "on",
		setup: false,
		needs: "OpenAI Codex(ChatGPT Plus/Pro) 로그인",
		tools: [{ name: "image_gen_generate", description: "설명대로 그림을 만들거나 참조 이미지를 편집해요" }],
		config: "plugins.image_gen: false 로 끄기 · outputDir, timeoutMs",
		privacy: "프롬프트와 참조 이미지가 그 ChatGPT 계정으로 OpenAI에 전송돼요.",
	},
	{
		id: "browser",
		title: "브라우저",
		tagline: "실제 Chrome으로 사이트를 열고 조작해요",
		description: "페이지를 열고 읽고, 클릭하고, 양식을 채우고, 스크린샷을 찍어요. 봇 전용 Chrome 프로필이나 내 Chrome에 붙어서 쓸 수 있어요.",
		defaults: "off",
		setup: true,
		needs: "설치된 Chrome 또는 Edge",
		runtime: "Patchright (격리된 자식 프로세스)",
		tools: [{ name: "browser_use", description: "open, snapshot, click, fill, screenshot 등 브라우저 동작" }],
		config: "mode: dedicated | attach · channels(기본 tui)",
	},
	{
		id: "computer",
		title: "컴퓨터 사용",
		tagline: "데스크톱 앱을 보고 조작해요",
		description: "창 목록과 화면·접근성 트리를 보고, 클릭·입력·단축키를 보내요. 가능하면 창을 앞으로 가져오지 않고 백그라운드로 보내요.",
		defaults: "off",
		setup: true,
		needs: "보조 프로그램 cua-driver (설정 마법사가 설치)",
		runtime: "cua-driver 0.34.0",
		tools: [{ name: "computer_use", description: "windows, observe, click, type_text, hotkey 등 데스크톱 동작" }],
		config: "channels(기본 tui) · takeover: auto | never",
	},
	{
		id: "google",
		title: "Google",
		tagline: "Gmail·캘린더·드라이브·연락처",
		description: "내 Google 계정의 메일, 일정, 파일, 연락처를 읽어요. 처음 쓸 때 에이전트가 로그인 링크를 보내 줘요. 쓰기는 따로 켜야 해요.",
		defaults: "off",
		setup: true,
		needs: "Google 계정 연결 (처음 쓸 때 링크로)",
		tools: [
			{ name: "google_connect", description: "연결 상태를 확인하고 필요하면 로그인 링크를 줘요", readOnly: true },
			{ name: "google_gmail_search", description: "Gmail 검색", readOnly: true },
			{ name: "google_calendar_list_events", description: "일정 조회", readOnly: true },
			{ name: "google_drive_search", description: "드라이브 파일 검색", readOnly: true },
			{ name: "google_people_search_contacts", description: "연락처 검색", readOnly: true },
		],
		dynamicTools: "켠 서비스와 write 설정에 따라 도구가 더 생겨요",
		config: "services: gmail, calendar, drive, people · write: true",
	},
	{
		id: "github",
		title: "GitHub",
		tagline: "이슈·PR·체크 결과를 읽어요",
		description: "이슈와 PR, 댓글, diff, CI 체크, 파일을 읽어요. write: true를 주면 댓글과 이슈 작성도 할 수 있어요.",
		defaults: "off",
		setup: false,
		needs: "토큰 환경 변수 (기본 GITHUB_TOKEN)",
		tools: [
			{ name: "github_list_issues", description: "이슈·PR 목록", readOnly: true },
			{ name: "github_get_pull_request", description: "PR 정보와 변경 파일", readOnly: true },
			{ name: "github_get_checks", description: "CI 체크 결과", readOnly: true },
			{ name: "github_get_file", description: "저장소 파일 읽기", readOnly: true },
			{ name: "github_comment", description: "댓글 작성 (write)" },
		],
		config: "dinobot.yaml에서 설정 · tokenEnv, repositories, write",
	},
	{
		id: "mcp",
		title: "MCP 서버",
		tagline: "설정한 MCP 서버의 도구를 붙여요",
		description: "dinobot.yaml에 적은 MCP 서버(stdio 또는 http)에 연결해서, 서버가 알려 준 도구를 mcp_<서버>_<도구> 이름으로 써요.",
		defaults: "off",
		setup: false,
		needs: "서버별 명령·URL과 자격 증명",
		tools: [],
		dynamicTools: "연결된 서버가 알려 준 도구",
		config: "dinobot.yaml의 plugins.mcp.servers",
	},
	{
		id: "aside",
		title: "Aside 브라우저",
		tagline: "내 Aside 브라우저를 조작해요",
		description: "로그인된 Aside 브라우저에서 Playwright 스타일 스크립트를 실행하거나, 작업 전체를 Aside 에이전트에 맡겨요.",
		defaults: "off",
		setup: false,
		needs: "Aside 앱과 Aside CLI 로그인",
		tools: [],
		dynamicTools: "Aside CLI가 알려 준 도구",
		config: "dinobot.yaml의 plugins.aside",
	},
	{
		id: "skills",
		title: "스킬",
		tagline: "작업 방법을 담은 스킬 묶음",
		description: "내장 스킬과 외부 폴더의 스킬을 불러와요. 스킬을 읽고 고치는 도구는 하네스가 따로 제공해요. 끌 수 없어요.",
		defaults: "always",
		setup: false,
		needs: "없음",
		tools: [],
		config: "skills.dirs 로 스킬 폴더 추가",
	},
];

/** One line of /plugins: `<id>: <tool>, <tool>` or `<id>: (no tools)`. */
export function parsePluginsOutput(text: string): Map<string, string[]> {
	const loaded = new Map<string, string[]>();
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line === "plugins:" || /^no plugins enabled$/.test(line)) continue;
		const m = /^([a-z][a-z0-9_]*):\s*(.*)$/.exec(line);
		if (!m) continue;
		const rest = (m[2] ?? "").trim();
		loaded.set(m[1] as string, rest === "" || rest === "(no tools)" ? [] : rest.split(",").map((t) => t.trim()).filter(Boolean));
	}
	return loaded;
}

export interface SkillRow {
	name: string;
	enabled: boolean;
	provenance: string;
	locked: boolean;
	description: string;
}

/** /skills list rows: `[x] name  provenance  [locked  ]~N tok  description`. */
export function parseSkillsOutput(text: string): SkillRow[] {
	const rows: SkillRow[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const m = /^\[(x| )\]\s+(\S+)\s{2,}(.*)$/.exec(raw.trim());
		if (!m) continue;
		const parts = (m[3] ?? "").split(/\s{2,}/);
		const provenance = parts.shift() ?? "";
		const locked = parts[0] === "locked";
		if (locked) parts.shift();
		if (parts[0] && /^~\d+ tok$/.test(parts[0])) parts.shift();
		rows.push({ name: m[2] as string, enabled: m[1] === "x", provenance, locked, description: parts.join("  ") });
	}
	return rows;
}

export interface McpServerGroup {
	server: string;
	tools: string[];
}

export interface PluginView {
	id: string;
	catalog: CatalogPlugin;
	enabled: boolean;
	/** Tools the daemon reports (enabled) or the catalog's known tools (off). */
	tools: ToolInfo[];
	/** True when `tools` came from the running daemon. */
	live: boolean;
	mcpServers?: McpServerGroup[];
}

function unknownCatalog(id: string): CatalogPlugin {
	return { id, title: id, tagline: "이 빌드가 알려 준 플러그인", description: "데몬이 불러온 플러그인이에요. 설명은 dinobot 문서를 보세요.", defaults: "off", setup: false, needs: "dinobot.yaml 설정", tools: [] };
}

/** MCP tools are `mcp_<server>_<tool>`; server names may contain `_`, so group by the configured-server guess: first segment. */
function groupMcp(tools: string[]): McpServerGroup[] {
	const by = new Map<string, string[]>();
	for (const t of tools) {
		const rest = t.replace(/^mcp_/, "");
		const i = rest.indexOf("_");
		const server = i > 0 ? rest.slice(0, i) : rest;
		by.set(server, [...(by.get(server) ?? []), i > 0 ? rest.slice(i + 1) : rest]);
	}
	return [...by.entries()].map(([server, list]) => ({ server, tools: list }));
}

/** Catalog order first, then any loaded plugin the catalog does not know. Enabled is exactly "the daemon loaded it". */
export function buildPluginViews(loaded: Map<string, string[]>): PluginView[] {
	const ids = [...PLUGIN_CATALOG.map((p) => p.id), ...[...loaded.keys()].filter((id) => !PLUGIN_CATALOG.some((p) => p.id === id))];
	return ids.map((id) => {
		const catalog = PLUGIN_CATALOG.find((p) => p.id === id) ?? unknownCatalog(id);
		const names = loaded.get(id);
		if (!names) return { id, catalog, enabled: false, tools: catalog.tools, live: false };
		const tools = names.map((name) => catalog.tools.find((t) => t.name === name) ?? { name, description: "" });
		return { id, catalog, enabled: true, tools, live: true, ...(id === "mcp" ? { mcpServers: groupMcp(names) } : {}) };
	});
}

interface PluginsState {
	loading: boolean;
	loaded: boolean;
	views: PluginView[];
	skills: SkillRow[];
	error?: string;
}

export const usePlugins = create<PluginsState>(() => ({ loading: false, loaded: false, views: buildPluginViews(new Map()), skills: [] }));

export async function refreshPlugins(): Promise<void> {
	usePlugins.setState({ loading: true });
	const key = commandThread();
	try {
		const [plugins, skills] = await Promise.all([readCommand(key, "plugins"), readCommand(key, "skills", "list")]);
		const text = (r: typeof plugins) => r.lines.map((l) => l.text).join("\n");
		usePlugins.setState({
			loading: false,
			loaded: true,
			views: buildPluginViews(parsePluginsOutput(text(plugins))),
			skills: parseSkillsOutput(text(skills)),
			error: plugins.error ?? undefined,
		});
	} catch (error) {
		usePlugins.setState({ loading: false, loaded: true, error: error instanceof Error ? error.message : String(error) });
	}
}
