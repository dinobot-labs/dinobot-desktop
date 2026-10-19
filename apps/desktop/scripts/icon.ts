// Renders build/icon.png (1024x1024) from the brand: the dot mark on paper with the five-stripe band, the same
// composition as the landing apple-touch-icon, on a rounded tile. Usage: bun scripts/icon.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { markSprite, spriteToSvg } from "../../../packages/ui/src/brand/mascot.ts";
import { PAPER, STOPS } from "../../../packages/ui/src/brand/palette.ts";

const S = 1024;
const mark = spriteToSvg(markSprite(), { fill: 0.8 });
const stripes = Object.values(STOPS).map((c) => `<i style="background:${c}"></i>`).join("");
const html = `<!doctype html><meta charset="utf-8"><style>*{margin:0}html,body{width:${S}px;height:${S}px;background:transparent}
.tile{position:absolute;inset:0;border-radius:${S * 0.225}px;overflow:hidden;background:${PAPER}}
.m{position:absolute;left:${S * 0.156}px;top:${S * 0.16}px;width:${S * 0.69}px}.m svg{display:block;width:100%}
.stripes{position:absolute;left:0;right:0;bottom:0;height:${S * 0.1}px;display:flex;gap:${S * 0.012}px;background:${PAPER}}.stripes i{flex:1}
</style><body><div class="tile"><div class="m">${mark}</div><div class="stripes">${stripes}</div></div></body>`;
const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: S, height: S }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: join(import.meta.dir, "..", "build", "icon.png"), omitBackground: true });
await browser.close();
console.log("build/icon.png");
