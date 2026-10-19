/**
 * Lists Korean UI messages without an English entry.
 *   bun packages/ui/scripts/i18n-extract.ts                # count + missing keys
 *   bun packages/ui/scripts/i18n-extract.ts --json out.json # every message with its files
 */
import { writeFileSync } from "node:fs";
import { EN } from "../src/i18n/en.ts";
import { extractAll } from "../src/i18n/extract.ts";
import { IGNORE } from "../src/i18n/ignore.ts";

const keys = extractAll();
const missing = [...keys].filter(([k]) => !(k in EN) && !IGNORE.has(k));
const i = process.argv.indexOf("--json");
if (i > 0) writeFileSync(process.argv[i + 1] as string, JSON.stringify([...keys].map(([key, files]) => ({ key, files })), null, 1));
for (const [k, files] of missing) console.log(`${JSON.stringify(k)}  (${files.join(", ")})`);
console.log(`${keys.size} messages, ${missing.length} without English`);
