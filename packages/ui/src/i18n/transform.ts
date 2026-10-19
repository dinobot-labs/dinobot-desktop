/**
 * Build-time i18n transform (also the extractor the dictionary test uses). Parses a TS/TSX module and wraps every
 * piece of Korean UI text so it is looked up at render time:
 *
 *   "설정"                      -> __t("설정")
 *   `${n}개 실행 중`             -> __tf("{0}개 실행 중", [n])
 *   <p>시도 {used}/{limit}</p>  -> <p>{__tj("시도 {0}/{1}", [used, limit])}</p>
 *   title="닫기"                -> title={__t("닫기")}
 *
 * The key is the Korean source itself (JSX whitespace cleaned the way React renders it), so components stay
 * written in Korean and the dictionaries in this folder supply the other languages. Module specifiers, object keys,
 * type positions and tagged templates are left alone.
 */
import { parseAst } from "vite";

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Edit = { start: number; end: number; text: string };

export interface TransformResult {
	code: string;
	keys: string[];
	changed: boolean;
}

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as Node).type === "string" && typeof (v as Node).start === "number";

/** React's JSX text whitespace rule (Babel cleanJSXElementLiteralChild). */
export function cleanJsxText(raw: string): string {
	const lines = raw.split(/\r\n|\n|\r/);
	let lastNonEmpty = 0;
	lines.forEach((line, i) => {
		if (/[^ \t]/.test(line)) lastNonEmpty = i;
	});
	let out = "";
	lines.forEach((line, i) => {
		let s = line.replace(/\t/g, " ");
		if (i !== 0) s = s.replace(/^[ ]+/, "");
		if (i !== lines.length - 1) s = s.replace(/[ ]+$/, "");
		if (s) {
			if (i !== lastNonEmpty) s += " ";
			out += s;
		}
	});
	return decodeEntities(out);
}

