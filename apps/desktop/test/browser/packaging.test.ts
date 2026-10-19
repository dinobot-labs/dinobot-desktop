import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertSharedBrowserHost } from "../../scripts/browser-protocol.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(body: string) {
 const root = mkdtempSync(join(import.meta.dir, ".protocol-")); roots.push(root);
 const dir = join(root, "node_modules", "dinobot"); mkdirSync(dir, { recursive: true });
 writeFileSync(join(dir, "browser-host.js"), body); return root;
}
test("packaging accepts passive shared-browser host without Chrome or descriptor", () => {
 const root = fixture(`const request=JSON.parse(await Bun.stdin.text()); const cfg=JSON.parse(process.env.DINOBOT_BROWSER_CONFIG); if(request.cmd!=="ui_state"||Object.keys(process.env).some(k=>k.toUpperCase()==="DINOBOT_BROWSER_DESKTOP")||cfg.mode!=="dedicated"||!cfg.profile.endsWith(".browser-protocol-unused")) process.exit(2); console.log(JSON.stringify({id:request.id,ok:true,result:{text:"",ui:{ok:true,state:{connected:false,mode:"dedicated"}}}}));`);
 expect(() => assertSharedBrowserHost(root,{...process.env,dinobot_browser_desktop:"synthetic-only",DINOBOT_BROWSER_CONFIG:"must-not-inherit"})).not.toThrow();
 expect(existsSync(join(root, ".browser-protocol-unused"))).toBe(false);
 expect(existsSync(join(root, "desktop.json"))).toBe(false);
});
test("packaging blocks the old host protocol and malformed output, without leaking stderr", () => {
 for (const response of [JSON.stringify({id:1,ok:false,error:"InvalidArguments: unknown action ui_state"}),"not JSON"]) {
  const root = fixture(`console.error("synthetic-secret-do-not-log"); console.log(${JSON.stringify(response)});`);
  expect(() => assertSharedBrowserHost(root)).toThrow("Release the updated browser host");
  try { assertSharedBrowserHost(root); } catch (error) { expect(String(error)).not.toContain("synthetic-secret-do-not-log"); }
 }
});
