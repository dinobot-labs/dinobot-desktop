import { cn } from "@dinobot/ui";
import { Marked, type Tokens } from "marked";
import { memo, type MouseEvent, useMemo, useSyncExternalStore } from "react";
import { desktop } from "../lib/bridge.ts";

/**
 * Assistant prose. marked turns markdown into HTML in well under a millisecond for a typical answer (the unified
 * pipeline took several ms per block and dropped frames when a thread opened), and parsed HTML is cached per text.
 *
 * Safety: the text is model output, so it is untrusted. Raw HTML in the markdown is escaped (never rendered), link
 * targets are limited to http(s)/mailto, images only to inline data: URLs. Links open in the system browser.
 */
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeHref = (href: string) => (/^(https?:|mailto:)/i.test(href) ? href : null);

type Hljs = typeof import("highlight.js/lib/core").default;
let hljs: Hljs | null = null;
/** Highlighting loads after startup (idle) so the first frame never waits for it; blocks rendered before stay plain. */
function loadHighlighter() {
	void import("./highlight.ts").then((m) => {
		hljs = m.default;
		cache.clear();
	});
}
if (typeof window !== "undefined") {
	const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
	if (idle) idle(loadHighlighter);
	else setTimeout(loadHighlighter, 1500);
}
const ALIAS: Record<string, string> = { sh: "bash", shell: "bash", zsh: "bash", console: "bash", js: "javascript", jsx: "javascript", mjs: "javascript", ts: "typescript", tsx: "typescript", py: "python", yml: "yaml", html: "xml", rs: "rust", ps1: "powershell", kt: "kotlin" };

/** Keyword highlighting for fenced code with a known language (TUI code panels); unknown languages stay plain. */
function highlight(code: string, lang: string | undefined): string {
	const name = lang ? (ALIAS[lang.toLowerCase()] ?? lang.toLowerCase()) : undefined;
	if (hljs && name && hljs.getLanguage(name) && code.length < 60_000) {
		try {
			return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
		} catch {}
	}
	return escape(code);
}

type Katex = typeof import("katex").default;
let katex: Katex | null = null;
let katexLoading = false;
let mathVersion = 0;
const mathListeners = new Set<() => void>();
/** Installs the math renderer and re-renders every mounted answer whose math was shown as plain TeX until now. */
export function setMathRenderer(k: Katex) {
	katex = k;
	cache.clear();
	mathVersion++;
	for (const listener of mathListeners) listener();
}
/** KaTeX (and its fonts) loads on the first answer that contains math; until then the TeX shows as plain text. */
function loadKatex() {
	if (katex || katexLoading || typeof window === "undefined") return;
	katexLoading = true;
	void import("./math.ts").then((m) => setMathRenderer(m.default), () => {});
}
const subscribeMath = (listener: () => void) => {
	mathListeners.add(listener);
	return () => mathListeners.delete(listener);
};
const getMathVersion = () => mathVersion;

/** Display math is a block-styled span so it stays valid HTML inside a paragraph or list item. */
function renderMath(tex: string, display: boolean): string {
	if (!katex) {
		loadKatex();
		return `<span class="md-math-pending${display ? " md-math-block" : ""}">${escape(tex)}</span>`;
	}
	// trust stays off: \href, \url, \includegraphics and raw HTML commands are refused for model output.
	const html = katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, strict: "ignore", output: "htmlAndMathml" });
	return display ? `<span class="md-math-block">${html}</span>` : html;
}

/**
 * Math: $$…$$ and \[…\] are display math, \(…\) and $…$ inline. A single $ only opens math when a non-space
 * follows it, and only closes when a non-space precedes it and no digit follows, so "$5 and $10" stays text.
 */
const BLOCK_MATH = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/;
const INLINE_MATH: [RegExp, boolean][] = [
	[/^\$\$([\s\S]+?)\$\$/, true],
	[/^\\\[([\s\S]+?)\\\]/, true],
	[/^\\\(([\s\S]+?)\\\)/, false],
	[/^\$((?:\\[\s\S]|[^\\$\n])+?)\$(?!\d)/, false],
];
type MathToken = { type: "math"; raw: string; text: string; display: boolean };

