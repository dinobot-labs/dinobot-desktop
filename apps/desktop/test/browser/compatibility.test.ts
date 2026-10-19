import { expect, test } from "bun:test";
import { BrowserController, type HostResult } from "../../src/features/browser/controller.ts";
import { publicError, validateCall } from "../../src/features/browser/validation.ts";

test("old host protocol produces an update instruction, not a Chrome-install diagnosis", () => {
 expect(publicError(new Error('InvalidArguments: unknown action "ui_state"'))).toContain("BrowserHostOutdated:");
});

test("UI close selects a remaining owned tab without changing agent close semantics", async () => {
 let current = 2; const selected: number[] = [];
 const c = new BrowserController({ async call(cmd,args): Promise<HostResult> {
  if (cmd === "close_tab") current = -1;
  if (cmd === "tab") { current = args.index as number; selected.push(current); }
  return {text:"",ui:{ok:true,state:{connected:true,mode:"dedicated",control:"agent",current,url:current<0?"":"https://remaining.test/",title:"Remaining",width:800,height:600,tabs:[{index:0,owned:false,title:"Not ours",url:"https://private.test/"},{index:1,owned:true,title:"Remaining",url:"https://remaining.test/"}]}}};
 },async close(){}});
 await c.ui("takeover");
 const result = await c.ui("close_tab",{index:2});
 expect(result.state?.current).toBe(1); expect(selected).toEqual([1]);
 await c.ui("resume"); await c.agent(1,"close_tab",{index:1});
 expect(current).toBe(-1); expect(selected).toEqual([1]);
 await c.close();
});

test("desktop relay preserves browser_use hostname navigation", () => {
 expect(validateCall("agent", "open", { url: "example.test/path" }).args.url).toBe("example.test/path");
 expect(validateCall("ui", "open", { url: "example.test/path" }).args.url).toBe("https://example.test/path");
});

test("agent errors preserve snapshot and computer-use fallback guidance, without leaking into UI", async () => {
 const c = new BrowserController({ async call() { throw new Error("StaleRef: take a new snapshot."); }, async close() {} });
 const stale = await c.agent(1,"click",{ref:"e1"});
 expect(!stale.ok && stale.error).toContain("StaleRef:");
 const f = new BrowserController({ async call() { throw new Error("TimeoutError: blocked\nFallback: use computer_use on Chrome."); }, async close() {} });
 const result = await f.agent(2,"click",{ref:"e1"});
 expect(!result.ok && result.error).toContain("Fallback:");
 const ui = await c.ui("state");
 expect(ui.error).not.toContain("StaleRef:");
 await c.close(); await f.close();
});
