/** Vite plugin: applies the i18n transform (transform.ts) to the app and design-system sources. */
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { transformKorean } from "./transform.ts";

const RUNTIME = fileURLToPath(new URL("./index.ts", import.meta.url)).replace(/\\/g, "/");

/** Files the transform applies to: TS/TSX under a src/ folder, never tests, node_modules or the i18n folder itself. */
export function i18nTarget(id: string): boolean {
	const file = id.split("?")[0]?.replace(/\\/g, "/") ?? "";
	return /\.(ts|tsx)$/.test(file) && file.includes("/src/") && !file.includes("/node_modules/") && !file.includes("/src/i18n/") && !/\.test\.tsx?$/.test(file);
}

export function dinobotI18n(): Plugin {
	return {
		name: "dinobot-i18n",
		enforce: "pre",
		transform(code, id) {
			if (!i18nTarget(id)) return undefined;
			const out = transformKorean(code, id.split("?")[0], RUNTIME);
			return out.changed ? { code: out.code, map: null } : undefined;
		},
	};
}
