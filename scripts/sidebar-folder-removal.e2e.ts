/** Isolated real-Chrome UI check: bun scripts/sidebar-folder-removal.e2e.ts */
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const folder = await mkdtemp(join(tmpdir(), "sidebar-preserve-"));
const sentinel = join(folder, "keep.txt");
await writeFile(sentinel, "keep the actual file");
const threads = [
 { key: "tui:preserved", channel: "tui", cwd: folder, draft: true },
 { key: "tui:other", channel: "tui", cwd: "C:/work/Other" },
 { key: "tui:general", channel: "tui" },
];
const server = await createServer({ configFile: false, root: fileURLToPath(new URL("../apps/web", import.meta.url)), server: { host: "127.0.0.1", port: 0 }, resolve: { dedupe: ["react", "react-dom"] }, plugins: [{ name: "sidebar-fixture", configureServer(server) {
server.middlewares.use(async (req, res, next) => {
 if (req.url !== "/fixture") return next();
 const html = '<html><body><div id="root"></div><script type="module">import React from "react"; import {createRoot} from "react-dom/client"; import {Sidebar} from "/src/shell/Sidebar.tsx"; import {useApp} from "/src/state/app.ts"; window.app = useApp; useApp.setState({threads: ' + JSON.stringify(threads) + ', titles: {"tui:preserved":"Preserved conversation"}, activeKey:"tui:preserved"}); createRoot(document.getElementById("root")).render(React.createElement(Sidebar));</script></body></html>';
 res.setHeader("Content-Type", "text/html");
 res.end(await server.transformIndexHtml("/fixture", html));
});
} }] });
let browser;
try {
 await server.listen();
 browser = await chromium.launch({ channel: "chrome", headless: true });
 const page = await browser.newPage();
 const requests: string[] = [];
 page.on("request", (req) => { if (req.url().includes("/daemon")) requests.push(req.method() + " " + req.url()); });
 page.on("pageerror", (error) => console.error(error));
 await page.goto(server.resolvedUrls!.local[0]! + "fixture");
 const project = page.locator("section[data-project]").filter({ hasText: "Preserved conversation" });
 await project.locator('[data-testid="project-toggle"]').click({ button: "right" });
 await page.getByText("사이드바에서 제거", { exact: true }).click();
 await project.waitFor({ state: "detached" });
 assert.equal(await page.locator('section[data-project="c:/work/other"]').count(), 1);
 assert.equal(await page.locator('section[data-project="general"]').count(), 1);
 assert.equal(await page.evaluate(() => (window as any).app.getState().threads.length), 3);
 assert.equal(await page.evaluate(() => (window as any).app.getState().activeKey), "tui:preserved");
 await page.reload();
 await page.locator('section[data-project="c:/work/other"]').waitFor();
 assert.equal(await project.count(), 0);
 await page.getByLabel("스레드 검색", { exact: true }).fill("Preserved");
 await project.locator('[data-testid="project-toggle"]').click({ button: "right" });
 await page.getByText("사이드바에 추가", { exact: true }).click();
 await page.getByLabel("스레드 검색", { exact: true }).fill("");
 await project.waitFor();
 await page.reload();
 await project.waitFor();
 assert.equal(await page.evaluate(() => (window as any).app.getState().threads.length), 3);
 assert.deepEqual(requests, []);
 assert.equal(await readFile(sentinel, "utf8"), "keep the actual file");
 console.log("PASS: real context menu removes persistently, preserves active thread/all threads/other folders/files, search and explicit add restore across reload; no daemon requests");
} finally {
 await browser?.close();
 await server.close();
 await rm(folder, { recursive: true, force: true });
}
