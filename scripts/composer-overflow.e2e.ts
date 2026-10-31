/** Browser geometry and user actions, not CSS/source-string assertions. Reuses the real component fixture. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "playwright-core";

type Calls = {sent: string[]; payloads: {images:string[];files:string[]}[]; choices:number[];sharedChoices:number[];answers:string[]};
export async function checkOverflow(page: Page, url: string, artifacts: string) {
 const directory = artifacts + (process.env.LAYOUT_PHASE ?? "after") + "/";
 mkdirSync(directory, {recursive:true});
 const failures: string[] = [];
 const measurements: unknown[] = [];
 // Only the native file-staging boundary is mocked. FileReader, images, attachment queue and removal are real.
 await page.addInitScript(() => {
  Object.assign(window, {dinobotDesktop:{platform:"win32",setTitleBarTheme:()=>{},stageAttachment:async (file:File)=>({kind:"file",path:"C:/fixture/"+file.name,name:file.name,bytes:file.size})}});
 });
 const calls = () => page.evaluate(() => (window as unknown as {composerLayout:Calls}).composerLayout);
 for (const theme of ["light","dos-blue","dos-black"]) for (const width of [320,420,768,1200]) {
  const name = theme + "-" + width;
  const check = (ok:boolean, message:string) => {if(!ok) failures.push(name+": "+message);};
  await page.setViewportSize({width,height:4000});
  await page.goto(url+"__composer_layout?overflow=1&theme="+theme);
  const area = page.getByTestId("composer-input");
  await area.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const askGeometry = await page.evaluate(() => {
   const rect=(el:Element|Range)=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const cards=[document.querySelector("[data-testid=ask-bar]")!.firstElementChild!,document.querySelector("[data-slot=ask-card]")!];
   return cards.map(card=>{
    const controls=[...card.querySelectorAll("button,input")].map(el=>({text:el.textContent,box:rect(el),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
    const range=document.createRange();
    const walker=document.createTreeWalker(card,NodeFilter.SHOW_TEXT);
    const glyphs:{text:string|null;box:ReturnType<typeof rect>;parent:ReturnType<typeof rect>}[]=[];
    while(walker.nextNode()) {
     if(!walker.currentNode.textContent?.trim())continue;
     const parent=walker.currentNode.parentElement!.closest("button") ?? walker.currentNode.parentElement!;
     // pre-wrap hanging spaces have a Range box but paint no glyph. Check every non-whitespace run.
     for(const run of walker.currentNode.textContent!.matchAll(/\S+/g)) {
      range.setStart(walker.currentNode,run.index);
      range.setEnd(walker.currentNode,run.index+run[0].length);
      for(const box of range.getClientRects()) glyphs.push({text:run[0].slice(0,40),box:{x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:box.width,height:box.height},parent:rect(parent)});
     }
    }
    const input=card.querySelector("input");
    return {box:rect(card),controls,glyphs,input:input?rect(input):null};
   });
  });
  for(const [index,card] of askGeometry.entries()) {
   for(const control of card.controls) {
    check(control.box.x>=card.box.x && control.box.right<=card.box.right,"ask "+index+" control within card: "+control.text?.slice(0,25));
    if(control.text) check(control.scrollHeight<=control.clientHeight+1 && control.scrollWidth<=control.clientWidth+1,"ask "+index+" full option visible");
   }
   for(const glyph of card.glyphs) check(glyph.box.x>=Math.max(card.box.x,glyph.parent.x)-1 && glyph.box.right<=Math.min(card.box.right,glyph.parent.right)+1 && glyph.box.y>=glyph.parent.y-1 && glyph.box.bottom<=glyph.parent.bottom+1,"ask "+index+" text within parent: "+glyph.text);
   if(card.input) check(card.input.width>=Math.min(120,width/3),"manual answer input usable width "+card.input.width);
  }
  await page.getByTestId("ask-bar").screenshot({path:directory+name+"-ask.png"});
  await page.locator("[data-slot=ask-card]").screenshot({path:directory+name+"-shared-ask.png"});
  for(let index=0;index<3;index++) {
   await page.getByTestId("ask-bar").getByRole("button").nth(index).click();
   await page.locator("[data-slot=ask-card]").getByRole("button").nth(index).click();
  }
  assert.deepEqual((await calls()).choices,[0,1,2]);
  assert.deepEqual((await calls()).sharedChoices,[0,1,2]);
  await page.getByPlaceholder("직접 답하기").fill("수동 답변도 정상적으로 보내 주세요");
  await page.getByRole("button",{name:"답 보내기",exact:true}).click();
  assert.deepEqual((await calls()).answers,["수동 답변도 정상적으로 보내 주세요"]);
  assert.equal(await page.getByPlaceholder("직접 답하기").inputValue(),"");
  // Attach an actual PNG screenshot via the native file input, then exercise the real decoding/rendering path.
  const image = await page.getByTestId("ask-bar").screenshot();
  const fileName="사진설명자료".repeat(15)+".pdf";
  await page.getByTestId("composer-file-input").setInputFiles([
   ...Array.from({length:4},(_,i)=>({name:"photo-"+i+".png",mimeType:"image/png",buffer:image})),
   {name:fileName,mimeType:"application/pdf",buffer:Buffer.from("fixture PDF attachment")},
  ]);
  await page.getByTestId("attachment-file").waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>("[data-testid=attachments] img")].length===4 && [...document.querySelectorAll<HTMLImageElement>("[data-testid=attachments] img")].every(img=>img.complete&&img.naturalWidth>0));
  await area.fill("사진 네 장과 파일을 첨부했습니다. 미리보기와 입력 내용이 겹치지 않아야 합니다.");
  await area.focus();
  await page.getByTestId("desktop-composer").scrollIntoViewIfNeeded();
  const attachmentGeometry = await page.evaluate(()=>{
   const rect=(el:Element)=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const composer=document.querySelector("[data-testid=desktop-composer] [data-slot=composer]")!;
   const area=composer.querySelector("textarea")!;
   const attachments=composer.querySelector("[data-testid=attachments]")!;
   const controls=[...attachments.querySelectorAll("img,button,[data-testid=attachment-file]")].map(el=>({text:el.getAttribute("aria-label")??el.textContent,box:rect(el)}));
   const pills=[...attachments.querySelectorAll("[data-testid=attachment-file]")].map(el=>({box:rect(el),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,children:[...el.children].map(child=>rect(child))}));
   const frame=getComputedStyle(composer),focus=getComputedStyle(area);
   return {box:rect(composer),area:rect(area),toolbar:rect(composer.querySelector("[data-slot=composer-toolbar]")!),attachments:rect(attachments),controls,pills,border:parseFloat(frame.borderWidth),focusOutline:focus.outlineStyle,focusShadow:focus.boxShadow,fontLoaded:document.fonts.check("16px NeoDunggeunmo","한글 DOS")};
  });
  const g=attachmentGeometry;
  for(const control of g.controls) check(control.box.x>=g.box.x+g.border && control.box.right<=g.box.right-g.border && control.box.y>=g.box.y+g.border && control.box.bottom<=g.area.y,"attachment within frame and above text: "+control.text);
  check(g.attachments.bottom<=g.area.y && g.area.bottom<=g.toolbar.y+1,"attachments/text/toolbar do not overlap");
  for(const pill of g.pills) {
   check(pill.scrollHeight<=pill.clientHeight+1,"file pill does not clip vertically");
   for(const child of pill.children) check(child.x>=pill.box.x && child.right<=pill.box.right && child.y>=pill.box.y && child.bottom<=pill.box.bottom,"file pill contains its children");
  }
  if(theme!=="light") {
   check(g.fontLoaded,"bundled DOS font loaded");
   check(g.focusOutline==="none" && g.focusShadow==="none","textarea has no focus stroke crossing attachments");
  }
  await page.getByTestId("desktop-composer").screenshot({path:directory+name+"-attachments.png"});
  await page.getByRole("button",{name:"이미지 빼기",exact:true}).first().click();
  assert.equal(await page.locator("[data-testid=attachments] img").count(),3);
  await page.getByRole("button",{name:"파일 빼기",exact:true}).click();
  assert.equal(await page.getByTestId("attachment-file").count(),0);
  await page.getByTestId("composer-file-input").setInputFiles({name:fileName,mimeType:"application/pdf",buffer:Buffer.from("fixture")});
  await page.getByTestId("attachment-file").waitFor();
  await page.getByTestId("send").click();
  await page.waitForFunction(()=>document.querySelector("[data-testid=attachments]")===null);
  assert.deepEqual((await calls()).payloads,[{images:["photo-1.png","photo-2.png","photo-3.png"],files:[fileName]}]);
  assert.equal((await calls()).sent.length,1);
  assert.equal(await area.inputValue(),"");
  measurements.push({name,askGeometry,attachmentGeometry});
 }
 writeFileSync(directory+"measurements.json",JSON.stringify(measurements,null,2));
 writeFileSync(directory+"failures.json",JSON.stringify(failures,null,2));
 console.log(JSON.stringify({overflowCases:measurements.length,failures:[...new Set(failures)],failureCount:failures.length,artifacts:directory},null,2));
 assert.deepEqual(failures,[]);
}
