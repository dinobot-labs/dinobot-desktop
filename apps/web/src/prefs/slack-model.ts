import type { CommandPromptSpec } from "@dinobot/contracts";
import type { RunLine } from "../state/command-runner.ts";

/** Preserve every other channel selection: unchecked Telegram means removal in core. */
export function slackSelection(spec: CommandPromptSpec): string | undefined {
 if (spec.type !== "checklist" || !spec.options.some(o => o.id === "slack-personal")) return;
 return JSON.stringify([...new Set([...spec.options.filter(o => o.checked).map(o => o.id), "slack-personal"])]);
}

/** Only the daemon-generated official manifest; no independent scope list to drift. */
export function slackManifest(lines: RunLine[]): { url: string; json: string } | undefined {
 for (const line of [...lines].reverse()) {
  if (line.kind !== "output") continue;
  try {
   const url = new URL(line.text.trim());
   if (url.origin !== "https://api.slack.com" || url.pathname !== "/apps") continue;
   const raw = url.searchParams.get("manifest_json");
   if (!raw) continue;
   const manifest = JSON.parse(raw);
   if (!manifest || typeof manifest !== "object" || !manifest.oauth_config || !manifest.settings) continue;
   return {url: url.href, json: JSON.stringify(manifest, null, 2)};
  } catch {}
 }
}

export function applyLabel(applying: boolean, outcome: unknown): string {
 if (applying) return "설정 적용 · 유휴 상태 확인 및 재시작 중…";
 if (!outcome || typeof outcome !== "object" || !("status" in outcome)) return "아직 적용되지 않았어요. 검증 후 마지막 적용 단계를 마쳐 주세요.";
 const labels: Record<string, string> = {applied:"설정 적용 완료. Slack 실시간 연결은 아직 확인하지 않았어요.",busy:"작업 중인 대화가 있어 적용하지 않았어요. 작업 종료 후 다시 연결하세요.",conflict:"설정 파일이 변경되어 적용하지 않았어요. 다시 연결하세요.",saved_external:"설정은 저장했지만 외부 데몬은 재시작하지 않았어요. 운영자가 재시작해야 해요.",older_daemon:"데몬이 적용 계약을 지원하지 않아요. 업데이트가 필요해요.",rolled_back:"재시작에 실패해 이전 설정을 유지했어요.",failed:"설정 적용에 실패했어요. 연결되지 않았어요."};
 return labels[String(outcome.status)] ?? `적용 결과: ${String(outcome.status)}. 연결 완료를 뜻하지 않아요.`;
}

export type MonitorDraft = {channels: string; summaries: boolean; timeZone: string; quietStart: number; quietEnd: number};
export function monitorRequest(draft: MonitorDraft, enabled = true): string {
 const channels = [...new Set(draft.channels.split(/[\s,]+/).filter(Boolean))];
 if (enabled && (channels.length < 1 || channels.length > 5 || channels.some(id => !/^[CDG][A-Z0-9]{2,}$/.test(id)))) throw new Error("채널/DM ID를 1–5개 입력하세요 (C…, G…, D…).");
 if (![draft.quietStart,draft.quietEnd].every(h => Number.isInteger(h) && h >= 0 && h <= 23)) throw new Error("방해 금지 시간은 0–23시로 입력하세요.");
 try { new Intl.DateTimeFormat("ko", {timeZone:draft.timeZone}).format(); } catch { throw new Error("유효한 IANA 시간대를 입력하세요. 예: Asia/Seoul"); }
 return "로컬 알림 설정을 다음 값으로 slack_personal_monitor 도구에 적용해 주세요. Slack에는 게시하지 마세요.\n" + JSON.stringify({enabled, channels: enabled ? channels : [], summaries:draft.summaries,timeZone:draft.timeZone,quietStart:draft.quietStart,quietEnd:draft.quietEnd},null,2);
}
