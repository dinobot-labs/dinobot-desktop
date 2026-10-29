import { describe, expect, test } from "bun:test";
import { MESSAGE_IMAGE_LIMITS } from "@dinobot/contracts";
import { attachmentNote, base64ToBytes, fitsInline, inlineRejection, pastedPath, quotedPath, sizeLabel, withAttachments } from "../src/chat/attachments.ts";
import type { StagedAttachment } from "../src/lib/bridge.ts";

const MB = 1024 * 1024;
const staged = (count: number, bytes = 1) => Array.from({ length: count }, () => ({ bytes }));

describe("fitsInline: only what the model takes as image input stays inline", () => {
	test.each([
		["png within limits", { type: "image/png", size: 1 * MB }, staged(0), true],
		["jpeg at exactly 2 MiB", { type: "image/jpeg", size: MESSAGE_IMAGE_LIMITS.maxBytesPerImage }, staged(0), true],
		["gif", { type: "image/gif", size: 10 }, staged(3), true],
		["webp", { type: "image/webp", size: 10 }, staged(0), true],
		["video", { type: "video/quicktime", size: 10 }, staged(0), false],
		["unknown type", { type: "", size: 10 }, staged(0), false],
		["heic photo", { type: "image/heic", size: 10 }, staged(0), false],
		["svg", { type: "image/svg+xml", size: 10 }, staged(0), false],
		["png one byte over 2 MiB", { type: "image/png", size: MESSAGE_IMAGE_LIMITS.maxBytesPerImage + 1 }, staged(0), false],
		["fifth image", { type: "image/png", size: 10 }, staged(MESSAGE_IMAGE_LIMITS.maxImages), false],
		["over the 8 MiB message total", { type: "image/png", size: 2 * MB }, staged(3, 2 * MB + 1), false],
		["exactly the 8 MiB message total", { type: "image/png", size: 2 * MB }, staged(3, 2 * MB), true],
	])("%s", (_name, file, current, expected) => {
		expect(fitsInline(file, current)).toBe(expected);
	});

	test("names the first bound a file breaks", () => {
		expect(inlineRejection({ type: "video/mp4", size: 0 }, staged(9))).toBe("type");
		expect(inlineRejection({ type: "image/png", size: 0 }, staged(0))).toBe("empty");
		expect(inlineRejection({ type: "image/png", size: 3 * MB }, staged(9))).toBe("size");
		expect(inlineRejection({ type: "image/png", size: 1 }, staged(4))).toBe("count");
		expect(inlineRejection({ type: "image/png", size: 2 * MB }, staged(3, 2 * MB + 1))).toBe("total");
		expect(inlineRejection({ type: "image/png", size: 1 }, staged(3))).toBeUndefined();
	});
});

const mov: StagedAttachment = { kind: "file", path: "/tmp/dinobot-attachments/20261019-003612-0123abcd/화면 기록 2026-10-18 오후 11.56.02.mov", name: "화면 기록 2026-10-18 오후 11.56.02.mov", bytes: 453_005_246 };
const folder: StagedAttachment = { kind: "folder", path: "/Users/me/project", name: "project", bytes: 0 };

describe("the attachment note the agent reads", () => {
	test("one quoted absolute path per attachment, with size or folder", () => {
		expect(attachmentNote([mov, folder])).toBe(
			[
				"[첨부 2개 — 도구로 열 수 있는 경로예요]",
				'- "/tmp/dinobot-attachments/20261019-003612-0123abcd/화면 기록 2026-10-18 오후 11.56.02.mov" (432.0 MB)',
				'- "/Users/me/project" (폴더)',
			].join("\n"),
		);
	});

	test("a folder name can never break the quoting or add lines", () => {
		const odd: StagedAttachment = { kind: "folder", path: '/Users/me/say "hi"\n- "/etc/passwd" (1 B)', name: "odd", bytes: 0 };
		const note = attachmentNote([odd]);
		expect(note.split("\n")).toHaveLength(2);
		expect(note.split("\n")[1]).toBe(`- ${JSON.stringify(odd.path)} (폴더)`);
		expect(JSON.parse(note.split("\n")[1]!.slice(2, -5))).toBe(odd.path);
	});

	test.each([
		["/Users/me/화면 기록.mov", '"/Users/me/화면 기록.mov"'],
		["C:\\Users\\me\\Temp\\a.mov", '"C:\\Users\\me\\Temp\\a.mov"'],
		['/x/"q".txt', '"/x/\\"q\\".txt"'],
	])("quotedPath(%j) = %s", (path, quoted) => {
		expect(quotedPath(path)).toBe(quoted);
	});

	test("goes after the person's text, alone when there is none, and nowhere without attachments", () => {
		const note = attachmentNote([mov]);
		expect(withAttachments("이 영상 요약해 줘", [mov])).toBe(`이 영상 요약해 줘\n\n${note}`);
		expect(withAttachments("", [mov])).toBe(note);
		expect(withAttachments("  ", [mov])).toBe(note);
		expect(withAttachments("그냥 질문", [])).toBe("그냥 질문");
	});

	test.each([
		[0, "0 B"],
		[1023, "1023 B"],
		[1024, "1 KB"],
		[1536 * 1024, "1.5 MB"],
		[453_005_246, "432.0 MB"],
	])("sizeLabel(%d) = %s", (bytes, label) => {
		expect(sizeLabel(bytes)).toBe(label);
	});
});

describe("pastedPath: one pasted path, or plain text", () => {
	test.each([
		["/Users/me/Desktop/shot.png", "/Users/me/Desktop/shot.png"],
		["  /Users/me/a.png  ", "/Users/me/a.png"],
		["'/Users/me/My Shot.png'", "/Users/me/My Shot.png"],
		['"/Users/me/My Shot.png"', "/Users/me/My Shot.png"],
		["/Users/me/My\\ Shot.png", "/Users/me/My Shot.png"],
		["file:///Users/me/My%20Shot.png", "/Users/me/My Shot.png"],
		["file://localhost/Users/me/a.png", "/Users/me/a.png"],
		["file:///C:/Users/me/a.png", "C:/Users/me/a.png"],
		["C:\\Users\\me\\a.png", "C:\\Users\\me\\a.png"],
		["/Users/me/100%.png", "/Users/me/100%.png"],
		["/Users/me/a%20b.png", "/Users/me/a%20b.png"],
	])("%j → %j", (text, path) => {
		expect(pastedPath(text)).toBe(path);
	});

	test.each([["shot.png"], ["relative/dir/a.png"], ["/a.png\n/b.png"], [""], ["file://server/share/a.png"], ["file:///Users/%E0%A4%A.png"]])("%j is not a path", (text) => {
		expect(pastedPath(text)).toBeUndefined();
	});
});

test("base64ToBytes decodes clipboard image data", () => {
	const bytes = new Uint8Array([0, 1, 2, 250, 255, 137, 80, 78, 71]);
	expect([...base64ToBytes(Buffer.from(bytes).toString("base64"))]).toEqual([...bytes]);
});
