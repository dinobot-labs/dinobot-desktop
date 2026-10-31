import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AskCard, Composer as SharedComposer, TooltipProvider } from "@dinobot/ui";
import { Composer } from "../../src/chat/Composer.tsx";
import { AskBar } from "../../src/chat/AskBar.tsx";
import { Hints } from "../../src/chat/WorkDeck.tsx";
import { useSettings } from "../../src/lib/settings.ts";
import { useThemeSync } from "../../src/lib/theme.ts";
import "../../src/styles.css";

const query = new URLSearchParams(location.search);
const busy = query.get("busy") === "true";
const overflow = query.has("overflow");
const theme = query.get("theme") as "dos-blue" | "dos-black" | "light";
useSettings.setState({ theme, showHints: true });
const options = [
 "기존 사진 첨부와 질문 카드 배치를 유지하면서 긴 한국어 선택지는 카드 안에서 여러 줄로 표시하고 입력창과 버튼이 겹치지 않도록 수정해 주세요.",
 "사진 미리보기와 삭제 버튼을 입력 영역 안에 배치하고 기본값 설명이 길어져도 모든 선택지를 끝까지 읽고 직접 답변할 수 있도록 해 주세요.",
 "공백없는아주긴한국어선택지".repeat(12) + "UnbrokenOption".repeat(12),
];
const question = "사진 첨부와 질문 카드가 화면 밖으로 나가지 않도록 어떤 방식으로 정리할까요? " + options[2];
const calls = { sent: [] as string[], payloads: [] as {images: string[]; files: string[]}[], stopped: 0, commands: [] as string[], choices: [] as number[], sharedChoices: [] as number[], answers: [] as string[] };
Object.assign(window, { composerLayout: calls });
function Fixture() {
 useThemeSync();
 const [hasText, setHasText] = useState(false);
 return <TooltipProvider><main style={{padding: 16, height: "100%", overflow: "auto"}}>
  {overflow && <section data-testid="asks" style={{marginBottom: 16}}>
   <AskBar asks={[{id:"overflow",to:"human",kind:"clarification",question,from:"fixture",state:"open",default:options[0]!,options,deadlineAt:Date.now()+600000}]}
    onChoose={async (_ask,index) => {calls.choices.push(index);}} onAnswer={async (_ask,text) => {calls.answers.push(text);}}/>
   <div style={{marginTop:16}}><AskCard question={question} options={options} onChoose={(_option,index) => calls.sharedChoices.push(index)}/></div>
  </section>}
  <section data-testid="desktop-composer">
   <Composer busy={busy} hasQueue={false} threadKey="layout-fixture"
    model={{model:"openai-codex/gpt-5.4",thinkingLevel:"xhigh",supportedThinkingLevels:["low","high","xhigh"],fast:true,fastSupported:true,contextWindow:272000}}
    usage={{contextTokens:149600,sent:149000,output:600}}
    onSend={async (text,images,files) => {calls.sent.push(text);calls.payloads.push({images:images.map(image=>image.name),files:files.map(file=>file.name)});return true;}}
    onCommand={(name,args) => {calls.commands.push(name+":"+args);}}
    onStop={() => {calls.stopped++;}} onSendQueueNow={() => {}}
    onRecallQueued={async () => null} onError={message => {throw new Error(message);}}
    onDraftChange={setHasText}/>
   <div style={{marginTop: 12}}><Hints busy={busy} hasText={hasText} hasQueue={false}/></div>
  </section>
  <section data-testid="shared-composer" style={{marginTop:48}}>
   <SharedComposer busy={busy} footer="공유 입력창" onSubmit={text => calls.sent.push(text)} onStop={() => {calls.stopped++;}} />
  </section>
 </main></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
