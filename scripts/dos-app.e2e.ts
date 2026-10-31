/** Built full web app, isolated Chrome, explicit local protocol mock (no model calls). */
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { preview } from "vite";
import { syntheticReplay } from "../apps/web/test/synthetic-replay.ts";
const events = syntheticReplay("thread-dag-todo.jsonl") as any[];
events[0].entries[0].model[0].content="LOCAL MOCK 한국어 도구 검사";
events[0].entries[1].model[0].content=[{type:"text",text:"LOCAL MOCK 결과"}];
events[0].entries[2].model[0].toolName="bash";
events[0].entries[2].model[0].content=[{type:"text",text:"@@ -1 +1 @@\n-old\n+new\n한글 오류 EXIT 1"}];
events[0].entries[2].model[0].isError=true;
events[0].entries[2].model[0].details=undefined;
events.push({type:"tool_execution_update",toolCallId:"ask-call",toolName:"codemode",details:{ask:{id:"dos-ask",from:{conversationId:1},to:"human",kind:"decision",refs:[],question:"LOCAL MOCK 승인 선택",options:["허용 mock","거부 mock"],default:"거부 mock",createdAt:Date.now(),deadlineAt:Date.now()+3600000,state:"open"}}});
const choices:unknown[]=[];
const sse=events.map(event=>"data: "+JSON.stringify(event)+"\n\n").join("");
const root=fileURLToPath(new URL("../apps/web",import.meta.url));
const server=await preview({root,configFile:false,preview:{host:"127.0.0.1",port:5198,strictPort:true}});
let browser;
try {
 browser=await chromium.launch({channel:"chrome",headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce",locale:"ko-KR"});
 const errors:string[]=[]; const failedAssets:string[]=[];
 page.on("pageerror",e=>errors.push(e.message));
 page.on("response",r=>{if(r.status()>=400&&!r.url().includes("/daemon/"))failedAssets.push(r.status()+" "+r.url());});
 await page.context().route("**/daemon/**", async route=>{
  const path=new URL(route.request().url()).pathname;
  let status=200; let body:unknown={};
  if(path.endsWith("/healthz"))body={ok:true};
  else if(path.endsWith("/v1/threads"))body={threads:[{key:"tui:dos-mock",channel:"tui",title:"LOCAL MOCK 한국어",cwd:"C:/mock"}]};
  else if(path.endsWith("/v1/daemon"))body={pid:999999,version:"LOCAL-MOCK",setup:{},busy:[],owner:{kind:"mock"}};
  else if(path.endsWith("/v1/commands"))body={commands:[]};
  else if(path.endsWith("/messages")){choices.push(route.request().postDataJSON());body={submissionId:1};}
  else if(path.endsWith("/model"))body={model:"mock/mock",thinkingLevel:"off",supportedThinkingLevels:["off"]};
  else if(path.endsWith("/events")){await route.fulfill({status:200,contentType:"text/event-stream",body:path.includes("/threads/")?sse:": local mock\n\n"});return;}
  else {status=404;body={error:"Local mock: unsupported"};}
  await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
 });
 await page.goto("http://127.0.0.1:5198/");
 await page.waitForLoadState("networkidle");
 console.log("initial",await page.locator("body").innerText(),errors);
 await page.keyboard.press("Control+,");
 await page.getByTestId("settings").waitFor();
 const original=await page.evaluate(()=>({font:getComputedStyle(document.body).fontFamily,bg:getComputedStyle(document.body).backgroundColor}));
 for(const [label,id,bg] of [["DOS 파랑","dos-blue","rgb(0, 0, 170)"],["DOS 검정","dos-black","rgb(0, 0, 0)"]]) {
  await page.getByRole("radio",{name:label,exact:true}).click();
  await page.waitForFunction(id=>document.documentElement.dataset.appearance===id,id);
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),bg);
  assert.equal(await page.evaluate(()=>document.fonts.check('16px NeoDunggeunmo','한국어 DOS')),true);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).fontSize),"16px");
  assert.equal(await page.getByTestId("settings").evaluate(el=>getComputedStyle(el).borderTopStyle),"double");
  assert.equal(await page.getByTestId("settings").evaluate(el=>getComputedStyle(el).backgroundColor),bg);
  assert.equal(await page.getByTestId("settings").evaluate(el=>getComputedStyle(el).animationName),"none");
  await page.screenshot({path:root+"/dos-app-"+id+".png"});
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await page.getByText("LOCAL MOCK 결과",{exact:true}).waitFor();
  const tool=page.locator('[data-slot="tool-call"] > button').first();
  if(await tool.getAttribute("aria-expanded")!=="true") {await tool.focus();await page.keyboard.press("Enter");}
  await page.getByText("한글 오류 EXIT 1",{exact:false}).waitFor();
  await page.getByTestId("ask-bar").getByRole("button",{name:/거부 mock/}).focus();
  const request=page.waitForRequest(r=>r.url().endsWith("/messages")&&r.method()==="POST");
  await page.keyboard.press("Enter"); await request;
  assert.equal((choices.at(-1) as any).choice.askId,"dos-ask");
  assert.equal((choices.at(-1) as any).choice.option,1);
  await page.screenshot({path:root+"/dos-chat-"+id+".png"});
  await page.reload(); await page.waitForLoadState("networkidle"); await page.keyboard.press("Control+,");
  await page.getByTestId("settings").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-appearance"),id);
  assert.equal(await page.getByRole("radio",{name:label,exact:true}).getAttribute("aria-checked"),"true");
  await page.getByRole("radio",{name:label,exact:true}).focus();
  assert.equal(await page.getByRole("radio",{name:label,exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),"solid");
 }
 await page.getByRole("radio",{name:"시스템",exact:true}).first().click();
 assert.deepEqual(await page.evaluate(()=>({font:getComputedStyle(document.body).fontFamily,bg:getComputedStyle(document.body).backgroundColor})),original);
 assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);
 console.log("PASS built full app: settings shortcut, blue/black, persisted reload, Korean font loaded, double dialog, reduced-motion, focus, default restoration; explicit mock protocol, no model calls");
} finally {await browser?.close();await new Promise<void>((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));}
