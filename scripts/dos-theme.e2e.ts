/** Real Chrome, actual settings/theme hook and UI components; fixtures are NOT external AI/tool execution. */
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { realpathSync } from "node:fs";
const root = fileURLToPath(new URL("../apps/web", import.meta.url));
const fixture = String.raw`<html lang="ko"><head><script>window.__dnLanguage="ko";</script></head><body><div id="root"></div><script type="module">
import React from "react"; import {createRoot} from "react-dom/client";
import "/src/styles.css";
import {GeneralTab} from "/src/prefs/GeneralTab.tsx";
import {useThemeSync} from "/src/lib/theme.ts";
import {useSettings} from "/src/lib/settings.ts";
import {ToolCall, AskCard, TooltipProvider} from "@dinobot/ui";
window.settings = useSettings;
function App() { useThemeSync(); return React.createElement(TooltipProvider, null, React.createElement("main", {style:{height:"100vh",overflow:"auto",padding:16}},
 React.createElement("p", null, "LOCAL MOCK — no external AI execution"),
 React.createElement(GeneralTab),
 ...["running","done","failed","cancelled","waiting"].map(status => React.createElement(ToolCall,{key:status,name:status,summary:"C:/한글/long-path/result.txt",status},React.createElement("pre",null,"@@ -1 +1 @@\n-old\n+new\nEXIT 1"))),
 React.createElement(AskCard,{question:"Mock approval", options:["Allow mock", "Deny mock"], onChoose:(value)=>{document.getElementById("decision").textContent=value;}}), React.createElement("output",{id:"decision"})
 )); }
createRoot(document.getElementById("root")).render(React.createElement(App));
</script></body></html>`;
const server = await createServer({root, configFile: root + "/vite.config.ts", cacheDir: root + "/node_modules/.vite-dos", server:{host:"127.0.0.1",port:5197,strictPort:true,fs:{allow:[root+"/../..", ...["@fontsource-variable/geist","@fontsource-variable/geist-mono","pretendard"].map(name=>realpathSync(root+"/node_modules/"+name))]}}, plugins:[{name:"dos-fixture",configureServer(server){ server.middlewares.use(async(req,res,next)=>{if(req.url!=="/dos-fixture")return next();res.setHeader("Content-Type","text/html");res.end(await server.transformIndexHtml("/dos-fixture",fixture));}); }}]});
let browser;
try {
 await server.listen();
 browser = await chromium.launch({channel:"chrome",headless:true});
 const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
 const errors:string[]=[]; page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/daemon/**",route=>route.fulfill({status:503,body:"Isolated mock: no daemon"}));
 await page.goto("http://127.0.0.1:5197/dos-fixture");
 await page.getByRole("radio",{name:"DOS 파랑",exact:true}).waitFor();
 const original = await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily}));
 for(const [name,id,color] of [["DOS 파랑","dos-blue","rgb(0, 0, 170)"],["DOS 검정","dos-black","rgb(0, 0, 0)"]]) {
  await page.getByRole("radio",{name,exact:true}).click();
  await page.waitForFunction(id=>document.documentElement.dataset.appearance===id,id);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),color);
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.fonts.check("16px NeoDunggeunmo")),true);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontSize),"16px");
  for(const status of ["running","done","failed","cancelled","waiting"]) {
   const trigger=page.locator(`[data-status="${status}"] > button`); await trigger.focus(); await page.keyboard.press("Enter");
   assert.equal(await trigger.getAttribute("aria-expanded"),"true");
   assert.equal(await trigger.evaluate(el=>getComputedStyle(el).outlineStyle),"solid");
   await page.keyboard.press("Space"); assert.equal(await trigger.getAttribute("aria-expanded"),"false");
  }
  await page.getByRole("button",{name:/Deny mock/}).click(); assert.equal(await page.locator("#decision").textContent(),"Deny mock");
  await page.reload(); await page.getByRole("radio",{name,exact:true}).waitFor();
  assert.equal(await page.locator("html").getAttribute("data-appearance"),id);
  assert.equal(await page.getByRole("radio",{name,exact:true}).getAttribute("aria-checked"),"true");
  await page.screenshot({path:root+"/dos-"+id+".png",fullPage:true});
 }
 await page.getByRole("radio",{name:"시스템",exact:true}).first().click();
 assert.deepEqual(await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily})),original);
 assert.deepEqual(errors,[]);
 console.log("PASS actual component fixture: blue/black, font, persistence, default restoration, five tool states, Enter/Space, focus, mock approval; no external AI");
} finally {await browser?.close();await server.close();}
