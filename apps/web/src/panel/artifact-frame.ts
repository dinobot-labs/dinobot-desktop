/**
 * How an HTML artifact is framed: `srcdoc` in an iframe sandboxed without `allow-same-origin`, so the page gets an
 * opaque origin (no access to the app, its storage or the daemon proxy, which also refuses `Origin: null`). A CSP meta
 * tag inserted at the top of the document additionally forbids network reads (connect-src), forms and nested frames;
 * inline scripts, styles and https images/fonts/scripts still work, so self-contained pages look as they should.
 */
export const ARTIFACT_SANDBOX = "allow-scripts allow-popups allow-modals";

export const ARTIFACT_CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline' 'unsafe-eval' https: data: blob:",
	"style-src 'unsafe-inline' https: data:",
	"img-src https: data: blob:",
	"font-src https: data:",
	"media-src https: data: blob:",
	"connect-src 'none'",
	"frame-src 'none'",
	"form-action 'none'",
	"base-uri 'none'",
].join("; ");

const META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;

/** The document to put in `srcdoc`: the page with the CSP meta as the first thing in its head. */
export function artifactSrcdoc(html: string): string {
	for (const tag of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
		const m = tag.exec(html);
		if (m) {
			const at = m.index + m[0].length;
			return html.slice(0, at) + META + html.slice(at);
		}
	}
	return META + html;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The folder part of a path, for the row's second line. */
export function folderOf(path: string): string {
	const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return i > 0 ? path.slice(0, i) : "";
}
