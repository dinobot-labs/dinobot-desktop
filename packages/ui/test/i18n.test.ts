// Every Korean UI text needs an English entry in src/i18n/en.ts (see docs/i18n.md; list them with bun packages/ui/scripts/i18n-extract.ts).
import { describe, expect, test } from "bun:test";
import { createElement, isValidElement } from "react";
import { EN } from "../src/i18n/en.ts";
import { extractAll } from "../src/i18n/extract.ts";
import { IGNORE } from "../src/i18n/ignore.ts";
import { __t, __tf, __tj, resolveLanguage, setLanguage } from "../src/i18n/index.ts";
import { cleanJsxText, transformKorean } from "../src/i18n/transform.ts";

const run = (code: string, file = "x.tsx") => transformKorean(code, file, "rt");

describe("transform", () => {
	test("string literals, templates and JSX attributes", () => {
		const out = run('const a = "설정"; const b = `${n}개 실행 중`; const c = <p title="닫기" />;');
		expect(out.keys).toEqual(["설정", "{0}개 실행 중", "닫기"]);
		expect(out.code).toContain('__t("설정")');
		expect(out.code).toContain('__tf("{0}개 실행 중", [n])');
		expect(out.code).toContain('title={__t("닫기")}');
		expect(out.code.startsWith('import { __t, __tf } from "rt";')).toBe(true);
	});
	test("a JSX text run with expressions becomes one message", () => {
		const out = run("const a = <span>\n\t시도 {r.used}/{r.limit}\n</span>;");
		expect(out.keys).toEqual(["시도 {0}/{1}"]);
		expect(out.code).toContain('{__tj("시도 {0}/{1}", [r.used, r.limit])}');
	});
	test("Korean nested in a run expression is translated inside the argument", () => {
		const out = run('const a = <b>상태: {ok ? "좋음" : `${n}개 실패`}</b>;');
		expect(out.keys).toEqual(["좋음", "{0}개 실패", "상태: {0}"]);
		expect(out.code).toContain('__tj("상태: {0}", [ok ? __t("좋음") : __tf("{0}개 실패", [n])])');
	});
	test("imports, object keys, types and tagged templates stay", () => {
		const out = run('import x from "./가.ts"; type T = "켜짐" | "꺼짐"; const o = { "이름": 1 }; const t = tag`가`;', "x.ts");
		expect(out.changed).toBe(false);
	});
	test("no Korean, no change", () => {
		expect(run("const a = <p>hello {x}</p>;").changed).toBe(false);
	});
	test("JSX whitespace follows React", () => {
		expect(cleanJsxText("\n\t\t보고서 \n\t")).toBe("보고서");
		expect(cleanJsxText(" 지금 보내기")).toBe(" 지금 보내기");
		expect(cleanJsxText("한 줄\n  둘째 줄")).toBe("한 줄 둘째 줄");
		expect(cleanJsxText("a&nbsp;b")).toBe("a\u00a0b");
	});
});

describe("runtime", () => {
	test("language from setting and OS", () => {
		expect(resolveLanguage("", "ko-KR")).toBe("ko");
		expect(resolveLanguage("", "en-US")).toBe("en");
		expect(resolveLanguage("en", "ko-KR")).toBe("en");
		expect(resolveLanguage("ko", "en-US")).toBe("ko");
	});
	test("lookup with placeholders, Korean fallback", () => {
		setLanguage("en");
		expect(__t("설정")).toBe(EN["설정"] ?? "설정");
		expect(__t("사전에 없는 문구")).toBe("사전에 없는 문구");
		expect(__tf("{0}초", [5])).toBe((EN["{0}초"] ?? "{0}초").replace("{0}", "5"));
		const node = __tj("시도 {0}/{1}", [createElement("b", null, "1"), 2]);
		expect(isValidElement(node)).toBe(true);
		expect(__tj("시도 {0}/{1}", [1, null])).toBe((EN["시도 {0}/{1}"] ?? "시도 {0}/{1}").replace("{0}", "1").replace("{1}", ""));
		setLanguage("ko");
		expect(__t("설정")).toBe("설정");
	});
});

describe("English dictionary", () => {
	const keys = extractAll();
	test("every UI message has English", () => {
		const missing = [...keys.keys()].filter((k) => !(k in EN) && !IGNORE.has(k));
		expect(missing).toEqual([]);
	});
	test("translations keep the placeholders and contain no Korean", () => {
		const bad: string[] = [];
		const holes = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(",");
		for (const [k, v] of Object.entries(EN)) {
			if (holes(k) !== holes(v)) bad.push(`placeholders: ${k} -> ${v}`);
			if (/[\uac00-\ud7af]/.test(v)) bad.push(`korean left: ${k} -> ${v}`);
		}
		expect(bad).toEqual([]);
	});
	test("no stale entries", () => {
		const stale = Object.keys(EN).filter((k) => !keys.has(k));
		expect(stale).toEqual([]);
	});
});
