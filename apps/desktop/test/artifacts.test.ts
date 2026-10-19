import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { absoluteArtifactPath, MAX_HTML_BYTES, readArtifact, statArtifacts } from "../src/features/artifacts.ts";

let dir: string;
let data: string;
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';

beforeAll(() => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "dinobot-art-")));
	data = join(dir, "data");
	mkdirSync(data);
	mkdirSync(join(dir, "folder.html"));
	writeFileSync(join(dir, "page.html"), "<h1>안녕</h1>");
	writeFileSync(join(dir, "chart.png"), PNG);
	writeFileSync(join(dir, "fake.png"), "<html>not a png</html>");
	writeFileSync(join(dir, "diagram.svg"), SVG);
	writeFileSync(join(dir, "fake.svg"), "hello");
	writeFileSync(join(dir, "notes.txt"), "secret");
	writeFileSync(join(dir, "empty.html"), "");
	writeFileSync(join(dir, "huge.html"), Buffer.alloc(MAX_HTML_BYTES + 1, 32));
	writeFileSync(join(data, "dinobot.html"), "<p>inside the data dir</p>");
	try {
		symlinkSync(join(data, "dinobot.html"), join(dir, "link.html"));
	} catch {}
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const policy = () => ({ blockedDirs: [data], home: dir });

describe("artifact files", () => {
	test("absolute paths only; ~ expands to home", () => {
		expect(absoluteArtifactPath("~/page.html", dir)).toBe(join(dir, "page.html"));
		expect(absoluteArtifactPath("page.html", dir)).toBeUndefined();
		expect(absoluteArtifactPath("  ", dir)).toBeUndefined();
	});

	test("stat keeps only allowed, existing, non-empty HTML pages and images", async () => {
		const list = await statArtifacts(
			[join(dir, "page.html"), "~/chart.png", join(dir, "notes.txt"), join(dir, "missing.png"), join(dir, "empty.html"), join(dir, "folder.html"), join(data, "dinobot.html"), "relative.png", 42],
			policy(),
		);
		expect(list.map((s) => (s.ok ? `${s.kind}:${s.path === join(dir, s.path.split(/[\\/]/).pop() ?? "") }` : s.error))).toEqual([
			"html:true",
			"image:true",
			"not an HTML page or image",
			"missing",
			"empty file",
			"not a file",
			"blocked folder",
			"not an absolute path",
			"not a path",
		]);
	});

	test("a symlink into the blocked folder is refused", async () => {
		const link = join(dir, "link.html");
		const result = await readArtifact(link, policy());
		// Symlinks need privileges on some Windows setups; when the link exists it must be refused.
		if (!("error" in result && result.error === "missing")) expect(result).toEqual({ error: "blocked folder" });
	});

	test("read: HTML as text, raster by magic bytes, SVG checked, size bounded", async () => {
		const html = await readArtifact(join(dir, "page.html"), policy());
		expect(html).toMatchObject({ kind: "html", text: "<h1>안녕</h1>" });
		expect(await readArtifact(join(dir, "chart.png"), policy())).toMatchObject({ kind: "image", mimeType: "image/png", data: PNG.toString("base64") });
		expect(await readArtifact(join(dir, "diagram.svg"), policy())).toMatchObject({ kind: "image", mimeType: "image/svg+xml", data: Buffer.from(SVG).toString("base64") });
		expect(await readArtifact(join(dir, "fake.png"), policy())).toEqual({ error: "not a png/jpeg/gif/webp image" });
		expect(await readArtifact(join(dir, "fake.svg"), policy())).toEqual({ error: "not an SVG image" });
		expect(await readArtifact(join(dir, "huge.html"), policy())).toEqual({ error: "5.0 MiB is over the 5.0 MiB preview limit" });
		expect(await readArtifact(join(dir, "notes.txt"), policy())).toEqual({ error: "not an HTML page or image" });
	});
});
