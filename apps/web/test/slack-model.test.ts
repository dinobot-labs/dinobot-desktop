import { expect, test } from "bun:test";
import { applyLabel, monitorRequest, slackManifest, slackSelection } from "../src/prefs/slack-model.ts";

test("Slack selection preserves configured Telegram and locked channels", () => {
 expect(JSON.parse(slackSelection({type:"checklist",message:"Channels",options:[{id:"tui",label:"TUI",checked:true,disabled:true},{id:"telegram",label:"Telegram",checked:true},{id:"slack",label:"Slack",checked:true,disabled:true},{id:"slack-personal",label:"Personal",checked:false}]})!)).toEqual(["tui","telegram","slack","slack-personal"]);
 expect(slackSelection({type:"checklist",message:"Old daemon",options:[]})).toBeUndefined();
});
test("official daemon manifest URL only; no duplicate permission catalog", () => {
 const manifest = {oauth_config:{scopes:{bot:["chat:write"]}},settings:{socket_mode_enabled:true}};
 const url = "https://api.slack.com/apps?new_app=1&manifest_json=" + encodeURIComponent(JSON.stringify(manifest));
 expect(JSON.parse(slackManifest([{kind:"output",level:"success",text:url}])!.json)).toEqual(manifest);
 for (const text of [url.replace("api.slack.com","evil.invalid"),"javascript:alert(1)",url.replace("manifest_json=","manifest="),"not a URL"]) expect(slackManifest([{kind:"output",level:"info",text}])).toBeUndefined();
});
test("monitor draft is explicit, bounded and read-only until copied", () => {
 const draft = {channels:"C012ABC, D034DEF C012ABC", summaries:true,timeZone:"Asia/Seoul",quietStart:22,quietEnd:8};
 const request = monitorRequest(draft);
 expect(JSON.parse(request.slice(request.indexOf("{")))).toEqual({enabled:true,channels:["C012ABC","D034DEF"],summaries:true,timeZone:"Asia/Seoul",quietStart:22,quietEnd:8});
 for (const channels of ["","xoxp-secret","C01 C02 C03 C04 C05 C06"]) expect(() => monitorRequest({...draft,channels})).toThrow();
 expect(() => monitorRequest({...draft,timeZone:"not-a-zone"})).toThrow();
 expect(() => monitorRequest({...draft,quietStart:24})).toThrow();
 expect(monitorRequest({...draft,channels:""},false)).toContain('"enabled": false');
});
test("apply, runtime connectivity and failed restart remain distinct", () => {
 expect(applyLabel(false,{status:"applied"})).toContain("아직 확인하지");
 expect(applyLabel(false,{status:"busy"})).toContain("적용하지");
 expect(applyLabel(false,{status:"saved_external"})).toContain("재시작하지");
 expect(applyLabel(false,{status:"conflict"})).toContain("다시 연결");
 expect(applyLabel(true,null)).toContain("재시작 중");
 expect(applyLabel(false,null)).toContain("아직 적용되지");
});
