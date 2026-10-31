/** Real Desktop UI + actual core setupCommand; ONLY Slack transport is mocked. No daemon is started.
 * DINOBOT_CORE_PATH=C:/.../dinobot-slack-personal bun scripts/slack-onboarding.e2e.ts
 */
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { createRequire } from "node:module";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { default: tailwindcss } = await import(pathToFileURL(webRequire.resolve("@tailwindcss/vite")).href);
const root = fileURLToPath(new URL("..",import.meta.url));
const core = process.env.DINOBOT_CORE_PATH;
if (!core) throw new Error("Set DINOBOT_CORE_PATH to the verified bot-first core checkout");
const {setupCommand} = await import(pathToFileURL(resolve(core,"src/commands/setup.ts")).href);
const {SLACK_BOT_SCOPES,SLACK_USER_SCOPES} = await import(pathToFileURL(resolve(core,"src/setup/slack.ts")).href);
const {createCommands} = await import(pathToFileURL(resolve(core,"src/commands/index.ts")).href);
const {createSlackPersonalPlugin} = await import(pathToFileURL(resolve(core,"src/plugins/slack_personal/index.ts")).href);
const {loadPlugin} = await import(pathToFileURL(resolve(core,"src/plugins/types.ts")).href);
const {createPrivateFile} = await import(pathToFileURL(resolve(core,"src/telegram-private-files/index.ts")).href);
const {replaceManifest} = await import(pathToFileURL(resolve(core,"src/setup/manifest-file.ts")).href);
const evidence = join(root,"qa/slack");
await mkdir(evidence,{recursive:true});
const home = await mkdtemp(join(evidence,"fixture-"));
const manifestPath = join(home,"dinobot.yaml");
const base = "bot:\n  model: faux/test\nchannels:\n  telegram:\n    botTokenFile: existing.token\nplugins: {}\n";
await writeFile(manifestPath,base);
let mode: "bot" | "personal" | "old" = "bot";
let failure = "";
let applied: any;
let commandPath = "";
const publicEvents: any[] = [];
const prompts = new Map<string,{resolve:(v:string)=>void;reject:(e:Error)=>void}>();
let n = 0;
class Socket {
 listeners = new Map<string,Function[]>();
 constructor(_url:string) { queueMicrotask(() => { for (const l of this.listeners.get("message") ?? []) l({data:JSON.stringify({type:"hello",connection_info:{app_id:"A01234"}})}); }); }
 addEventListener(t:string,l:Function) {this.listeners.set(t,[...(this.listeners.get(t)??[]),l]);}
 send() {} close() {}
}
const botFile = join(home,"monitor.token");
createPrivateFile(botFile,"xoxb-monitor-fixture");
const load = async () => {
 const plugin = await loadPlugin(createSlackPersonalPlugin({timers:false,fetch:async(url:string) => {
  if(url.endsWith("auth.test")) return Response.json({ok:true,team_id:"T01234",user_id:"UBOT01",bot_id:"B01234"},{headers:{"x-oauth-scopes":SLACK_BOT_SCOPES.join(",")}});
  if(url.endsWith("bots.info")) return Response.json({ok:true,bot:{app_id:"A01234"}});
  return Response.json({ok:true,messages:[]});
 }}),{botTokenFile:botFile,teamId:"T01234",ownerUserId:"UOWNER"},{dataDir:home,resolveDependency:async()=>undefined});
 if(Array.isArray(plugin)) throw Error(plugin.join(";"));
 return plugin;
};
let plugin = await load();
const bot = {conversation:async(channel:string,key:string)=>{assert.equal(channel,"tui");assert.equal(key,"desktop-settings");return {id:1};}};
const registry = (plugins: any[]) => createCommands({bot,plugins,models:{},auth:{},setup:{manifestPath,dataDir:home,pluginCatalog:{}}});
let commands = registry([plugin]);
const command = setupCommand({bot:{conversation:async()=>({id:1}),harness:{snapshot:async()=>undefined}}}, {
 manifestPath,dataDir:home,pluginCatalog:{},slack:{WebSocket:Socket,helloTimeoutMs:1000,fetch:async(url:string,init:RequestInit) => {
  const method = new URL(url).pathname.split("/").pop();
  if (failure && method === "auth.test") {const error = failure;failure="";return Response.json({ok:false,error});}
  const personal = new Headers(init.headers).get("authorization")?.includes("xoxp-");
  if(method === "auth.test") return Response.json({ok:true,team:"Mock Workspace",team_id:"T01234",user_id:personal?"UOWNER":"UBOT01",bot_id:personal?undefined:"B01234"},{headers:{"x-oauth-scopes":(personal?SLACK_USER_SCOPES:SLACK_BOT_SCOPES).join(",")}});
  if(method === "bots.info") return Response.json({ok:true,bot:{app_id:"A01234",name:"Test bot"}});
  if(method === "apps.connections.open") return Response.json({ok:true,url:"wss://wss-primary.slack.com/link/"});
  throw new Error("Unexpected Slack method " + method);
 }}
});
const server = await createServer({configFile:false,root:join(root,"apps/web"),resolve:{dedupe:["react","react-dom"]},plugins:[tailwindcss(),{name:"slack-contract-fixture",configureServer(server){
 server.middlewares.use(async(req,res,next)=>{
  if(req.url === "/fixture") {
   res.setHeader("Content-Type","text/html");
   return res.end(await server.transformIndexHtml("/fixture",'<html><body><div id="root" style="height:100vh;overflow:auto;padding:24px;max-width:900px;margin:auto"></div><script type="module">import React from "react";import {createRoot} from "react-dom/client";import {SlackTab} from "/src/prefs/SlackTab.tsx";import {useApp} from "/src/state/app.ts";import {useRunner} from "/src/state/command-runner.ts";import "/src/styles.css";window.app=useApp;window.runner=useRunner;useApp.setState({activeKey:"slack:shared-room"});createRoot(document.getElementById("root")).render(React.createElement(SlackTab));</script></body></html>'));
  }
  if (!req.url?.startsWith("/daemon/")) return next();
  let raw=""; for await(const chunk of req) raw+=chunk;
  if(req.url.includes("/prompts/")) {
   const id=decodeURIComponent(req.url.split("/").pop()!);const pending=prompts.get(id);prompts.delete(id);const answer=JSON.parse(raw);
   if(answer.cancel) pending?.reject(new Error("cancelled"));else pending?.resolve(answer.value);
   res.setHeader("Content-Type","application/json");return res.end("{}");
  }
  if(!req.url.endsWith("/commands")) {res.statusCode=404;return res.end();}
  commandPath=req.url;const body=JSON.parse(raw);assert.ok(body.name === "setup" || body.name === "slack");assert.ok(commandPath.includes("/tui/desktop-settings/commands"));
  res.setHeader("Content-Type","text/event-stream");res.flushHeaders();
  const abort=new AbortController();res.on("close",()=>{abort.abort();for(const p of prompts.values())p.reject(new Error("cancelled"));prompts.clear();});
  const emit=(event:any)=>{publicEvents.push(event);res.write("data: "+JSON.stringify(event)+"\n\n");};
  if(body.name === "slack") {
   for await(const event of commands.run(commands.find("slack","tui"),body.args,{surface:"tui",channel:"tui",threadKey:"desktop-settings",userId:"local",context:{},signal:abort.signal}).events) {
    if(event.type === "apply") applied=event.request;
    emit(event);
   }
   return res.end();
  }
  emit({type:"started",runId:"fixture"});
  const prompt=async(spec:any)=> {const id=String(++n);const result=new Promise<string>((resolve,reject)=>prompts.set(id,{resolve,reject}));emit({type:"prompt",id,prompt:spec});return result;};
  try {
   if(body.name === "setup" && mode === "old") await prompt({type:"checklist",message:"Legacy channels",options:[{id:"slack",label:"Slack",checked:false}]});
   else await command.run(body.args,{surface:"tui",channel:"tui",threadKey:"desktop-settings",userId:"local",locale:"en",context:{},io:{interactive:true,signal:abort.signal,print:(text:string,level="info")=>emit({type:"output",text,level}),prompt,notify:(event:any)=>emit({type:"auth",event}),state:()=>{},apply:(request:any)=>{applied=request;emit({type:"apply",request});}}});
   emit({type:"done"});
  } catch(error) {if(!abort.signal.aborted)emit({type:"error",message:String(error)});}
  res.end();
 });
}}],server:{host:"127.0.0.1",port:0}});
let browser;
try {
 await server.listen();browser=await chromium.launch({channel:"chrome",headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:1000}});
 const errors:string[]=[];page.on("pageerror",e=>errors.push(String(e)));
 await page.goto(server.resolvedUrls!.local[0]!+"fixture");
 await page.getByRole("button",{name:"연결 / 다시 연결",exact:true}).click();
 const field=page.getByTestId("prompt-field");
 await field.fill("Desktop fixture");await field.press("Enter");
 await page.getByText("Bot access · two tokens (recommended)",{exact:true}).click();
 await page.getByTestId("slack-manifest").waitFor();
 assert.equal(await field.inputValue(),"");assert.equal(await field.getAttribute("type"),"password");
 await page.screenshot({path:join(evidence,"bot-token.png"),fullPage:true});
 failure="missing_scope";
 await field.fill("xoxb-fixture-only");await field.press("Enter");
 await page.getByText("Paste again",{exact:true}).click();
 assert.equal(await field.inputValue(),"");
 await field.fill("xoxb-fixture-only");await field.press("Enter");
 await page.getByPlaceholder("xapp-…").waitFor();assert.equal(await field.inputValue(),"");
 await field.fill("xapp-fixture-only");await field.press("Enter");
 await page.getByPlaceholder("U0123ABCD").waitFor();assert.equal(await field.getAttribute("type"),"text");
 await field.fill("UOWNER");await field.press("Enter");
 await page.getByRole("option",{name:"Apply",exact:true}).click();
 await page.getByTestId("slack-apply").waitFor();
 assert.ok(applied.candidate.includes("telegram:"));assert.ok(applied.candidate.includes("slack_personal:"));assert.ok(!applied.candidate.includes("userTokenFile"));
 assert.ok(commandPath.includes("/tui/desktop-settings/commands"));
 assert.equal(await readFile(manifestPath,"utf8"),base);
 assert.ok(!JSON.stringify(publicEvents).includes("xoxb-fixture-only"));
 assert.ok(!JSON.stringify(publicEvents).includes("xapp-fixture-only"));
 assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes("fixture-only"));
 assert.ok(!(await page.evaluate(()=>JSON.stringify((window as any).runner.getState()))).includes("fixture-only"));
 // Real monitor SQLite commit through the existing POST/SSE command transport.
 await writeFile(manifestPath,applied.candidate);
 await page.getByRole("button",{name:"상태 새로고침",exact:true}).click();
 await page.getByTestId("slack-status").filter({hasText:"Slack 채널 있음"}).waitFor();
 await page.getByRole("button",{name:"알림 저장",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"1–5"}).waitFor();
 await page.getByLabel("감시 채널 ID").fill("C012ABC, D034DEF");
 await page.getByLabel("시간별 채널 요약",{exact:false}).check();
 await page.getByLabel("확인 주기",{exact:true}).fill("120");
 await page.getByLabel("방해 금지 시작",{exact:true}).fill("23");
 await page.getByRole("button",{name:"알림 저장",exact:true}).click();
 await page.getByTestId("slack-status").filter({hasText:"알림: 설정 켜짐"}).waitFor();
 const stored = plugin.slackPersonal.status().monitor;
 assert.equal(stored.enabled,true);assert.equal(stored.intervalSeconds,120);
 assert.deepEqual(stored.watch.channels,["C012ABC","D034DEF"]);assert.equal(stored.watch.summaries,true);assert.equal(stored.watch.quietStart,23);
 await plugin.close();plugin=await load();commands=registry([plugin]);
 await page.reload();
 await page.waitForFunction(()=> (document.querySelector('[aria-label="감시 채널 ID"]') as HTMLInputElement)?.value === "C012ABC, D034DEF");
 assert.equal(await page.getByLabel("확인 주기",{exact:true}).inputValue(),"120");
 assert.equal(await page.getByLabel("방해 금지 시작",{exact:true}).inputValue(),"23");
 assert.equal(await page.getByLabel("시간별 채널 요약",{exact:false}).isChecked(),true);
 assert.deepEqual(plugin.slackPersonal.status().monitor,stored);
 await page.screenshot({path:join(evidence,"monitor-restored.png"),fullPage:true});
 await page.getByRole("button",{name:"알림 끄기",exact:true}).click();
 await page.getByTestId("slack-status").filter({hasText:"알림: 꺼짐"}).waitFor();
 assert.equal(plugin.slackPersonal.status().monitor.enabled,false);
 await page.getByLabel("감시 채널 ID").fill("D034DEF");
 await page.getByRole("button",{name:"알림 저장",exact:true}).click();
 await page.getByTestId("slack-status").filter({hasText:"알림: 설정 켜짐"}).waitFor();
 const beforeDisconnect=await readFile(manifestPath,"utf8");
 await writeFile(manifestPath,"channels: [");
 await page.getByRole("button",{name:"상태 새로고침",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"Unable to read Slack configuration"}).waitFor();
 assert.equal(await page.getByTestId("slack-status").count(),0);
 assert.equal(await page.getByRole("button",{name:"알림 저장",exact:true}).isDisabled(),true);
 await writeFile(manifestPath,beforeDisconnect);
 await page.getByRole("button",{name:"상태 새로고침",exact:true}).click();
 await page.getByTestId("slack-status").filter({hasText:"알림: 설정 켜짐"}).waitFor();
 await page.getByRole("button",{name:"연결 해제",exact:true}).click();
 await page.getByTestId("slack-status").filter({hasText:"연결 해제는 설정 적용·재시작 대기"}).waitFor();
 assert.equal(plugin.slackPersonal.status().monitor.enabled,false);
 assert.equal(await readFile(manifestPath,"utf8"),beforeDisconnect);
 assert.equal(await readFile(botFile,"utf8"),"xoxb-monitor-fixture");
 assert.equal(await page.getByRole("button",{name:"알림 저장",exact:true}).isDisabled(),true);
 await page.evaluate(()=>(window as any).app.setState({applyOutcome:{status:"busy"}}));
 await page.getByTestId("slack-disconnect-apply").filter({hasText:"적용하지"}).waitFor();
 await page.evaluate(()=>(window as any).app.setState({applyOutcome:{status:"saved_external"}}));
 await page.getByTestId("slack-disconnect-apply").filter({hasText:"외부 데몬은 재시작하지"}).waitFor();
 await page.getByTestId("slack-status").filter({hasText:"설정 적용·재시작 대기"}).waitFor();
 const disconnectApply=applied;
 assert.ok(disconnectApply.candidate.includes("telegram:"));assert.ok(disconnectApply.candidate.includes("slack_personal: false"));
 await writeFile(manifestPath,beforeDisconnect+"# concurrent\n");
 await assert.rejects(()=>replaceManifest(manifestPath,disconnectApply.candidate,disconnectApply.baseSha256));
 await writeFile(manifestPath,beforeDisconnect);
 await replaceManifest(manifestPath,disconnectApply.candidate,disconnectApply.baseSha256);
 await plugin.close();plugin=await load();
 assert.equal(plugin.slackPersonal.status().monitor.enabled,false);
 // Simulate restart handoff with no Slack plugin, not a live restart.
 commands=registry([]);
 await page.evaluate(()=>(window as any).app.setState({applyOutcome:{status:"applied"}}));
 await page.getByTestId("slack-status").filter({hasText:"Slack 채널 없음"}).waitFor();
 await page.getByTestId("slack-status").filter({hasText:"알림: 사용 불가"}).waitFor();
 await page.screenshot({path:join(evidence,"disconnect-applied-fixture.png"),fullPage:true});
 // Optional user reading uses the same real backend contract and never enables user sending.
 mode="personal";
 await page.getByRole("button",{name:"연결 / 다시 연결",exact:true}).click();
 await field.fill("Personal fixture");await field.press("Enter");
 await page.getByText("Also read personal DMs / search · optional read-only user token",{exact:true}).click();
 await field.fill("xoxb-fixture-only");await field.press("Enter");
 await page.getByPlaceholder("xapp-…").fill("xapp-fixture-only");await field.press("Enter");
 await page.getByPlaceholder("xoxp-…").waitFor();assert.equal(await field.inputValue(),"");
 await field.fill("xoxp-fixture-only");await field.press("Enter");
 await page.getByRole("option",{name:"Apply",exact:true}).click();
 await page.getByTestId("slack-apply").waitFor();assert.ok(applied.candidate.includes("userTokenFile"));
 assert.ok(!JSON.stringify(publicEvents).includes("xoxp-fixture-only"));
 // Cancellation clears password and does not apply a new config.
 const previous=applied;
 await page.getByRole("button",{name:"연결 / 다시 연결",exact:true}).click();
 await field.fill("Cancelled fixture");await field.press("Enter");
 await page.getByText("Bot access · two tokens (recommended)",{exact:true}).click();
 await page.getByPlaceholder("xoxb-…").waitFor();await field.fill("xoxb-never-submitted");await field.press("Escape");
 await page.getByText("취소했어요. 기존 연결을 해제하지 않았어요.",{exact:true}).waitFor();assert.equal(await field.count(),0);assert.equal(applied,previous);
 mode="old";
 await page.getByRole("button",{name:"연결 / 다시 연결",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"지원하지"}).waitFor();
 await page.screenshot({path:join(evidence,"unsupported-daemon.png"),fullPage:true});
 assert.equal(await field.count(),0);assert.equal(applied,previous);
 assert.deepEqual(errors,[]);
 await writeFile(join(evidence,"result.json"),JSON.stringify({pass:true,corePath:core,slack:"mock transport only",daemon:"not started",checks:["real core setup bot + optional personal","missing scope retry","secret clearing and keyboard cancel","local context with shared Slack active","Telegram preserved","CAS apply request staged; browser cannot apply","real command monitor commit / SQLite reopen and UI restoration / disable / staged disconnect / CAS conflict / applied fixture","unsupported old daemon fail closed"],screenshots:["bot-token.png","monitor-restored.png","disconnect-applied-fixture.png","unsupported-daemon.png"]},null,2));
 console.log("PASS real core setup + headless Desktop UI; mocked Slack; no live sends or daemon; isolated fixture CAS apply");
} finally {await browser?.close();await server.close();await plugin.close();await rm(home,{recursive:true,force:true});}
