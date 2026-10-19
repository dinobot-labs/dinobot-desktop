import { describe, expect, test } from "bun:test";
import katex from "katex";
import { renderMarkdown, setMathRenderer } from "../src/chat/Markdown.tsx";

describe("markdown math", () => {
	test("before KaTeX loads, math shows as plain TeX instead of vanishing backslashes", () => {
		const html = renderMarkdown("pending \\(a+b\\) case");
		expect(html).toContain('<span class="md-math-pending">a+b</span>');
	});

	test("renders after KaTeX loads", () => {
		setMathRenderer(katex);

		// The exact answer from the bug report: \[ … \] on its own lines used to render as "[ … ]".
		const block = renderMarkdown("\\[\ns(q,m)=\\sum_{\\text{일치하는 단어 }t}\\log(1+N/df(t))\n\\]\n");
		expect(block).toContain('class="md-math-block"');
		expect(block).toContain("katex-display");
		expect(block).toContain("일치하는 단어");
		expect(block).not.toContain("<p>");
		expect(block).toContain("∑");

		const dollars = renderMarkdown("앞 문장\n\n$$\nE = mc^2\n$$\n\n뒤 문장");
		expect(dollars).toContain("katex-display");
		expect(dollars).toContain("<p>앞 문장</p>");
		expect(dollars).toContain("<p>뒤 문장</p>");

		const inline = renderMarkdown("점수는 $s = \\log N$ 이고 \\(x^2\\) 도 됩니다.");
		expect(inline.match(/class="katex"/g)?.length).toBe(2);
		expect(inline).not.toContain("katex-display");

		const midParagraph = renderMarkdown("식은 \\[ a^2+b^2=c^2 \\] 입니다");
		expect(midParagraph).toContain("katex-display");

		const inList = renderMarkdown("- 항목\n\n  $$x$$\n");
		expect(inList).toContain("katex-display");
	});

	test("dollar amounts, escaped dollars and code stay text", () => {
		setMathRenderer(katex);
		expect(renderMarkdown("가격은 $5 그리고 $10 입니다")).not.toContain("katex");
		expect(renderMarkdown("$5-$10 사이")).not.toContain("katex");
		expect(renderMarkdown("\\$x\\$ 는 그대로")).toBe("<p>$x$ 는 그대로</p>\n");
		expect(renderMarkdown("`$x$` 와 코드")).toContain("<code>$x$</code>");
		expect(renderMarkdown("```\n$$x$$\n```")).not.toContain("katex");
		expect(renderMarkdown("$$ 닫히지 않은 수식")).not.toContain("katex");
	});

	test("bad TeX renders an inline error instead of throwing, and link commands are refused", () => {
		setMathRenderer(katex);
		expect(() => renderMarkdown("$\\frac{1}{$ 끝")).not.toThrow();
		const link = renderMarkdown("$\\href{javascript:alert(1)}{x}$");
		expect(link).not.toContain("<a ");
		expect(link).not.toContain("href=");
	});
});
