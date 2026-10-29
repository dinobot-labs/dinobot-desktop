import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, lutimesSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { MAX_IN_MEMORY_ATTACHMENT_BYTES } from "../src/bridge-types.ts";
import { ensureAttachmentRoot, pruneAttachments, RETENTION_MS, safeAttachmentName, STAGE_DIR_RE, stageAttachmentData, stageAttachmentPath } from "../src/features/attachments.ts";

const base = mkdtempSync(join(tmpdir(), "dinobot-attach-test-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let seq = 0;
/** A fresh attachment root and source folder per test (pruning runs once per root). */
function fixture() {
	const dir = join(base, `case-${++seq}`);
	const root = join(dir, "root");
	const src = join(dir, "src");
	mkdirSync(src, { recursive: true });
	return { root, src };
}
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const stageDirs = (root: string) => (existsSync(root) ? readdirSync(root).filter((n) => STAGE_DIR_RE.test(n)) : []);
const posix = process.platform !== "win32";

describe("stageAttachmentPath", () => {
	test("copies the file byte for byte into a fresh private folder and keeps its name", async () => {
		const { root, src } = fixture();
		const source = join(src, "화면 기록 2026-10-18 오후 11.56.02.mov");
		writeFileSync(source, randomBytes(3 * 1024 * 1024 + 17));
		const staged = await stageAttachmentPath(source, root);
		if ("error" in staged) throw new Error(staged.error);
		expect(staged.kind).toBe("file");
		expect(staged.name).toBe(basename(source));
		expect(basename(staged.path)).toBe(basename(source));
		expect(dirname(dirname(staged.path))).toBe(root);
		expect(STAGE_DIR_RE.test(basename(dirname(staged.path)))).toBe(true);
		expect(staged.bytes).toBe(statSync(source).size);
		expect(sha(staged.path)).toBe(sha(source));
		if (posix) expect(statSync(dirname(staged.path)).mode & 0o777).toBe(0o700);
	});

	test("the same name twice lands in two folders, both intact", async () => {
		const { root, src } = fixture();
		const source = join(src, "report.pdf");
		writeFileSync(source, "first");
		const a = await stageAttachmentPath(source, root);
		writeFileSync(source, "second");
		const b = await stageAttachmentPath(source, root);
		if ("error" in a || "error" in b) throw new Error("staging failed");
		expect(a.path).not.toBe(b.path);
		expect(readFileSync(a.path, "utf8")).toBe("first");
		expect(readFileSync(b.path, "utf8")).toBe("second");
		expect(stageDirs(root)).toHaveLength(2);
	});

	test("a folder is referenced in place, never copied", async () => {
		const { root, src } = fixture();
		const folder = join(src, "project");
		mkdirSync(join(folder, "sub"), { recursive: true });
		const staged = await stageAttachmentPath(folder, root);
		expect(staged).toEqual({ kind: "folder", path: folder, name: "project", bytes: 0 });
		expect(stageDirs(root)).toHaveLength(0);
	});

	test("a missing file is an error and leaves no folder behind", async () => {
		const { root, src } = fixture();
		const staged = await stageAttachmentPath(join(src, "gone.mov"), root);
		expect("error" in staged && staged.error).toContain("gone.mov: cannot read it (ENOENT)");
		expect(stageDirs(root)).toHaveLength(0);
	});

	test.skipIf(!posix)("a FIFO is refused instead of read (it would block)", async () => {
		const { root, src } = fixture();
		const fifo = join(src, "pipe");
		execFileSync("mkfifo", [fifo]);
		const staged = await stageAttachmentPath(fifo, root);
		expect("error" in staged && staged.error).toBe("pipe: not a regular file");
		expect(stageDirs(root)).toHaveLength(0);
	});

	test.skipIf(!posix || process.getuid?.() === 0)("a failed copy removes its half-made folder", async () => {
		const { root, src } = fixture();
		const source = join(src, "locked.bin");
		writeFileSync(source, "secret");
		chmodSync(source, 0o000);
		try {
			const staged = await stageAttachmentPath(source, root);
			expect("error" in staged && staged.error).toContain("locked.bin: cannot copy it (EACCES)");
			expect(stageDirs(root)).toHaveLength(0);
		} finally {
			chmodSync(source, 0o600);
		}
	});
});

describe("the attachment root must be private", () => {
	test("a symlinked root is refused and its target stays untouched", async () => {
		const { root, src } = fixture();
		const elsewhere = join(src, "elsewhere");
		mkdirSync(elsewhere);
		mkdirSync(dirname(root), { recursive: true });
		symlinkSync(elsewhere, root, process.platform === "win32" ? "junction" : "dir");
		const source = join(src, "a.txt");
		writeFileSync(source, "a");
		const staged = await stageAttachmentPath(source, root);
		expect("error" in staged && staged.error).toBe(`a.txt: cannot use the attachment folder (${root} is not a folder)`);
		expect(readdirSync(elsewhere)).toEqual([]);
	});

	test.skipIf(!posix)("a root other users can write is refused", async () => {
		const { root } = fixture();
		mkdirSync(root, { recursive: true });
		chmodSync(root, 0o777);
		await expect(ensureAttachmentRoot(root)).rejects.toThrow(`${root} is writable by another user`);
		const staged = await stageAttachmentData("a.txt", new Uint8Array([1]), root);
		expect("error" in staged).toBe(true);
		expect(stageDirs(root)).toHaveLength(0);
	});

	test("a fresh root is created private", async () => {
		const { root } = fixture();
		await ensureAttachmentRoot(root);
		if (posix) expect(statSync(root).mode & 0o777).toBe(0o700);
	});
});

describe("stageAttachmentData", () => {
	test("writes in-memory data under a safe name", async () => {
		const { root } = fixture();
		const data = new Uint8Array(randomBytes(4096));
		const staged = await stageAttachmentData("../../clip$board.png", data, root);
		if ("error" in staged) throw new Error(staged.error);
		expect(staged).toMatchObject({ kind: "file", name: "clip$board.png", bytes: 4096 });
		expect(basename(staged.path)).toBe("clip_board.png");
		expect(dirname(dirname(staged.path))).toBe(root);
		expect(Buffer.compare(readFileSync(staged.path), Buffer.from(data))).toBe(0);
	});

	test("refuses data over the in-memory bound without writing", async () => {
		const { root } = fixture();
		const huge = { byteLength: MAX_IN_MEMORY_ATTACHMENT_BYTES + 1 } as Uint8Array;
		const staged = await stageAttachmentData("big.bin", huge, root);
		expect("error" in staged && staged.error).toBe("big.bin: a file without a path on disk can be up to 100 MB");
		expect(stageDirs(root)).toHaveLength(0);
	});
});

describe("safeAttachmentName", () => {
	test.each([
		["화면 기록 2026-10-18 오후 11.56.02.mov", "화면 기록 2026-10-18 오후 11.56.02.mov"],
		["a/b/c.txt", "c.txt"],
		["C:\\Users\\me\\notes.md", "notes.md"],
		["../../etc/passwd", "passwd"],
		['say "hi" $HOME `id` back\\slash.txt', "slash.txt"],
		['say "hi" $HOME `id`.txt', "say _hi_ _HOME _id_.txt"],
		["what?<>|*:.log", "what______.log"],
		["line\nbreak\t.txt", "line_break_.txt"],
		["..hidden", "hidden"],
		["  spaced  ", "spaced"],
		["trailing...", "trailing"],
		["CON.txt", "_CON.txt"],
		["nul", "_nul"],
		["", "attachment"],
		["...", "attachment"],
		["\u1112\u1161\u11AB.txt", "한.txt"],
	])("%j → %j", (input, expected) => {
		expect(safeAttachmentName(input)).toBe(expected);
	});

	test("caps the name at 200 UTF-8 bytes, keeping the extension and whole characters", () => {
		const long = `${"가".repeat(100)}.mov`;
		const safe = safeAttachmentName(long);
		expect(Buffer.byteLength(safe)).toBeLessThanOrEqual(200);
		expect(safe.endsWith(".mov")).toBe(true);
		expect(safe).toBe(`${"가".repeat(65)}.mov`);
		expect(Buffer.byteLength(safeAttachmentName("x".repeat(400)))).toBe(200);
	});
});

describe("pruneAttachments", () => {
	const old = (path: string, now: Date) => {
		const t = new Date(now.getTime() - RETENTION_MS - 60_000);
		utimesSync(path, t, t);
	};

	test("removes only stale folders of its own name pattern", async () => {
		const { root, src } = fixture();
		const now = new Date();
		const stale = join(root, "20260101-000000-0123abcd");
		const fresh = join(root, "20260101-000000-89abcdef");
		const foreign = join(root, "keep-me");
		const fileNamedLikeDir = join(root, "20260101-000000-feedface");
		const outside = join(src, "outside");
		const link = join(root, "20260101-000000-deadbeef");
		for (const dir of [stale, fresh, foreign, outside]) mkdirSync(dir, { recursive: true });
		writeFileSync(join(stale, "a.mov"), "x");
		writeFileSync(join(outside, "precious.txt"), "keep");
		writeFileSync(fileNamedLikeDir, "x");
		symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
		for (const path of [stale, foreign, fileNamedLikeDir, outside]) old(path, now);
		const t = new Date(now.getTime() - RETENTION_MS - 60_000);
		lutimesSync(link, t, t);
		expect(await pruneAttachments(root, now)).toBe(1);
		expect(existsSync(stale)).toBe(false);
		expect(existsSync(fresh)).toBe(true);
		expect(existsSync(foreign)).toBe(true);
		expect(existsSync(fileNamedLikeDir)).toBe(true);
		expect(existsSync(link)).toBe(true);
		expect(readFileSync(join(outside, "precious.txt"), "utf8")).toBe("keep");
	});

	test("a missing root prunes nothing", async () => {
		expect(await pruneAttachments(join(base, "no-such-root"))).toBe(0);
	});

	test("the first staging of a run prunes the root", async () => {
		const { root, src } = fixture();
		const now = new Date();
		const stale = join(root, "20260101-000000-00000000");
		mkdirSync(stale, { recursive: true });
		old(stale, now);
		const source = join(src, "a.txt");
		writeFileSync(source, "a");
		const staged = await stageAttachmentPath(source, root, now);
		expect("error" in staged).toBe(false);
		expect(existsSync(stale)).toBe(false);
		expect(stageDirs(root)).toHaveLength(1);
	});
});