const ENTITIES: Record<string, string> = { nbsp: "\u00a0", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", middot: "·", hellip: "…", rarr: "→", larr: "←" };
function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

const SKIP_PARENTS = new Set(["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression", "TSLiteralType", "TSEnumMember", "TSImportType", "TSExternalModuleReference", "TSModuleDeclaration"]);

export function transformKorean(code: string, filename = "module.tsx", runtime = "@dinobot/ui/i18n"): TransformResult {
	if (!HANGUL.test(code)) return { code, keys: [], changed: false };
	const lang = filename.endsWith(".tsx") || filename.endsWith(".jsx") ? "tsx" : "ts";
	const ast = parseAst(code, { lang } as never) as unknown as Node;
	const keys: string[] = [];
	const used = { t: false, tf: false, tj: false };

	/** Source of [start, end) with the edits inside it applied (edits are disjoint and sorted). */
	const apply = (start: number, end: number, edits: Edit[]) => {
		let out = "";
		let at = start;
		for (const e of edits) {
			if (e.start < start || e.end > end) continue;
			out += code.slice(at, e.start) + e.text;
			at = e.end;
		}
		return out + code.slice(at, end);
	};

	const children = (node: Node): Node[] => {
		const out: Node[] = [];
		for (const [k, v] of Object.entries(node)) {
			if (k === "parent") continue;
			if (Array.isArray(v)) for (const x of v) isNode(x) && out.push(x);
			else if (isNode(v)) out.push(v);
		}
		return out.sort((a, b) => a.start - b.start);
	};

	/** Walks a node; returns the edits inside it (sorted, disjoint). */
	function walk(node: Node, parent: Node | null, key: string): Edit[] {
		// --- string literal
		if (node.type === "Literal" && typeof node.value === "string") {
			if (!HANGUL.test(node.value)) return [];
			if (parent && SKIP_PARENTS.has(parent.type)) return [];
			if (parent && (parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition" || parent.type === "TSPropertySignature") && key === "key" && !parent.computed) return [];
			if (parent?.type === "ExpressionStatement" && typeof parent.directive === "string") return [];
			keys.push(node.value);
			used.t = true;
			const call = `__t(${JSON.stringify(node.value)})`;
			return [{ start: node.start, end: node.end, text: parent?.type === "JSXAttribute" ? `{${call}}` : call }];
		}
		// --- template literal
		if (node.type === "TemplateLiteral" && parent?.type !== "TaggedTemplateExpression" && parent?.type !== "TSLiteralType") {
			const quasis = node.quasis as Node[];
			const exprs = node.expressions as Node[];
			const inner: Edit[] = exprs.flatMap((e) => walk(e, node, "expressions"));
			const cooked = quasis.map((q) => ((q.value as { cooked: string | null; raw: string }).cooked ?? (q.value as { raw: string }).raw));
			if (!cooked.some((c) => HANGUL.test(c))) return inner;
			const message = cooked.map((c, i) => (i < exprs.length ? `${c}{${i}}` : c)).join("");
			keys.push(message);
			used.tf = true;
			const args = exprs.map((e) => apply(e.start, e.end, inner)).join(", ");
			return [{ start: node.start, end: node.end, text: `__tf(${JSON.stringify(message)}, [${args}])` }];
		}
		// --- JSX children: runs of text and expressions become one message
		if (node.type === "JSXElement" || node.type === "JSXFragment") {
			const edits: Edit[] = [];
			const opening = (node.openingElement ?? node.openingFragment) as Node | undefined;
			if (opening) edits.push(...walk(opening, node, "openingElement"));
			const kids = (node.children as Node[]) ?? [];
			let run: Node[] = [];
			const flush = () => {
				if (!run.length) return;
				const texts = run.filter((c) => c.type === "JSXText");
				const exprNodes = run.filter((c) => c.type === "JSXExpressionContainer" && (c.expression as Node).type !== "JSXEmptyExpression");
				const runEdits = exprNodes.flatMap((c) => walk(c.expression as Node, c, "expression"));
				if (!texts.some((t) => HANGUL.test(String(t.value)))) {
					edits.push(...runEdits);
					run = [];
					return;
				}
				let message = "";
				const args: string[] = [];
				for (const c of run) {
					if (c.type === "JSXText") message += cleanJsxText(String(c.value));
					else if ((c.expression as Node).type !== "JSXEmptyExpression") {
						const e = c.expression as Node;
						message += `{${args.length}}`;
						args.push(apply(e.start, e.end, runEdits));
					}
				}
				// keep the whitespace around the run that JSX would drop anyway; replace only the meaningful span
				keys.push(message);
				used.tj = true;
				const first = run[0] as Node;
				const last = run[run.length - 1] as Node;
				edits.push({ start: first.start, end: last.end, text: `{__tj(${JSON.stringify(message)}, [${args.join(", ")}])}` });
				run = [];
			};
			for (const c of kids) {
				if (c.type === "JSXText" || c.type === "JSXExpressionContainer") run.push(c);
				else {
					flush();
					edits.push(...walk(c, node, "children"));
				}
			}
			flush();
			const closing = node.closingElement as Node | undefined;
			if (closing) edits.push(...walk(closing, node, "closingElement"));
			return edits.sort((a, b) => a.start - b.start);
		}
		const out: Edit[] = [];
		for (const [k, v] of Object.entries(node)) {
			if (Array.isArray(v)) for (const x of v) isNode(x) && out.push(...walk(x, node, k));
			else if (isNode(v)) out.push(...walk(v, node, k));
		}
		return out.sort((a, b) => a.start - b.start);
	}
	void children;

	const edits = walk(ast, null, "");
	if (!edits.length) return { code, keys, changed: false };
	const names = [used.t && "__t", used.tf && "__tf", used.tj && "__tj"].filter(Boolean).join(", ");
	const out = `import { ${names} } from ${JSON.stringify(runtime)};\n${apply(0, code.length, edits)}`;
	return { code: out, keys, changed: true };
}
