import { expect, test } from "bun:test";
import { commandStatus, type SlackStatus } from "../src/prefs/slack-status.ts";
const status: SlackStatus = {kind:"slack.status",version:1,configured:{source:"manifest-on-disk",channel:true,personal:true},runtime:{loaded:true,started:true,connection:"unknown",teamId:"T01",ownerUserId:"U01",readIdentity:"bot"},monitor:{started:true,enabled:true,intervalSeconds:120,watch:{conversationId:"1",channels:["C01"],timeZone:"Asia/Seoul",quietStart:22,quietEnd:8,summaries:true},lastPollAt:null,lastError:null,threadError:null,trackedThreads:0,delivery:"bounded"},disconnect:{configuration:"not-staged",connection:"unchanged",restartRequired:false}};
const lines = (value: unknown) => [{kind:"output" as const,text:JSON.stringify(value),level:"info" as const}];
test("v1 status accepts active, staged and unavailable runtime without inventing connectivity",()=>{
 expect(commandStatus({state:"done",lines:lines(status)})).toEqual(status);
 const unavailable={...status,monitor:null,runtime:{...status.runtime,loaded:false,started:false,teamId:null,ownerUserId:null,readIdentity:null},disconnect:{configuration:"staged",connection:"unchanged",restartRequired:true}};
 expect(commandStatus({state:"done",lines:lines(unavailable)}).monitor).toBeNull();
});
test("status requires done and one schema-valid output; rejects future versions and malformed nested state",()=>{
 for(const state of ["running","error","cancelled"] as const) expect(()=>commandStatus({state,lines:lines(status)})).toThrow();
 for(const value of [{...status,version:2},{...status,token:"secret"},{...status,runtime:null},{...status,monitor:{...status.monitor,intervalSeconds:1}},{...status,configured:{channel:true}},null,"prose"]) expect(()=>commandStatus({state:"done",lines:lines(value)})).toThrow();
 for(const output of [[],[...lines(status),...lines(status)],[{kind:"output" as const,text:"not-json",level:"info" as const}]]) expect(()=>commandStatus({state:"done",lines:output})).toThrow();
});
