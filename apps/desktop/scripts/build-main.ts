#!/usr/bin/env bun
/**
 * Bundles the Electron main and preload scripts.
 *
 *   dist/main.cjs        the V8 bytecode loader stub (copy of scripts/main-loader.cjs). The
 *                        packaged app runs dist/main.jsc through it; the dev tree (`electron .`)
 *                        runs the plain bundle. This file is what app.asar ships as main.
 *   dist/main-bundle.cjs the minified main bundle: what development runs and what the
 *                        electron-builder afterExtract hook compiles into per-arch
 *                        dist/main.jsc. Never packaged (not in build.files).
 *   dist/preload.cjs     the minified preload bridge; stays plain JavaScript because the
 *                        sandboxed renderer has no node:vm/node:fs to load bytecode.
 */
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const appDir = join(import.meta.dir, "..");
const dist = join(appDir, "dist");

function fail(message: string): never {
	console.error(`build:main: ${message}`);
	process.exit(1);
}

/** Bun prefixes bundles with a `// @bun` pragma; drop it so the outputs stay comment-free. */
function stripBunPragma(file: string): void {
	const text = readFileSync(file, "utf8");
	const stripped = text.replace(/^\/\/ @bun\r?\n/, "");
	if (stripped !== text) writeFileSync(file, stripped);
}

async function bundle(entry: string, outfile: string): Promise<void> {
	const result = await Bun.build({
		entrypoints: [join(appDir, "src", entry)],
		outdir: dist,
		naming: outfile,
		target: "node",
		format: "cjs",
		minify: true,
		sourcemap: "none",
		splitting: false,
		external: ["electron"],
		drop: ["debugger"],
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		fail(`${entry} bundle failed`);
	}
	const output = result.outputs[0];
	if (!output || output.kind !== "entry-point" || !output.path.endsWith(outfile)) fail(`${entry} produced ${output?.path ?? "no output"}, expected ${outfile}`);
	stripBunPragma(join(dist, outfile));
}

mkdirSync(dist, { recursive: true });
await bundle("main.ts", "main-bundle.cjs");
await bundle("preload.ts", "preload.cjs");
copyFileSync(join(appDir, "scripts", "main-loader.cjs"), join(dist, "main.cjs"));

const size = (file: string) => `${(statSync(join(dist, file)).size / 1024).toFixed(1)} kB`;
console.log(`build:main: main-bundle.cjs ${size("main-bundle.cjs")}, preload.cjs ${size("preload.cjs")}, main.cjs loader stub`);
