/** Full ChatView at real window heights; only the daemon boundary is mocked. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function checkChatHeight(page, url) {
 const directory = fileURLToPath(new URL("../test-results/chat-height/" + (process.env.LAYOUT_PHASE ?? "after") + "/", import.meta.url));
 mkdirSync(directory, {recursive:true});
 const failures = [], measurements = [];
 for (const theme of ["light", "dos-blue", "dos-black"]) for (const width of [1200,768,420,320]) {
  const name = theme + "-" + width;
  const check = (ok, message) => { if (!ok) failures.push(name + ": " + message); };
  await page.setViewportSize({width,height:700});
  await page.goto(url + "__ask_test?theme=" + theme);
  await page.waitForFunction(() => window.fixture);
  await page.evaluate(() => window.fixture.setup([]));
  const area = page.getByTestId("composer-input");
  await area.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const normal = await page.getByTestId("chat-view").evaluate(chat => ({
   footerHeight:chat.lastElementChild.getBoundingClientRect().height,
   footerClient:chat.lastElementChild.clientHeight,footerScroll:chat.lastElementChild.scrollHeight,
   transcriptHeight:chat.firstElementChild.getBoundingClientRect().height,
  }));
  check(normal.transcriptHeight>0 && normal.footerScroll<=normal.footerClient+1,"ordinary composer preserves transcript and needs no footer scroll");
  await page.evaluate(() => window.fixture.setupLong());
  await area.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const image = await page.screenshot();
  await page.getByTestId("composer-file-input").setInputFiles({name:"photo.png",mimeType:"image/png",buffer:image});
  await page.waitForFunction(() => { const img = document.querySelector("[data-testid=attachments] img"); return img?.complete && img.naturalWidth > 0; });
  await area.fill("사진과 입력한 글이 겹치지 않아야 합니다.");
  const initial = await page.evaluate(() => {
   const rect = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
   const chat = document.querySelector("[data-testid=chat-view]");
   const footer = chat.lastElementChild;
   const ask = document.querySelector("[data-testid=ask-bar]");
   const area = document.querySelector("[data-testid=composer-input]");
   const attachments = document.querySelector("[data-testid=attachments]");
   return {chat:rect(chat),footer:rect(footer),footerClient:footer.clientHeight,footerScroll:footer.scrollHeight,footerOverflow:getComputedStyle(footer).overflowY,ask:rect(ask),area:rect(area),attachments:rect(attachments),image:rect(attachments.querySelector("img")),docWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,rootWidth:document.getElementById("root").scrollWidth,transcript:rect(document.querySelector("[data-testid=transcript]")),fontLoaded:document.fonts.check("16px NeoDunggeunmo", "한글 DOS"),options:[...ask.querySelectorAll("button")].slice(0,3).map(el=>({box:rect(el),clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}))};
  });
  check(initial.chat.height === 660, "ChatView retains 700px shell minus 40px chrome");
  check(Math.max(initial.docWidth,initial.bodyWidth,initial.rootWidth)<=width, "no document horizontal overflow");
  check(initial.attachments.bottom <= initial.area.y && initial.image.bottom<=initial.area.y, "photo and text do not overlap");
  if(theme!=="light") check(initial.fontLoaded,"bundled DOS font loaded");
  check(initial.footer.height <= initial.chat.height + 1, "footer bounded by ChatView: " + initial.footer.height);
  if(initial.footerScroll > initial.footerClient + 1) check(["auto","scroll"].includes(initial.footerOverflow),"overflowing footer has an intended scroll container");
  for(const option of initial.options) check(option.scrollWidth<=option.clientWidth+1 && option.scrollHeight<=option.clientHeight+1, "option text is not clipped inside its button");
  const targets = [area, ...await page.getByTestId("ask-bar").getByRole("button").all().then(all=>all.slice(0,3)), page.getByPlaceholder("직접 답하기")];
  const reached = [];
  for(const [index,target] of targets.entries()) {
   await target.focus();
   // Native keyboard focus must expose a visible, hit-testable part of the control.
   const focus = await target.evaluate(el => {
    const r=el.getBoundingClientRect(); let top=Math.max(40,r.top),bottom=Math.min(innerHeight,r.bottom),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right);
    for(let p=el.parentElement;p;p=p.parentElement) { if(/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowY)) {const b=p.getBoundingClientRect();top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);} }
    const hit=bottom>top && right>left ? document.elementFromPoint((left+right)/2,(top+bottom)/2) : null;
    return {active:el===document.activeElement,visible:bottom>top && (hit===el || el.contains(hit)),top,bottom};
   });
   check(focus.active && focus.visible,"keyboard focus target " + index + " visible: " + JSON.stringify(focus));
   // Every end of even a taller-than-viewport option can be read through intended scrolling.
   for(const edge of ["start","end"]) {
    await target.evaluate((el,block)=>el.scrollIntoView({block,inline:"nearest"}),edge);
    const reach = await target.evaluate((el,edge)=>{
     const r=el.getBoundingClientRect();const y=edge==="start"?r.top+2:r.bottom-2;const x=r.left+r.width/2;
     const hit=document.elementFromPoint(x,y);
     const escaped=[document.documentElement,document.body,document.getElementById("root")].some(el=>el.scrollTop!==0 || el.scrollLeft!==0);
     return {y,visible:y>=40 && y<innerHeight && (hit===el || el.contains(hit)),escaped};
    },edge);
    check(reach.visible && !reach.escaped,"target "+index+" "+edge+" reachable without scrolling locked shell: "+JSON.stringify(reach));
    reached.push({index,edge,...reach});
   }
  }
  await page.screenshot({path:directory+name+".png"});
  const footer=page.getByTestId("chat-view").locator(":scope > div").last();
  if(initial.footerScroll>initial.footerClient+1 && ["auto","scroll"].includes(initial.footerOverflow)) {
   await footer.evaluate(el=>{el.scrollTop=0;});
   await footer.hover();
   await page.mouse.wheel(0,300);
   await page.waitForFunction(()=>document.querySelector("[data-testid=chat-view]").lastElementChild.scrollTop>0);
   check(await page.evaluate(()=>[document.documentElement,document.body,document.getElementById("root")].every(el=>el.scrollTop===0)),"wheel scroll stays in footer");
  }
  // Run actual option, manual-answer and photo-send paths only when geometry allows interaction.
  if(!failures.some(f=>f.startsWith(name+":"))) {
   const options=page.getByTestId("ask-bar").getByRole("button");
   for(let i=0;i<3;i++) {await options.nth(i).focus();await page.keyboard.press("Enter");await page.waitForFunction(n=>window.fixture.calls.length===n,i+1);}
   await options.nth(2).focus();await page.keyboard.press("Tab");
   check(await page.getByPlaceholder("직접 답하기").evaluate(el=>el===document.activeElement),"Tab reaches manual answer");
   await page.keyboard.type("manual answer");await page.keyboard.press("Enter");
   await page.waitForFunction(()=>window.fixture.calls.length===4);
   await area.focus();await page.keyboard.press("Enter");
   await page.waitForFunction(()=>window.fixture.calls.length===5);
   const calls=await page.evaluate(()=>window.fixture.calls);
   assert.deepEqual(calls.slice(0,3).map(c=>c.choice.option),[0,1,2]);
   assert.equal(calls[3].text,"[ask long-question] answer: manual answer");
   assert.equal(calls[4].images.length,1);
   assert.match(calls[4].text,/사진과 입력한 글/);
   assert.equal(await area.inputValue(),"");
   await page.evaluate(()=>window.fixture.resolve());
   await page.waitForFunction(()=>!document.querySelector("[data-testid=ask-bar]"));
   check(await page.getByTestId("transcript").evaluate(el=>el.clientHeight>0),"transcript is restored after acknowledged answer");
   check(await footer.evaluate(el=>el.scrollTop===0 && el.scrollHeight<=el.clientHeight+1),"footer returns to ordinary non-scrolling layout");
  }
  measurements.push({name,normal,initial,reached});
 }
 writeFileSync(directory+"measurements.json",JSON.stringify(measurements,null,2));
 writeFileSync(directory+"failures.json",JSON.stringify(failures,null,2));
 console.log(JSON.stringify({finiteHeightCases:measurements.length,failures,artifacts:directory},null,2));
 assert.deepEqual(failures,[]);
}
