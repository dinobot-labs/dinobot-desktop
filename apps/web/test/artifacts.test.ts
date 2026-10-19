import { describe, expect, test } from "bun:test";
import type { ClientEvent, EntryRecord } from "@dinobot/contracts";
import { artifactCandidates, artifactKey, pathsInText, pathsInToolCall, pathsInToolResult, recordArtifacts, resolveArtifactPath, type ArtifactMention } from "../src/chat/artifacts.ts";
import { createChatData, reduceEvent } from "../src/chat/model.ts";

describe("pathsInText", () => {
	test("Windows, POSIX, relative, file:// and code-span paths", () => {
		const text = [
			"저장했어요: C:\\Users\\테스트\\generated_images\\cat.png에 있어요.",
			"보고서는 `C:/work/out/My Report.html` 입니다.",
			"리눅스: /tmp/chart.svg, 홈: ~/site/index.htm",
			"상대 경로 ./out/report.html 와 generated_images/dog.webp",
			"링크 [열기](docs/page.html) 그리고 file:///C:/x/y%20z.jpg",
		].join("\n");
		expect(pathsInText(text)).toEqual([
			"C:/work/out/My Report.html",
			"C:/x/y z.jpg",
			"C:\\Users\\테스트\\generated_images\\cat.png",
			"/tmp/chart.svg",
			"~/site/index.htm",
			"./out/report.html",
			"generated_images/dog.webp",
			"docs/page.html",
		]);
	});

	test("URLs, globs, other extensions and prose are not artifacts", () => {
		const text = "https://example.com/a.png 와 //cdn.x/b.svg, *.png, notes.md, main.ts, data.json, image.pngx, 그림.png.bak";
		expect(pathsInText(text)).toEqual([]);
	});

	test("duplicates collapse to one in order of appearance", () => {
		expect(pathsInText("a.png b.html a.png `a.png`")).toEqual(["a.png", "b.html"]);
	});
});

describe("pathsInToolCall / pathsInToolResult", () => {
	test("write and edit arguments", () => {
		expect(pathsInToolCall("write", { path: "out/index.html", content: "<p>" })).toEqual(["out/index.html"]);
		expect(pathsInToolCall("edit", { path: "C:\\a\\b.svg" })).toEqual(["C:\\a\\b.svg"]);
		expect(pathsInToolCall("write", { path: "src/app.ts" })).toEqual([]);
		expect(pathsInToolCall("read", { path: "a.png" })).toEqual([]);
	});

	test("tools.write literals inside codemode, template strings with interpolation skipped", () => {
		const code = [
			'await tools.write({path: "C:\\\\Users\\\\me\\\\report.html", content: html});',
			"await tools.write({ content: x, path: 'out/chart.png' });",
			"await tools.write({path: `${dir}/x.html`, content});",
			'await tools.read({path: "skip.png"});',
		].join("\n");
		expect(pathsInToolCall("codemode", { code })).toEqual(["C:\\Users\\me\\report.html", "out/chart.png"]);
	});

	test("image_gen results, direct or through codemode", () => {
		const text = 'Saved generated image to C:\\Users\\me\\generated_images\\img-1.png\n{"size":"1024x1024"}';
		expect(pathsInToolResult("image_gen_generate", text)).toEqual(["C:\\Users\\me\\generated_images\\img-1.png"]);
		expect(pathsInToolResult("codemode", `cell\n${text}`)).toEqual(["C:\\Users\\me\\generated_images\\img-1.png"]);
		expect(pathsInToolResult("bash", text)).toEqual([]);
	});
});

