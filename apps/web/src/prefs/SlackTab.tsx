import { Button, Input } from "@dinobot/ui";
import { useEffect, useRef, useState } from "react";
import { openUrl, RunLines } from "../dialogs/CommandRun.tsx";
import { PromptView } from "../dialogs/PromptView.tsx";
import { desktop } from "../lib/bridge.ts";
import { runCommandUi, useApp } from "../state/app.ts";
import { answerPrompt, cancelCommand, closeRun, useRunner } from "../state/command-runner.ts";
import { Section } from "./kit.tsx";
import { applyLabel, monitorRequest, slackManifest, slackSelection, type MonitorDraft } from "./slack-model.ts";

/** One credential owner: the existing command prompt protocol, never a chat/model request. */
export function SlackTab() {
 const allRun = useRunner(s => s.run);
 const run = allRun?.surface === "slack" ? allRun : null;
 const applying = useApp(s => s.applying);
 const outcome = useApp(s => s.applyOutcome);
 const [unsupported, setUnsupported] = useState(false);
 const [notice, setNotice] = useState("");
 const selected = useRef<number | null>(null);
 const manifest = slackManifest(run?.lines ?? []);
 useEffect(() => {
  if (!run?.prompt || run.prompt.spec.type !== "checklist" || selected.current === run.id) return;
  selected.current = run.id;
  const selection = slackSelection(run.prompt.spec);
  if (selection === undefined) { setUnsupported(true); void cancelCommand(); }
  else void answerPrompt(selection);
 }, [run?.id, run?.prompt]);
 useEffect(() => () => {
  if (useRunner.getState().run?.surface === "slack" && useRunner.getState().run?.state === "running") void cancelCommand();
 }, []);
 async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); setNotice("복사했어요."); }
  catch { setNotice("복사하지 못했어요. 아래 내용을 직접 선택해 복사하세요."); }
 }
 function start() {
  setUnsupported(false); setNotice("");
  if (runCommandUi("setup", "channels", "slack")) useApp.setState({applyOutcome:null});
 }
 const busy = allRun?.state === "running" || applying;
 return <div className="flex flex-col gap-6" data-testid="slack-tab">
  <Section title="Slack 봇 하나로 연결" description="읽기 권한과 보내는 사람은 달라요. 메시지·파일은 항상 봇 이름으로 보냅니다.">
   <div className="rounded-lg border border-line bg-sunken p-4 text-sm leading-relaxed">
    <ol className="list-decimal space-y-1 pl-5"><li>앱 이름과 읽기 범위를 선택하세요.</li><li>자동 입력 링크로 앱을 만들고 워크스페이스에 설치하세요.</li><li>봇 토큰(xoxb), 앱 토큰(xapp)을 복사해 아래 비밀 입력란에 붙여 넣으세요.</li><li>본인 Slack 멤버 ID를 지정하고 검증·적용하세요.</li></ol>
    <p className="mt-3">기본: 봇이 참여한 채널·DM 읽기, 메시지·파일 송수신. 선택: 읽기 전용 사용자 토큰(xoxp)으로 내 채널·DM과 검색까지. 사용자 이름으로 보내지는 않습니다.</p>
    <p className="mt-2 text-fg-3">설정한 본인은 봇과의 1:1 DM에서도 도구를 사용할 수 있어요. 공유 채널에서는 개인 읽기를 허용하지 않아요. 멤버 ID 지정은 계정 소유권 인증이 아닙니다.</p>
   </div>
   <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={start}>연결 / 다시 연결</Button>{run ? <Button disabled={applying} onClick={() => { closeRun(); setNotice("마법사를 닫았어요. 이는 기존 Slack 연결 해제가 아닙니다."); }}>마법사 닫기</Button> : null}</div>
   {!desktop?.setupApply ? <p role="status" className="text-sm text-status-failed-fg">브라우저 미리보기: 검증은 가능하지만 설정 적용·재시작은 Desktop 앱이 필요해요.</p> : null}
  </Section>
  {unsupported ? <p role="alert">이 데몬은 새 Slack 연결 마법사를 지원하지 않아요. slack-personal 설정을 지원하는 데몬으로 업데이트한 뒤 다시 연결하세요. 설정은 바꾸지 않았어요.</p> : null}
  {run && !unsupported ? <Section title="연결 마법사" description="토큰은 비밀 프롬프트로만 전송되며 대화 기록·브라우저 저장소에 보관하지 않아요. 탭을 떠나면 진행 중 입력은 취소됩니다.">
   {manifest ? <div className="rounded-lg border border-line p-3" data-testid="slack-manifest">
    <div className="flex flex-wrap gap-2"><Button onClick={() => openUrl(manifest.url)}>Slack 앱 만들기</Button><Button onClick={() => void copy(manifest.json)}>매니페스트 복사</Button><Button onClick={() => void copy(manifest.url)}>링크 복사</Button></div>
    <p className="mt-2 text-sm">Install to Workspace → OAuth &amp; Permissions의 Bot User OAuth Token. Basic Information → App-Level Tokens에서 connections:write로 생성. Socket Mode를 켜세요.</p>
    <details><summary className="cursor-pointer text-sm">앱 권한 매니페스트 보기</summary><pre className="selectable max-h-44 overflow-auto text-xs">{manifest.json}</pre></details>
   </div> : null}
   <div aria-live="polite" className="flex flex-col gap-2"><RunLines lines={run.lines.filter(l => l.kind !== "output" || l.text.trim() !== manifest?.url)} /></div>
   {run.prompt && run.prompt.spec.type !== "checklist" ? <PromptView key={run.id + ":" + run.prompt.id} spec={run.prompt.spec} onAnswer={v => void answerPrompt(v)} onCancel={() => void cancelCommand()} /> : null}
   {run.state === "running" && !run.prompt ? <p role="status">데몬 응답·권한 검증을 기다리는 중…</p> : null}
   {run.state === "error" ? <p role="alert">{run.error} · 데몬 지원 버전과 연결을 확인한 뒤 다시 시도하세요.</p> : null}
   {run.state === "cancelled" ? <p role="status">취소했어요. 기존 연결을 해제하지 않았어요.</p> : null}
   {run.state === "done" || applying ? <p role="status" data-testid="slack-apply">{applyLabel(applying, outcome)}</p> : null}
   {run.state === "running" ? <Button onClick={() => void cancelCommand()}>취소</Button> : null}
   <p className="text-xs text-fg-3">권한 누락은 매니페스트 권한을 확인하고 앱을 재설치하세요. 워크스페이스·앱 불일치는 같은 앱의 토큰으로 다시 시도하세요. 사용자 토큰에는 쓰기 권한을 추가하지 마세요.</p>
  </Section> : null}
  <Section title="실행 상태 / 연결 해제" description="설정 저장과 Slack 연결 성공은 다릅니다.">
   <p className="text-sm">현재 데몬 계약은 Desktop용 실시간 Slack 상태 조회·연결 해제 명령을 제공하지 않아요. 연결됨으로 표시하거나 토큰을 임의로 지우지 않습니다. 로컬 대화에서 slack_personal_status로 읽기 모드와 감시 상태를 확인할 수 있어요.</p>
   <Button disabled>연결 해제 (데몬 지원 필요)</Button>
  </Section>
  <SlackMonitorDraft onCopy={copy} />
  {notice ? <p role="status">{notice}</p> : null}
 </div>;
}