const md = new Marked({
	gfm: true,
	breaks: true,
	async: false,
	extensions: [
		{
			name: "mathBlock",
			level: "block",
			start(src: string) {
				return src.match(/^ {0,3}(?:\$\$|\\\[)/m)?.index;
			},
			tokenizer(src: string) {
				const m = BLOCK_MATH.exec(src);
				if (!m) return undefined;
				return { type: "mathBlock", raw: m[0], text: m[1] ?? m[2] ?? "", display: true };
			},
			renderer(token) {
				return renderMath((token as unknown as MathToken).text, true);
			},
		},
		{
			name: "math",
			level: "inline",
			// \$ is reported at its backslash so marked's own escape rule keeps it a literal dollar.
			start(src: string) {
				const i = src.search(/\\[[($]|\$/);
				return i < 0 ? undefined : i;
			},
			tokenizer(src: string) {
				for (const [re, display] of INLINE_MATH) {
					const m = re.exec(src);
					if (!m) continue;
					const text = m[1] ?? "";
					if (!display && src[0] === "$" && /^\s|\s$/.test(text)) return undefined;
					return { type: "math", raw: m[0], text, display };
				}
				return undefined;
			},
			renderer(token) {
				const t = token as unknown as MathToken;
				return renderMath(t.text, t.display);
			},
		},
	],
	renderer: {
		html({ text }: Tokens.HTML | Tokens.Tag) {
			return escape(text);
		},
		link({ href, title, tokens }: Tokens.Link) {
			const inner = this.parser.parseInline(tokens);
			const safe = safeHref(href);
			if (!safe) return inner;
			return `<a href="${escape(safe)}"${title ? ` title="${escape(title)}"` : ""} data-external>${inner}</a>`;
		},
		image({ href, text }: Tokens.Image) {
			if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(href)) return `<img src="${escape(href)}" alt="${escape(text)}" />`;
			return `<span class="md-image">[${escape(text || "image")}]</span>`;
		},
		code({ text, lang }: Tokens.Code) {
			return `<div class="md-code"><button type="button" class="md-copy" aria-label="복사">복사</button><pre><code${lang ? ` data-lang="${escape(lang)}"` : ""}>${highlight(text, lang)}</code></pre></div>`;
		},
		table(token: Tokens.Table) {
			const cell = (c: Tokens.TableCell, tag: "th" | "td") => `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`;
			const head = `<tr>${token.header.map((c) => cell(c, "th")).join("")}</tr>`;
			const rows = token.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("");
			return `<div class="md-table"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
		},
	},
});

const cache = new Map<string, string>();
const CACHE_MAX = 400;

export function renderMarkdown(text: string): string {
	const hit = cache.get(text);
	if (hit !== undefined) return hit;
	const html = md.parse(text) as string;
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
	cache.set(text, html);
	return html;
}

function onClick(e: MouseEvent<HTMLDivElement>) {
	const target = e.target as HTMLElement;
	const link = target.closest("a[data-external]") as HTMLAnchorElement | null;
	if (link) {
		e.preventDefault();
		const href = link.getAttribute("href") ?? "";
		if (desktop) void desktop.openExternal(href);
		else window.open(href, "_blank", "noopener");
		return;
	}
	const copy = target.closest(".md-copy") as HTMLButtonElement | null;
	if (copy) {
		const code = copy.parentElement?.querySelector("code")?.textContent ?? "";
		void navigator.clipboard.writeText(code).then(() => {
			copy.textContent = "복사됨";
			setTimeout(() => {
				copy.textContent = "복사";
			}, 1200);
		});
	}
}

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
	const math = useSyncExternalStore(subscribeMath, getMathVersion, getMathVersion);
	// `math` changes once KaTeX has loaded, so answers that showed plain TeX render again.
	const html = useMemo(() => renderMarkdown(text), [text, math]);
	return <div className={cn("md selectable", className)} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});
