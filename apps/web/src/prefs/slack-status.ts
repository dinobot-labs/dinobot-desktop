import schema from "./slack-command-v1.schema.json";
import type { CommandRun } from "../state/command-runner.ts";

export type SlackStatus = {
 kind: "slack.status"; version: 1;
 configured: {source: "manifest-on-disk" | "unavailable"; channel: boolean; personal: boolean};
 runtime: {loaded: boolean; started: boolean; connection: "unknown"; teamId: string | null; ownerUserId: string | null; readIdentity: "bot" | "user" | null};
 monitor: null | {started: boolean; enabled: boolean; intervalSeconds: number; watch: null | {conversationId: string; channels: string[]; timeZone: string; quietStart: number; quietEnd: number; summaries: boolean}; lastPollAt: number | null; lastError: string | null; threadError: string | null; trackedThreads: number; delivery: string};
 disconnect: {configuration: "staged" | "not-staged"; connection: "unchanged"; restartRequired: boolean};
};
// Only the keywords used by the pinned status schema; unknown keywords fail closed.
function matches(s: any, value: any): boolean {
 if (Object.keys(s).some(k => !["type","required","properties","additionalProperties","anyOf","const","minimum","maximum","items"].includes(k))) return false;
 if (s.anyOf) return s.anyOf.some((variant: any) => matches(variant,value));
 if ("const" in s && value !== s.const) return false;
 if (s.type === "null") return value === null;
 if (s.type === "object") return value !== null && typeof value === "object" && !Array.isArray(value) && s.required.every((k: string) => Object.hasOwn(value,k)) && Object.keys(value).every(k => s.properties[k] && matches(s.properties[k],value[k]));
 if (s.type === "array") return Array.isArray(value) && value.every(v => matches(s.items,v));
 if (s.type === "integer" ? !Number.isInteger(value) : typeof value !== s.type) return false;
 return (s.minimum === undefined || value >= s.minimum) && (s.maximum === undefined || value <= s.maximum);
}
export function commandStatus(run: Pick<CommandRun,"state" | "lines">): SlackStatus {
 if (run.state !== "done") throw new Error("Slack 명령이 완료되지 않았어요.");
 const outputs = run.lines.filter(l => l.kind === "output");
 if (outputs.length !== 1 || outputs[0]?.kind !== "output") throw new Error("Slack 상태 응답을 확인할 수 없어요. 데몬 버전을 확인하세요.");
 let value: unknown;
 try { value = JSON.parse(outputs[0].text); } catch { throw new Error("Slack 상태 응답 형식이 올바르지 않아요."); }
 if (!matches(schema.statusResponse,value)) throw new Error("지원하지 않는 Slack 상태 응답이에요. 데몬 버전을 확인하세요.");
 return value as SlackStatus;
}
