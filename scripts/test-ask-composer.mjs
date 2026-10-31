// Real Chromium + ChatView/Composer; mocked API boundary, no daemon/model or user profile.
import { checkSuggestions } from "./composer-suggestions.e2e.mjs";
import { checkChatHeight } from "./chat-height.e2e.mjs";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../apps/web", import.meta.url));
const server = await createServer({ root, server: { port: 0, strictPort: false, host: "127.0.0.1" }, plugins: [{ name: "ask-fixture", configureServer(server) {
 server.middlewares.use("/__ask_test", async (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(await server.transformIndexHtml("/__ask_test", '<html lang="ko"><script>window.__dnLanguage="ko"</script><div id="root"></div><script type="module" src="/test/ask-composer.fixture.tsx"></script></html>'));
 });
} }] });
let browser;
try {
 await server.listen();
 browser = await chromium.launch({ channel: "chrome", headless: true });
 const page = await browser.newPage();
 const errors = [];
 page.on("pageerror", e => { errors.push(String(e)); console.error(e); });
 await page.route("**/daemon/**", route => route.fulfill({ status: 503, json: { error: "isolated fixture" } }));
 await page.goto(server.resolvedUrls.local[0] + "__ask_test");
 await page.waitForFunction(() => window.fixture);
 if (!process.argv.includes("--layout-only") && !process.argv.includes("--suggestions-only")) {
 const area = page.locator("textarea").first();
 const setup = async (ids, fail = false, expired = false) => {
  await page.evaluate(args => window.fixture.setup(...args), [ids, fail, expired]);
  await page.waitForFunction(n => document.querySelectorAll("[data-testid=ask-bar] form").length === n, expired ? 0 : ids.length);
 };
 const sent = () => page.evaluate(() => window.fixture.calls);
 const enter = async text => { await area.fill(text); await area.press("Enter"); await page.waitForFunction(() => window.fixture.calls.length || window.fixture.notices.length); };
 await setup(["ask-one"]);
 await area.fill("");
 await area.press("Enter");
 assert.equal((await sent()).length, 0, "empty Enter must not send");
 assert.equal(await page.locator("[data-testid=ask-bar] form").count(), 1);
 console.log("PASS empty Enter does not send or close the question");
 await enter("직접 답변입니다");
 assert.equal((await sent())[0].text, "[ask ask-one] answer: 직접 답변입니다");
 assert.equal(await page.locator("[data-testid=ask-bar]").count(), 1, "no optimistic hide before server resolves");
 await page.evaluate(() => window.fixture.resolve());
 await page.waitForFunction(() => !document.querySelector("[data-testid=ask-bar]"));
 console.log("PASS Enter sends identified answer; real transcript reducer removes card on acknowledged user message");
 await setup(["ask-one"], true);
 await enter("retry me");
 assert.equal(await area.inputValue(), "retry me");
 assert.equal(await page.locator("[data-testid=ask-bar]").count(), 1);
 assert.match((await page.evaluate(() => window.fixture.notices))[0], /fixture send failed/);
 console.log("PASS failure retains draft and question");
 await setup(["ask-one", "ask-two"]);
 await enter("ambiguous answer");
 assert.equal((await sent()).length, 0);
 assert.equal(await area.inputValue(), "ambiguous answer");
 console.log("PASS multiple asks require explicit target without losing draft");
 await setup(["ask-one", "ask-two"]);
 await area.fill("");
 await page.locator("[data-testid=ask-bar] button").first().click();
 await page.waitForFunction(() => window.fixture.calls.length);
 assert.deepEqual((await sent())[0].choice, { askId: "ask-one", option: 0 });
 assert.equal(await page.locator("[data-testid=ask-bar] form").count(), 2, "choice waits for acknowledgement");
 await page.evaluate(() => window.fixture.resolve());
 await page.waitForFunction(() => document.querySelectorAll("[data-testid=ask-bar] form").length === 1);
 assert.match(await page.locator("[data-testid=ask-bar]").innerText(), /Question ask-two/);
 assert.doesNotMatch(await page.locator("[data-testid=ask-bar]").innerText(), /Question ask-one/);
 console.log("PASS acknowledged choice closes only the matching question");
 await setup(["ask-one"]);
 await page.getByPlaceholder("직접 답하기").fill("custom response");
 await page.getByPlaceholder("직접 답하기").press("Enter");
 await page.waitForFunction(() => window.fixture.calls.length);
 assert.equal((await sent())[0].text, "[ask ask-one] answer: custom response");
 await page.evaluate(() => window.fixture.resolve());
 await page.waitForFunction(() => !document.querySelector("[data-testid=ask-bar]"));
 console.log("PASS choice and custom paths preserved");
 await setup(["ask-one", "ask-two"]);
 await enter("[ask ask-two] answer: targeted response");
 assert.equal((await sent())[0].text, "[ask ask-two] answer: targeted response");
 await page.evaluate(() => window.fixture.resolve());
 await page.waitForFunction(() => document.querySelectorAll("[data-testid=ask-bar] form").length === 1);
 assert.match(await page.locator("[data-testid=ask-bar]").innerText(), /Question ask-one/);
 console.log("PASS explicit target is not double wrapped; only matching question closes");
 for (const expired of [false, true]) {
  await setup(expired ? ["expired"] : [], false, expired);
  await enter("normal message");
  assert.equal((await sent())[0].text, "normal message");
 }
 console.log("PASS no live question leaves normal messages unchanged");
 }
 if (!process.argv.includes("--suggestions-only")) await checkChatHeight(page, server.resolvedUrls.local[0]);
 await checkSuggestions(page, server.resolvedUrls.local[0]);
 assert.deepEqual(errors, []);
} finally { await browser?.close(); await server.close(); }
