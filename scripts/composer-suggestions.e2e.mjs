/** Real ChatView/Composer in a finite shell; only native file completion is mocked. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function checkSuggestions(page, url) {
 const directory = fileURLToPath(new URL("../test-results/composer-suggestions/" + (process.env.LAYOUT_PHASE ?? "after") + "/", import.meta.url));
 mkdirSync(directory, {recursive:true});
 await page.addInitScript(() => Object.assign(window, {dinobotDesktop:{
  platform:"win32",setTitleBarTheme:()=>{},
  refsComplete:async () => Array.from({length:8},(_,i)=>({label:"file-"+i+".tsx",insert:"@file:file-"+i+".tsx ",description:"workspace file"})),
 }}));
 const failures=[],measurements=[];
 const geometry = () => page.getByTestId("chat-view").evaluate(chat => {
  const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  return {chat:box(chat),footer:box(chat.lastElementChild),transcript:box(chat.firstElementChild),composer:box(document.querySelector("[data-slot=composer]"))};
 });
 const visible = locator => locator.evaluate(el => {
  const r=el.getBoundingClientRect();
  const points=[[r.left+r.width/2,r.top+2],[r.left+r.width/2,r.bottom-2],[r.left+2,r.top+r.height/2],[r.right-2,r.top+r.height/2]];
  return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,hit:points.every(([x,y])=>{const hit=document.elementFromPoint(x,y);return x>=0&&x<innerWidth&&y>=40&&y<innerHeight&&(hit===el||el.contains(hit));})};
 });
 for(const theme of ["light","dos-blue","dos-black"]) for(const width of [1200,768,420,320]) for(const long of [false,true]) {
  const name=theme+"-"+width+"-"+(long?"ask-photo":"ordinary");
  const check=(ok,message)=>{if(!ok)failures.push(name+": "+message);};
  await page.setViewportSize({width,height:700});
  await page.goto(url+"__ask_test?theme="+theme);
  await page.waitForFunction(()=>window.fixture);
  await page.evaluate(long=>long?window.fixture.setupLong():window.fixture.setup([]),long);
  await page.evaluate(()=>document.fonts.ready);
  const area=page.getByTestId("composer-input"),popup=page.getByTestId("composer-suggestions");
  if(long) {
   await page.getByTestId("composer-file-input").setInputFiles({name:"photo.png",mimeType:"image/png",buffer:await page.screenshot()});
   await page.waitForFunction(()=>{const img=document.querySelector("[data-testid=attachments] img");return img?.complete&&img.naturalWidth>0;});
  }
  await area.fill("draft");await area.focus();
  const baseline=await geometry();
  for(const token of ["/","@file-"]) {
   await area.fill(token);await popup.waitFor();
   await page.waitForFunction(()=>document.querySelectorAll("[data-testid=composer-suggestions] [role=option]").length===8);
   // Wait for native layout/positioning, not an arbitrary wall-clock delay.
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const opened=await geometry(),box=await visible(popup);
   await page.screenshot({path:directory+name+(token==="/"?"-commands":"-files")+".png"});
   check(box.hit,token+" popup fully visible/hit-testable: "+JSON.stringify(box));
   check(JSON.stringify(opened)===JSON.stringify(baseline),token+" does not move the composer/transcript/footer");
   check(await area.evaluate(el=>el===document.activeElement),token+" retains input focus");
   const options=popup.getByRole("option");
   await area.press("ArrowDown");
   check(await options.nth(1).getAttribute("aria-selected")==="true",token+" keyboard highlights second option");
   await area.press("Tab");
   check(await area.inputValue()===(token==="/"?"/thread ":"@file:file-1.tsx "),token+" Tab accepts selected option");
   await area.fill(token);await popup.waitFor();
   await area.press("ArrowUp");
   const last=await visible(options.last());
   check(last.hit,token+" keyboard-selected last option is exposed: "+JSON.stringify(last));
   await area.press("Enter");
   check(await area.inputValue()===(token==="/"?"/settings ":"@file:file-7.tsx "),token+" Enter accepts last option rather than sends");
   check(await page.evaluate(()=>window.fixture.calls.length===0),token+" completion never sends a message");
   await area.fill(token);await popup.waitFor();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const first=await visible(options.first());
   if(first.hit) {
    await options.first().click({timeout:2000});
    check(await area.inputValue()===(token==="/"?"/new ":"@file:file-0.tsx "),token+" mouse accepts first option");
   } else check(false,token+" first option cannot be clicked");
   await area.fill(token);await popup.waitFor();
   // Keep the anchored overlay usable when the native window changes size.
   await page.setViewportSize({width:width-10,height:700});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   check((await visible(popup)).hit,token+" remains visible after resize");
   await page.setViewportSize({width,height:700});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await area.press("Escape");
   check(await popup.count()===0,token+" Escape dismisses suggestions");
   check(await area.inputValue()===token,token+" Escape preserves draft");
   await area.fill("draft");
   measurements.push({name,token,baseline,opened,box,last,first});
  }
  check(await page.evaluate(()=>[document.documentElement,document.body,document.getElementById("root")].every(el=>el.scrollTop===0&&el.scrollLeft===0&&el.scrollWidth<=innerWidth)),"shell remains locked without horizontal overflow");
  if(long) check(await page.getByTestId("attachments").count()===1,"completion preserves attachment");
  await page.screenshot({path:directory+name+".png"});
 }
 writeFileSync(directory+"measurements.json",JSON.stringify(measurements,null,2));
 writeFileSync(directory+"failures.json",JSON.stringify(failures,null,2));
 console.log(JSON.stringify({suggestionCases:measurements.length,failures,artifacts:directory},null,2));
 assert.deepEqual(failures,[]);
}
