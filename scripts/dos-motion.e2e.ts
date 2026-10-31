/** Real Chrome + production components/theme hook. Local UI workload, not daemon/model throughput. */
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../apps/web", import.meta.url));
const output = fileURLToPath(new URL("../test-results/dos-motion/", import.meta.url));
const measure = process.argv.includes("--measure");
const fixture = String.raw`<html lang="ko"><body><div id="root"></div><script type="module">
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import "/src/styles.css";
import {ToolCall, Spinner, TooltipProvider} from "@dinobot/ui";
import {useThemeSync} from "/src/lib/theme.ts";
import {useSettings} from "/src/lib/settings.ts";
function App() {
 useThemeSync();
 const [status,setStatus]=useState("running");
 const [tick,setTick]=useState(0);
 window.streamTick=setTick;
 return React.createElement(TooltipProvider,null,React.createElement("main",null,
  React.createElement("p",null,"LOCAL COMPONENT FIXTURE — no daemon or model"),
  ...["light","dos-blue","dos-black"].map(theme=>React.createElement("button",{key:theme,onClick:()=>useSettings.getState().set({theme})},theme)),
  ...["running","done","failed"].map(next=>React.createElement("button",{key:next,onClick:()=>setStatus(next)},"state-"+next)),
  React.createElement("section",{id:"subject"},
   React.createElement(ToolCall,{name:"motion-probe",summary:"한국어 진행 표시",status,defaultOpen:true},React.createElement("pre",null,"LOCAL "+status)),
   status==="running" ? React.createElement(Spinner,{label:"Loading probe"}) : null),
  React.createElement("section",{id:"workload",style:{height:600,overflow:"auto"}},
   ...Array.from({length:80},(_,i)=>React.createElement(ToolCall,{key:i,name:"local-tool-"+i,summary:"한국어 stream "+(i<4?tick:"history"),status:i<4?"running":"done",defaultOpen:true},
    React.createElement("pre",null,"LOCAL fixture output\n"+"한글 text line ".repeat(12)+(i<4?tick:"")))))
 ));
}
createRoot(document.getElementById("root")).render(React.createElement(App));
</script></body></html>`;
const server = await createServer({
 root, configFile: root + "/vite.config.ts", cacheDir: root + "/node_modules/.vite-dos-motion",
 server: {host:"127.0.0.1",port:0,fs:{allow:[root+"/../..", ...["@fontsource-variable/geist","@fontsource-variable/geist-mono","pretendard"].map(name=>realpathSync(root+"/node_modules/"+name))]}},
 plugins:[{name:"dos-motion-fixture",configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url!=="/dos-motion")return next();
  res.setHeader("Content-Type","text/html");
  res.end(await server.transformIndexHtml("/dos-motion",fixture));
 });}}],
});
const themes = ["light","dos-blue","dos-black"] as const;
const failures: string[] = [];
const observations: unknown[] = [];
const samples: unknown[] = [];
const check = (condition: boolean, message: string) => {if(!condition)failures.push(message);};
async function setTheme(page:Page,theme:string) {
 await page.getByRole("button",{name:theme,exact:true}).click();
 await page.waitForFunction(theme=>document.documentElement.dataset.appearance===(theme==="light"?"default":theme),theme);
 await page.evaluate(()=>document.fonts.ready);
}
async function motion(page:Page,selector:string) {
 const node = page.locator(selector);
 const frames:string[]=[];
 for(let i=0;i<3;i++) {
  frames.push(await node.evaluate(el=>getComputedStyle(el).transform));
  await page.waitForTimeout(130);
 }
 return {frames,moves:new Set(frames).size>1,animations:await node.evaluate(el=>el.getAnimations().map(a=>({state:a.playState,time:a.currentTime})))};
}
let browser;
try {
 await server.listen();
 browser=await chromium.launch({channel:"chrome",headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"no-preference"});
 const errors:string[]=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/daemon/**",route=>route.fulfill({status:503,body:"Isolated local fixture"}));
 const address=server.httpServer!.address();
 assert(address && typeof address!=="string");
 await page.goto("http://127.0.0.1:"+address.port+"/dos-motion");
 await page.getByRole("button",{name:"dos-blue",exact:true}).waitFor();
 for(const reduced of [false,true]) {
  await page.emulateMedia({reducedMotion:reduced?"reduce":"no-preference"});
  for(const theme of themes) {
   await setTheme(page,theme);
   await page.getByRole("button",{name:"state-running",exact:true}).click();
   await page.locator("#subject [data-status=running]").first().waitFor();
   for(const selector of ["#subject [data-slot=status-mark] .dn-spin","#subject [role=status] .dn-spin"]) {
    const result=await motion(page,selector);
    observations.push({theme,reduced,selector,...result});
    check(result.moves===!reduced,theme+" reduced="+reduced+" "+selector+" expected moves="+!reduced);
   }
   if(theme!=="light") {
    const decorativeLoops=await page.locator("#subject").evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a instanceof CSSAnimation && a.animationName!=="dn-spin").length);
    check(decorativeLoops===0,theme+" must keep decorative motion disabled");
   }
   for(const state of ["done","failed"]) {
    await page.getByRole("button",{name:"state-"+state,exact:true}).click();
    await page.locator("#subject [data-status="+state+"]").first().waitFor();
    check(await page.locator("#subject .dn-spin").count()===0,theme+" "+state+" must remove running glyph");
    check(await page.locator("#subject [data-slot=status-mark]").getAttribute("aria-label")===state,theme+" must expose "+state);
    check(await page.locator("#subject").evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations===Infinity).length)===0,theme+" "+state+" must not keep running loops");
   }
  }
 }
 // Theme switches and changes to the OS preference must restart/stop a still-mounted spinner.
 await page.emulateMedia({reducedMotion:"no-preference"});
 await page.getByRole("button",{name:"state-running",exact:true}).click();
 await setTheme(page,"dos-blue");
 await page.emulateMedia({reducedMotion:"reduce"});
 check(!(await motion(page,"#subject [role=status] .dn-spin")).moves,"live reduced-motion must stop spinner");
 await page.emulateMedia({reducedMotion:"no-preference"});
 check((await motion(page,"#subject [role=status] .dn-spin")).moves,"live motion preference must resume spinner");
 await setTheme(page,"light");
 check((await motion(page,"#subject [role=status] .dn-spin")).moves,"default restoration must animate");
 if(measure) {
  const session=await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const metrics=async()=>Object.fromEntries((await session.send("Performance.getMetrics")).metrics.map(m=>[m.name,m.value]));
  const workload=async(frames:number)=>page.evaluate(async frames=>{
   const intervals:number[]=[];let previous=performance.now();
   const scroll=document.querySelector("#workload")!;
   for(let i=0;i<frames;i++) {
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    const now=performance.now();intervals.push(now-previous);previous=now;
    (window as unknown as {streamTick:(n:number)=>void}).streamTick(i);
    scroll.scrollTop=(i*31)%Math.max(1,scroll.scrollHeight-scroll.clientHeight);
   }
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   intervals.shift();const sorted=[...intervals].sort((a,b)=>a-b);
   return {frames:intervals.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor(sorted.length*.95)],over25ms:intervals.filter(n=>n>25).length};
  },frames);
  for(let repetition=0;repetition<5;repetition++) {
   for(const theme of repetition%2===0?themes:[...themes].reverse()) {
    await setTheme(page,theme);await workload(30);
    const before=await metrics();const result=await workload(120);const after=await metrics();
    samples.push({repetition,theme,...result,taskMs:1000*(after.TaskDuration!-before.TaskDuration!),layoutMs:1000*(after.LayoutDuration!-before.LayoutDuration!),styleMs:1000*(after.RecalcStyleDuration!-before.RecalcStyleDuration!)});
   }
  }
  await session.detach();
 }
 check(errors.length===0,"page errors: "+JSON.stringify(errors));
 mkdirSync(output,{recursive:true});
 const report={browser:browser.version(),viewport:"1440x1000",headless:true,workload:"80 expanded actual ToolCalls; 4 running; 120 rAF text updates + scrolling, 30 warmup; 5 alternating-order samples/theme; dev build, no daemon/model",observations,samples,failures};
 writeFileSync(output+"report.json",JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 assert.deepEqual(failures,[],"DOS motion behavioral regression");
 console.log("PASS production Spinner/ToolCall motion, running→done/failed, both DOS colors, default restoration, live reduced-motion");
} finally {await browser?.close();await server.close();}
