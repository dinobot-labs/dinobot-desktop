/** Real components + bundled fonts in isolated Chrome. Only the daemon boundary is mocked. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
const root = fileURLToPath(new URL("../apps/web", import.meta.url));
const artifacts = fileURLToPath(new URL("../test-results/composer-layout/", import.meta.url));
mkdirSync(artifacts, { recursive: true });
const server = await createServer({ root, server: { port: 0, strictPort: false, host: "127.0.0.1" }, plugins: [{ name: "composer-layout-fixture", configureServer(server) {
 server.middlewares.use(async (req, res, next) => {
  if (!req.url?.startsWith("/__composer_layout")) return next();
  res.setHeader("Content-Type", "text/html");
  res.end(await server.transformIndexHtml("/__composer_layout", '<html lang="ko"><script>window.__dnLanguage="ko"</script><div id="root"></div><script type="module" src="/test/browser/composer-layout.fixture.tsx"></script></html>'));
 });
} }] });
let browser;
const failures: string[] = [];
const results: unknown[] = [];
try {
 await server.listen();
 browser = await chromium.launch({ channel: "chrome", headless: true });
 const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, reducedMotion: "reduce" });
 page.setDefaultTimeout(10000);
 const errors: string[] = [];
 page.on("pageerror", error => errors.push(error.message));
 await page.route("**/daemon/**", route => route.fulfill({ status: 200, json: { commands: [] } }));
 for (const theme of ["light", "dos-blue", "dos-black"]) for (const width of [1200, 640, 420]) for (const busy of [false, true]) {
  const name = theme + "-" + width + "-" + (busy ? "busy" : "idle");
  await page.setViewportSize({ width, height: 700 });
  await page.goto(server.resolvedUrls!.local[0] + "__composer_layout?theme=" + theme + "&busy=" + busy, { timeout: 60000 });
  await page.getByTestId("composer-input").waitFor();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.evaluate(() => {
   const rect = (el: Element | Range) => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,cy:r.y+r.height/2 }; };
   const composers = [...document.querySelectorAll("[data-slot=composer]")].map(composer => {
    const textarea = composer.querySelector("textarea")!;
    const toolbar = textarea.nextElementSibling!;
    const controls = [...toolbar.querySelectorAll("button,label,[data-testid=context-usage]")].map(el => ({text:el.getAttribute("aria-label") || el.textContent, ...rect(el), scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
    const range = document.createRange();
    const textRects = [...toolbar.querySelectorAll("button,kbd")].flatMap(el => {
     const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
     const out: {text:string|null; parent:ReturnType<typeof rect>; glyph:ReturnType<typeof rect>}[]=[];
     while(walker.nextNode()) {if(!walker.currentNode.textContent?.trim())continue;range.selectNodeContents(walker.currentNode);out.push({text:walker.currentNode.textContent,parent:rect(el),glyph:rect(range)});}
     return out;
    });
    return {box:rect(composer),textarea:rect(textarea),toolbar:rect(toolbar),controls,textRects};
   });
   const hints = [...document.querySelectorAll("[data-slot=hint-bar] kbd")].map(el => ({key:rect(el),label:rect(el.parentElement!.lastElementChild!),fontSize:parseFloat(getComputedStyle(el).fontSize),text:el.textContent}));
   const keys = [...document.querySelectorAll("[data-slot=composer] kbd")].filter(el=>el.getBoundingClientRect().width).map(el=>({key:rect(el),parent:rect(el.parentElement!)}));
   return {composers,hints,keys,fontLoaded:document.fonts.check("16px NeoDunggeunmo", "한글 DOS"),bodyWidth:document.body.scrollWidth};
  });
  results.push({name,...geometry});
  await page.screenshot({path:artifacts+name+".png", caret:"hide"});
  const check=(condition:boolean,message:string)=>{if(!condition)failures.push(name+": "+message);};
  if(theme!=="light") {
   check(geometry.fontLoaded,"bundled Korean DOS font loaded");
   for (const [index,c] of geometry.composers.entries()) {
    const top = Math.min(...c.controls.map(r=>r.y))-c.toolbar.y;
    const bottom = c.toolbar.bottom-Math.max(...c.controls.map(r=>r.bottom));
    check(top>=4 && bottom>=4 && Math.abs(top-bottom)<=1,"composer "+index+" toolbar padding balanced: "+top+" / "+bottom);
    for (const control of c.controls) {
     check(control.x>=c.box.x+6 && control.right<=c.box.right-6,"control inside frame: "+control.text);
     check(control.scrollHeight<=control.clientHeight+1,"control does not clip vertically: "+control.text);
    }
    for(const t of c.textRects) check(t.glyph.y>=t.parent.y && t.glyph.bottom<=t.parent.bottom,"text inside control: "+t.text);
   }
   for(const h of geometry.hints) {
    check(h.fontSize>=16,"readable native-size key: "+h.text+"="+h.fontSize);
    check(Math.abs(h.key.cy-h.label.cy)<=1,"key and label centers aligned: "+h.text);
    check(h.key.x>=16 && h.label.right<=width-16,"hint wraps as unit: "+h.text);
   }
   for(const k of geometry.keys) check(k.key.height>=24,"Enter badge contains DOS line box: "+k.key.height);
  }
  const area=page.getByTestId("composer-input");
  assert.equal(await area.evaluate(el=>el===document.activeElement),true,"composer autofocus");
  const calls=()=>page.evaluate(()=> (window as unknown as {composerLayout:{sent:string[];stopped:number;commands:string[]}}).composerLayout);
  await area.fill("keyboard check");
  await area.press("Shift+Enter");
  assert.equal(await area.inputValue(),"keyboard check" + String.fromCharCode(10));
  assert.equal((await calls()).sent.length,0);
  await area.press("Shift+Tab");
  assert.deepEqual((await calls()).commands,["reasoning:cycle"]);
  await area.press("Enter");
  await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>("[data-testid=composer-input]")?.value==="");
  assert.deepEqual((await calls()).sent,["keyboard check"]);
  if(busy) {
   await area.press("Escape");
   assert.equal((await calls()).stopped,1);
   await page.getByTestId("stop").focus();
   assert.equal(await page.getByTestId("stop").evaluate(el=>el===document.activeElement),true);
   if(theme!=="light") check(await page.getByTestId("stop").evaluate(el=>getComputedStyle(el).outlineStyle)==="solid","visible stop focus");
   await page.keyboard.press("Enter");
   assert.equal((await calls()).stopped,2);
  } else {
   await area.fill("button check");
   await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>("[data-testid=send]")?.disabled);
   await page.getByTestId("send").focus();
   assert.equal(await page.getByTestId("send").evaluate(el=>el===document.activeElement),true);
   if(theme!=="light") check(await page.getByTestId("send").evaluate(el=>getComputedStyle(el).outlineStyle)==="solid","visible send focus");
   await page.keyboard.press("Enter");
   assert.deepEqual((await calls()).sent,["keyboard check","button check"]);
  }
  const shared = page.getByTestId("shared-composer");
  const sharedArea = shared.getByRole("textbox");
  if(busy) {
   const stops = (await calls()).stopped;
   await shared.getByRole("button", {name:"Stop",exact:true}).focus();
   await page.keyboard.press("Enter");
   assert.equal((await calls()).stopped,stops+1);
   await sharedArea.fill("busy draft");
   await sharedArea.press("Enter");
   assert.equal(await sharedArea.inputValue(),"busy draft");
  } else {
   await sharedArea.fill("shared check");
   await sharedArea.press("Shift+Enter");
   assert.equal(await sharedArea.inputValue(),"shared check"+String.fromCharCode(10));
   await sharedArea.press("Enter");
   assert.equal((await calls()).sent.at(-1),"shared check"+String.fromCharCode(10));
   assert.equal(await sharedArea.inputValue(),"");
  }
 }
 writeFileSync(artifacts+"measurements.json",JSON.stringify(results,null,2));
 writeFileSync(artifacts+"failures.json",JSON.stringify(failures,null,2));
 console.log(JSON.stringify({cases:results.length,failures,errors,artifacts},null,2));
 assert.deepEqual(errors,[]);
 assert.deepEqual(failures,[]);
} finally { await browser?.close(); await server.close(); }