function SlackMonitorDraft({onCopy}: {onCopy: (text: string) => Promise<void>}) {
 const [draft, setDraft] = useState<MonitorDraft>({channels:"", summaries:false,timeZone:"Asia/Seoul",quietStart:22,quietEnd:8});
 const [request,setRequest] = useState("");
 const [error,setError] = useState("");
 function prepare(enabled: boolean) {
  try { const next = monitorRequest(draft,enabled); setRequest(next); setError(""); void onCopy(next); }
  catch(e) { setError(e instanceof Error ? e.message : "입력을 확인하세요."); setRequest(""); }
 }
 return <Section title="알림 설정 초안" description="직접 적용 API는 아직 없어요. 요청을 복사해 로컬 대화에 붙여 넣고 도구 실행 결과를 확인하세요. 이 화면에서 저장되거나 활성화되지는 않습니다.">
  <label className="text-sm">채널 / DM ID (최대 5개)<Input aria-label="감시 채널 ID" value={draft.channels} placeholder="C012ABC, D034DEF" onChange={e => setDraft({...draft,channels:e.target.value})} /></label>
  <label className="text-sm">시간대<Input aria-label="알림 시간대" value={draft.timeZone} onChange={e => setDraft({...draft,timeZone:e.target.value})} /></label>
  <div className="flex gap-3"><label className="text-sm">방해 금지 시작<Input aria-label="방해 금지 시작" type="number" min={0} max={23} value={draft.quietStart} onChange={e => setDraft({...draft,quietStart:Number(e.target.value)})} /></label><label className="text-sm">방해 금지 종료<Input aria-label="방해 금지 종료" type="number" min={0} max={23} value={draft.quietEnd} onChange={e => setDraft({...draft,quietEnd:Number(e.target.value)})} /></label></div>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.summaries} onChange={e => setDraft({...draft,summaries:e.target.checked})} />시간별 채널 요약 (최대 10개 메시지 표본)</label>
  <p className="text-xs text-fg-3">멘션·DM 미답변 후보와 명시한 마감 알림은 로컬에만 전달됩니다. 실시간이 아니며 기본 주기에서 100개 스레드 답글 확인은 약 8시간 20분 이상 걸릴 수 있어요. 보존 기간·권한·API 제한이 적용돼요. 시작·종료가 같으면 방해 금지를 사용하지 않아요.</p>
  <div className="flex gap-2"><Button onClick={() => prepare(true)}>알림 설정 요청 복사</Button><Button onClick={() => prepare(false)}>알림 끄기 요청 복사</Button></div>
  {error ? <p role="alert">{error}</p> : null}
  {request ? <pre className="selectable overflow-auto whitespace-pre-wrap text-xs" data-testid="monitor-request">{request}</pre> : null}
 </Section>;
}
