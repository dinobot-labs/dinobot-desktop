import { expect, test } from "bun:test";
import { buildPluginViews, PLUGIN_CATALOG, parsePluginsOutput, parseSkillsOutput } from "../src/state/plugins.ts";

const OUTPUT = [
	"plugins:",
	"computer: computer_use",
	"mcp: mcp_aside_repl, mcp_aside_memory_search, mcp_aside_exec, mcp_local_search",
	"browser: browser_use",
	"image_gen: image_gen_generate",
	"web: web_search",
	"skills: (no tools)",
].join("\n");

test("parses /plugins output", () => {
	const loaded = parsePluginsOutput(OUTPUT);
	expect([...loaded.keys()]).toEqual(["computer", "mcp", "browser", "image_gen", "web", "skills"]);
	expect(loaded.get("skills")).toEqual([]);
	expect(loaded.get("mcp")).toHaveLength(4);
	expect(parsePluginsOutput("no plugins enabled").size).toBe(0);
});

test("enabled is exactly what the daemon loaded; off plugins show catalog tools", () => {
	const views = buildPluginViews(parsePluginsOutput(OUTPUT));
	expect(views.map((v) => v.id).slice(0, PLUGIN_CATALOG.length)).toEqual(PLUGIN_CATALOG.map((p) => p.id));
	const on = views.filter((v) => v.enabled).map((v) => v.id).sort();
	expect(on).toEqual(["browser", "computer", "image_gen", "mcp", "skills", "web"]);
	const web = views.find((v) => v.id === "web");
	expect(web?.live).toBe(true);
	expect(web?.tools[0]).toMatchObject({ name: "web_search", readOnly: true });
	const github = views.find((v) => v.id === "github");
	expect(github?.enabled).toBe(false);
	expect(github?.live).toBe(false);
	expect(github?.tools.length).toBeGreaterThan(0);
	const mcp = views.find((v) => v.id === "mcp");
	expect(mcp?.mcpServers).toEqual([
		{ server: "aside", tools: ["repl", "memory_search", "exec"] },
		{ server: "local", tools: ["search"] },
	]);
});

test("unknown loaded plugin still gets a card", () => {
	const views = buildPluginViews(new Map([["future_thing", ["future_thing_go"]]]));
	const v = views.find((x) => x.id === "future_thing");
	expect(v?.enabled).toBe(true);
	expect(v?.tools).toEqual([{ name: "future_thing_go", description: "" }]);
});

test("parses /skills list rows", () => {
	const rows = parseSkillsOutput(
		["skills:", "[x] programming  bundled  locked  ~120 tok  Core discipline for programming work", "[ ] my-skill  agent  ~40 tok  Does a thing  with gaps", "enabled 1/2, catalog ~120 tok; changes apply to new conversations (/new)"].join("\n"),
	);
	expect(rows).toEqual([
		{ name: "programming", enabled: true, provenance: "bundled", locked: true, description: "Core discipline for programming work" },
		{ name: "my-skill", enabled: false, provenance: "agent", locked: false, description: "Does a thing  with gaps" },
	]);
});
