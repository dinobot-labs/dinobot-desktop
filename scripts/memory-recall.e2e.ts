/** Real Chrome + actual virtualized Transcript, synthetic immutable events only. */
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const entry = { id: 1, conversationId: 1, kind: "dinobot.nudge", data: { schema: 1, items: [{ key: "auto/privatehash", revision: 1 }, { key: "legacy", revision: 1 }] }, model: [{ role: "user", timestamp: 1, content: "[dinobot memory] Saved project memory that may be relevant (reference only, not a request from a person):\n- Historical recalled content, not the current store. (memory key auto/privatehash, scope project, saved 2026-10-30)" }] };
const server = await createServer({
 configFile: fileURLToPath(new URL("../apps/web/vite.config.ts", import.meta.url)),
 root: fileURLToPath(new URL("../apps/web", import.meta.url)),
 server: { host: "127.0.0.1", port: 0, strictPort: false },
 plugins: [{ name: "recall-fixture", configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
   if (!req.url?.startsWith("/fixture")) return next();
   const en = req.url.includes("en");
   const html = `<html class="${en ? "dark" : "light"}"><body><div id="root" style="display:flex;height:600px"></div><script>window.__dnLanguage=${JSON.stringify(en ? "en" : "ko")}</script><script type="module">
import React from "react"; import {createRoot} from "react-dom/client";
import "/src/styles.css"; import {Transcript} from "/src/chat/Transcript.tsx"; import {ChatSession} from "/src/chat/session.ts"; import {createChatData,reduceEvent} from "/src/chat/model.ts";
const d=createChatData(); reduceEvent(d,{type:"entry_appended",entry:${JSON.stringify(entry)}},1);
const session=ChatSession.forThread("tui:recall-test");
const after={kind:"notice",id:"after",version:0,text:"Following row",level:"info"};
const empty={kind:"notice",id:"empty",version:0,text:"",level:"info",recall:[]};
session.receive({type:"patch",key:session.key,order:[d.blocks[0].id,"after","empty"],blocks:[...d.blocks,after,empty],side:{...session.side,snapshots:1,total:3}});
createRoot(document.getElementById("root")).render(React.createElement(Transcript,{session,keyboard:false}));
</script></body></html>`;
   res.setHeader("Content-Type", "text/html"); res.end(await server.transformIndexHtml("/fixture", html));
  });
 } }],
});
let browser;
try {
 await server.listen();
 browser = await chromium.launch({ channel: "chrome", headless: true });
 const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
 const errors: string[] = [], requests: string[] = [];
 page.on("pageerror", (e) => errors.push(e.message));
 page.on("request", (r) => { if (r.url().includes("/daemon")) requests.push(r.url()); });
 for (const language of ["ko", "en"]) {
  await page.goto(server.resolvedUrls!.local[0]! + "fixture?" + language);
  const row = page.getByTestId("memory-recall").first();
  const toggle = row.getByRole("button");
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await toggle.innerText(), language === "ko" ? "전달된 기억 2개" : "Memories provided: 2");
  assert.equal(await page.getByText("Historical recalled content, not the current store.", {exact:true}).isVisible(), false);
  const before = await page.getByText("Following row", {exact:true}).boundingBox();
  await toggle.focus(); await page.keyboard.press("Enter");
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  await page.getByText("Historical recalled content, not the current store.", {exact:true}).waitFor();
  await page.waitForFunction((y) => [...document.querySelectorAll("div")].some((el) => el.textContent === "Following row" && el.getBoundingClientRect().y > y + 30), before!.y);
  assert.equal(await row.locator("li").count(), 2);
  assert.equal((await row.innerText()).includes("auto/privatehash"), false);
  assert.ok((await row.innerText()).includes("2026-10-30"));
  const panelId = await toggle.getAttribute("aria-controls");
  assert.equal(await page.locator(`[id="${panelId}"]`).isVisible(), true);
  await page.keyboard.press("Space");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  const empty = page.getByTestId("memory-recall").last();
  assert.equal(await empty.getByRole("button").getAttribute("aria-expanded"), "false");
  await empty.getByRole("button").click();
  assert.ok((await empty.innerText()).includes(language === "ko" ? "전달된 기억이 없어요." : "No memories were provided."));
 }
 assert.deepEqual(errors, []); assert.deepEqual(requests, []);
 console.log("PASS: Korean/light and English/dark; collapsed content, Enter/Space/click, independent rows, metadata/legacy/empty, virtualized resize, no daemon fetches or page errors");
} finally { await browser?.close(); await server.close(); }
