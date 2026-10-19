import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitBranch } from "../src/features/exec.ts";
import { clearWorkspaceCache, fuzzyMatch, rankTop, readLineRange, refsComplete, refsExpand } from "../src/features/refs.ts";

let root: string;
let repo: string;
let plain: string;
let home: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "dinobot-refs-"));
	repo = join(root, "repo");
	mkdirSync(join(repo, "src", "lib"), { recursive: true });
	writeFileSync(join(repo, "src", "app.ts"), "line1\nline2\nline3\nline4\n");
	writeFileSync(join(repo, "src", "lib", "util.ts"), "export const x = 1;\n");
	writeFileSync(join(repo, "README.md"), "# readme\n");
	writeFileSync(join(repo, ".gitignore"), "ignored.log\n");
	writeFileSync(join(repo, "ignored.log"), "secret\n");
	git(repo, "init", "-q", "-b", "main");
	git(repo, "config", "user.email", "t@example.com");
	git(repo, "config", "user.name", "t");
	git(repo, "config", "commit.gpgsign", "false");
	git(repo, "add", ".");
	git(repo, "commit", "-q", "-m", "first commit");
	writeFileSync(join(repo, "untracked.txt"), "new file\n");

	plain = join(root, "plain");
	mkdirSync(join(plain, "docs"), { recursive: true });
	writeFileSync(join(plain, "docs", "guide.md"), "guide\n");
	mkdirSync(join(plain, "node_modules", "pkg"), { recursive: true });
	writeFileSync(join(plain, "node_modules", "pkg", "index.js"), "x\n");

	home = join(root, "home");
	mkdirSync(join(home, ".ssh"), { recursive: true });
	mkdirSync(join(home, ".aws"), { recursive: true });
	mkdirSync(join(home, "data"), { recursive: true });
	writeFileSync(join(home, ".ssh", "id_rsa"), "PRIVATE");
	writeFileSync(join(home, ".aws", "credentials"), "AWS");
	writeFileSync(join(home, ".env"), "TOKEN=1");
	writeFileSync(join(home, ".env.example"), "TOKEN=");
	writeFileSync(join(home, "data", "auth.json"), "{}");
	writeFileSync(join(home, "notes.md"), "notes\n");
	clearWorkspaceCache();
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("refsComplete", () => {
	test("empty token lists the five kinds first, then folders and files", async () => {
		const rows = await refsComplete(repo, "");
		expect(rows.slice(0, 5).map((row) => row.label)).toEqual(["@diff", "@staged", "@file:", "@folder:", "@git:"]);
		expect(rows.slice(0, 5).every((row) => row.kind === "kind")).toBe(true);
		expect(rows[0]).toEqual({ insert: "@diff ", label: "@diff", description: "Unstaged changes (git diff)", kind: "kind" });
		expect(rows[2]?.insert).toBe("@file:");
		const paths = rows.slice(5).map((row) => row.label);
		expect(paths).toContain("src/");
		expect(paths).toContain("src/lib/");
		expect(paths).toContain("src/app.ts");
		expect(paths).toContain("untracked.txt"); // untracked but not ignored
		expect(paths).not.toContain("ignored.log");
		const app = rows.find((row) => row.label === "src/app.ts");
		expect(app).toEqual({ insert: "@file:src/app.ts ", label: "src/app.ts", description: "24 B", kind: "file" });
		expect(rows.find((row) => row.label === "src/")).toEqual({ insert: "@folder:src ", label: "src/", description: "folder", kind: "folder" });
	});

	test("file: lists files only, folder: folders only, git: nothing", async () => {
		const files = await refsComplete(repo, "file:app");
		expect(files.length).toBeGreaterThan(0);
		expect(files.every((row) => row.kind === "file")).toBe(true);
		expect(files[0]?.insert).toBe("@file:src/app.ts ");
		const folders = await refsComplete(repo, "folder:");
		expect(folders.map((row) => row.label).sort()).toEqual(["src/", "src/lib/"]);
		expect(await refsComplete(repo, "git:")).toEqual([]);
	});

	test("fuzzy query ranks kinds and paths", async () => {
		const rows = await refsComplete(repo, "di");
		expect(rows[0]?.label).toBe("@diff");
		const util = await refsComplete(repo, "utl");
		expect(util.some((row) => row.label === "src/lib/util.ts")).toBe(true);
	});

	test("quotes paths that need quoting", async () => {
		const rows = await refsComplete(repo, "ab", async () => [{ path: "my docs/a b.md", dir: false, size: 3 }]);
		expect(rows.find((row) => row.kind === "file")?.insert).toBe("@file:`my docs/a b.md` ");
	});

	test("outside git: a bounded walk skipping dot folders and node_modules", async () => {
		const rows = await refsComplete(plain, "");
		const labels = rows.slice(5).map((row) => row.label);
		expect(labels).toEqual(["docs/", "docs/guide.md"]);
	});

	test("at most 50 rows", async () => {
		const many = Array.from({ length: 5000 }, (_, i) => ({ path: `dir/file${i}.ts`, dir: false, size: i }));
		expect((await refsComplete(repo, "", async () => many)).length).toBe(50);
		const ranked = await refsComplete(repo, "file1", async () => many);
		expect(ranked.length).toBe(50);
		expect(ranked.some((row) => row.label === "dir/file1.ts")).toBe(true);
	});

	test("rankTop keeps the best k in order and never holds the loop long on big inputs", async () => {
		const items = Array.from({ length: 60000 }, (_, i) => `src/components/deeper/folder/item${i}.tsx`);
		let longest = 0;
		let last = performance.now();
		let running = true;
		const probe = () => {
			const now = performance.now();
			longest = Math.max(longest, now - last);
			last = now;
			if (running) setImmediate(probe);
		};
		setImmediate(probe);
		const top = await rankTop(items, "item59999", (s) => s, 5);
		running = false;
		expect(longest).toBeLessThan(25);
		expect(top[0]).toBe("src/components/deeper/folder/item59999.tsx");
		expect(top.length).toBeLessThanOrEqual(5);
		expect(fuzzyMatch("abc", "a_b_c").matches).toBe(true);
		expect(fuzzyMatch("cba", "abc").matches).toBe(false);
	});
});

