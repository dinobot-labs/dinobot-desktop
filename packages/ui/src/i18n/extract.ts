/** Every Korean UI message the transform wraps across the app and design-system sources (Node/Bun only). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformKorean } from "./transform.ts";
import { i18nTarget } from "./vite.ts";

export const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");

export function sourceFiles(): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) {
				if (name !== "node_modules" && name !== "dist") walk(p);
			} else if (i18nTarget(p)) out.push(p);
		}
	};
	for (const d of ["apps/web/src", "packages/ui/src"]) walk(join(REPO_ROOT, d));
	return out.sort();
}

/** message -> files it appears in */
export function extractAll(): Map<string, string[]> {
	const keys = new Map<string, string[]>();
	for (const file of sourceFiles()) {
		const { keys: found } = transformKorean(readFileSync(file, "utf8"), file);
		const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
		for (const k of found) keys.set(k, [...new Set([...(keys.get(k) ?? []), rel])]);
	}
	return keys;
}