describe("resolution and candidates", () => {
	test("resolveArtifactPath", () => {
		expect(resolveArtifactPath("out/a.png", "C:\\work\\proj\\")).toBe("C:\\work\\proj\\out/a.png");
		expect(resolveArtifactPath("./a.html", "/home/me")).toBe("/home/me/a.html");
		expect(resolveArtifactPath("/c/Users/me/a.png", "C:\\Users\\me")).toBe("C:/Users/me/a.png");
		expect(resolveArtifactPath("/c/Users/me/a.png", "/home/me")).toBe("/c/Users/me/a.png");
		expect(resolveArtifactPath("~/a.png", undefined)).toBe("~/a.png");
		expect(resolveArtifactPath("a.png", undefined)).toBeUndefined();
	});

	test("newest first, one per file (case-insensitive on Windows), write kept over a later mention", () => {
		const map = new Map<string, ArtifactMention>();
		expect(recordArtifacts(map, ["out/a.html"], "write", 1)).toBe(true);
		expect(recordArtifacts(map, ["C:\\W\\img.png"], "image", 2)).toBe(true);
		expect(recordArtifacts(map, ["C:\\w\\OUT\\a.html", "notes.png"], "mention", 3)).toBe(true);
		expect(recordArtifacts(map, ["notes.png"], "mention", 3)).toBe(false);
		const list = artifactCandidates(map, "C:\\w");
		expect(list.map((c) => [c.name, c.source, c.at, c.kind])).toEqual([
			["a.html", "mention", 3, "html"],
			["notes.png", "mention", 3, "image"],
			["img.png", "image", 2, "image"],
		]);
		expect(artifactKey("C:\\w\\OUT\\a.html")).toBe(artifactKey("c:/W/out/a.html"));
		recordArtifacts(map, ["out/a.html"], "mention", 4);
		expect(map.get("out/a.html")?.source).toBe("write");
	});
});

describe("reducer", () => {
	const now = 1_800_000_000_000;
	let id = 0;
	const entry = (kind: string, message: unknown): EntryRecord => ({ id: ++id, conversationId: 1, kind, model: [message] }) as unknown as EntryRecord;
	const assistant = (content: unknown[], timestamp: number) => ({ role: "assistant", content, api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp });

	test("snapshot replay collects written files, generated images and answer paths; errors and partials do not count", () => {
		const d = createChatData();
		const snapshot = {
			type: "snapshot",
			entries: [
				entry("pi.assistant", assistant([{ type: "toolCall", id: "w1", name: "write", arguments: { path: "out/report.html", content: "<h1>hi</h1>" } }], now + 1)),
				entry("pi.tool-result", { role: "toolResult", toolCallId: "w1", toolName: "write", content: [{ type: "text", text: "ok" }], isError: false, timestamp: now + 2 }),
				entry("pi.assistant", assistant([{ type: "toolCall", id: "g1", name: "image_gen_generate", arguments: { prompt: "cat" } }], now + 3)),
				entry("pi.tool-result", { role: "toolResult", toolCallId: "g1", toolName: "image_gen_generate", content: [{ type: "text", text: "Saved generated image to C:\\proj\\generated_images\\cat.png\n{}" }], isError: false, timestamp: now + 4 }),
				entry("pi.tool-result", { role: "toolResult", toolCallId: "g2", toolName: "image_gen_generate", content: [{ type: "text", text: "Saved generated image to C:\\proj\\bad.png" }], isError: true, timestamp: now + 5 }),
				entry("pi.assistant", assistant([{ type: "text", text: "완성했어요. `out/report.html`과 C:\\proj\\generated_images\\cat.png를 보세요." }], now + 6)),
			],
			tools: [],
			agent: { cwd: "C:\\proj" },
			usage: { models: {}, tools: {} },
			workflow: null,
			dag: null,
			queue: [],
		} as unknown as ClientEvent;
		reduceEvent(d, snapshot, now + 10);
		expect(artifactCandidates(d.artifacts, d.agent.cwd).map((c) => [c.path, c.source])).toEqual([
			["C:\\proj\\out/report.html", "write"],
			["C:\\proj\\generated_images\\cat.png", "image"],
		]);
		// A streaming partial that names a path is not recorded until the message settles.
		reduceEvent(d, { type: "message_start", message: assistant([{ type: "text", text: "draft C:\\proj\\later.png" }], now + 20) } as unknown as ClientEvent, now + 20);
		expect(d.artifacts.has("C:\\proj\\later.png")).toBe(false);
	});
});