describe("refsExpand", () => {
	test("no references: text unchanged", async () => {
		expect(await refsExpand(repo, "hello there", {})).toEqual({ text: "hello there", warnings: [] });
	});

	test("@file with and without a line range", async () => {
		const whole = await refsExpand(repo, "look at @file:src/app.ts", {});
		expect(whole.blocked).toBeUndefined();
		expect(whole.text).toContain("look at @file:src/app.ts\n\n--- Attached Context ---\n\n📄 @file:src/app.ts (");
		expect(whole.text).toContain("```typescript\nline1\nline2\nline3\nline4\n\n```");
		const range = await refsExpand(repo, "see @file:src/app.ts:2-3.", {});
		expect(range.text).toContain("```typescript\nline2\nline3\n```");
	});

	test("@folder lists the tree", async () => {
		const result = await refsExpand(repo, "@folder:src", {});
		expect(result.text).toContain("📁 @folder:src");
		expect(result.text).toContain("- app.ts (5 lines)");
		expect(result.text).toMatch(/lib\//);
	});

	test("@diff, @staged and @git:N run hardened git", async () => {
		writeFileSync(join(repo, "README.md"), "# readme\nchanged\n");
		const diff = await refsExpand(repo, "@diff", {});
		expect(diff.text).toContain("🧾 git diff (");
		expect(diff.text).toContain("+changed");
		git(repo, "add", "README.md");
		const staged = await refsExpand(repo, "@staged", {});
		expect(staged.text).toContain("🧾 git diff --staged (");
		expect(staged.text).toContain("+changed");
		const log = await refsExpand(repo, "@git:99", {});
		expect(log.text).toContain("🧾 git log -10 -p (");
		expect(log.text).toContain("first commit");
	});

	test("refuses sensitive home paths, .env files, the data dir and paths outside the workspace", async () => {
		const result = await refsExpand(home, "@file:.ssh/id_rsa @file:.aws/credentials @file:.env @file:data/auth.json @file:../repo/README.md @file:.env.example", { home, blockedDirs: [join(home, "data")] });
		expect(result.blocked).toBeUndefined();
		expect(result.warnings).toContain("@file:.ssh/id_rsa: path is a sensitive credential file and cannot be attached");
		expect(result.warnings).toContain("@file:.aws/credentials: path is a sensitive credential file and cannot be attached");
		expect(result.warnings).toContain("@file:.env: path is a sensitive credential file and cannot be attached");
		expect(result.warnings).toContain("@file:data/auth.json: path is a sensitive credential file and cannot be attached");
		expect(result.warnings).toContain("@file:../repo/README.md: path is outside the allowed workspace");
		expect(result.text).not.toContain("PRIVATE");
		expect(result.text).not.toContain("AWS\n");
		expect(result.text).toContain("--- Context Warnings ---");
		expect(result.text).toContain("📄 @file:.env.example");
	});

	test("missing paths and wrong kinds warn", async () => {
		const result = await refsExpand(repo, "@file:nope.ts @folder:README.md @file:src", {});
		expect(result.warnings).toEqual(["@file:nope.ts: file not found", "@folder:README.md: path is not a folder", "@file:src: path is not a file"]);
	});

	test("budget: past 50% of the window is refused with the original text, past 25% warns", async () => {
		for (const name of ["a", "b", "c"]) writeFileSync(join(repo, `${name}.txt`), "x".repeat(600));
		writeFileSync(join(repo, "big.txt"), "x".repeat(1000));
		const text = "attach @file:a.txt @file:b.txt @file:c.txt";
		const blocked = await refsExpand(repo, text, { contextWindow: 400 });
		expect(blocked.text).toBe(text);
		expect(blocked.blocked).toMatch(/^@ context injection refused: \d+ tokens exceeds the 50% hard limit \(200\)\.$/);
		expect(blocked.warnings).toContain(blocked.blocked!);
		const soft = await refsExpand(repo, text, { contextWindow: 1600 });
		expect(soft.blocked).toBeUndefined();
		expect(soft.warnings.some((w) => w.includes("25% soft limit (400)"))).toBe(true);
		expect(soft.text).toContain("--- Attached Context ---");
		const oversized = await refsExpand(repo, "attach @file:big.txt", { contextWindow: 400 });
		// A file past the per-reference budget becomes an on-disk pointer instead of inline text.
		expect(oversized.text).toContain("too large to inline safely.");
	});

	test("at most 16 references", async () => {
		const text = Array.from({ length: 18 }, () => "@file:README.md").join(" ");
		const result = await refsExpand(repo, text, {});
		expect(result.warnings.filter((w) => w.includes("maximum 16 @-references")).length).toBe(2);
	});

	test("line ranges stream large files", async () => {
		const path = join(root, "lines.txt");
		writeFileSync(path, Array.from({ length: 200000 }, (_, i) => `row ${i + 1}`).join("\n"));
		expect(await readLineRange(path, 150000, 150002)).toBe("row 150000\nrow 150001\nrow 150002");
		expect(await readLineRange(path, 199999, 300000)).toBe("row 199999\nrow 200000");
	});
});

describe("gitBranch", () => {
	test("branch of a repository, null elsewhere", async () => {
		expect(await gitBranch(repo)).toBe("main");
		expect(await gitBranch(plain)).toBeNull();
		expect(await gitBranch(join(root, "missing"))).toBeNull();
	});
});
