/**
 * Korean strings the transform wraps that are not UI text and must stay the same in every language:
 * the paste placeholders the composer inserts and later expands with PASTE_RE (a regex literal, not translated),
 * a CSS font-family list, the font-detection probe text, and the language picker's own name for Korean (language
 * names are shown in their own language).
 */
export const IGNORE: ReadonlySet<string> = new Set([
	"[붙여넣기 #{0} +{1}줄]",
	"[붙여넣기 #{0} {1}자]",
	"\\[붙여넣기 #{0}[^\\]]*\\]",
	'"Nanum Gothic", "나눔고딕", {0}',
	"가나다라마바사 mmmmmmmmmmlli WwQq 0123456789",
	"한국어",
]);
