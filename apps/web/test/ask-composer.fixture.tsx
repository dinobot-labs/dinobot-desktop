import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { useSettings } from "../src/lib/settings.ts";
import { useThemeSync } from "../src/lib/theme.ts";
import { TooltipProvider } from "@dinobot/ui";
import { ChatView } from "../src/chat/ChatView.tsx";
import { sessionFor } from "../src/state/app.ts";
import { api } from "../src/lib/api.ts";
import type { SendMessageRequest } from "@dinobot/contracts";
import { createChatData, ingestEntry } from "../src/chat/model.ts";

const session = sessionFor("tui:ask-regression");
session.start = () => {};
const calls: SendMessageRequest[] = [];
const notices: string[] = [];
session.notice = (text) => { notices.push(text); };
let fail = false;
api.send = async (_key, body) => {
 calls.push(body);
 if (fail) throw new Error("fixture send failed");
 return { submissionId: calls.length };
};
const initial = session.side;
const transcript = Array.from({length: 8}, (_, i) => ({ id: "history-" + i, version: 1, kind: "user" as const, at: Date.now(), text: "기존 대화의 사진과 설명을 확인해 주세요. ".repeat(8) }));
const setup = (ids: string[], failure = false, expired = false) => {
 calls.length = 0; notices.length = 0; fail = failure;
 session.receive({ type: "patch", key: session.key, order: transcript.map(b => b.id), blocks: transcript, side: { ...initial, snapshots: 1, total: transcript.length, firstUserText: "Existing thread", run: { startedAt: Date.now(), phase: "thinking", phaseStartedAt: Date.now() }, asks: ids.map(id => ({ id, from: "1", to: "human", kind: "clarification", refs: [], question: "Question " + id, options: ["First", "Second"], default: "First", state: "open", createdAt: Date.now() - 1000, deadlineAt: Date.now() + (expired ? -1000 : 60000) })) } });
};
// Replay the acknowledged outgoing message through the real transcript reducer,
// as the worker does; no fake answer state or model response is injected.
const resolve = () => {
 const data = createChatData();
 for (const ask of session.side.asks) data.asks.set(ask.id, ask);
 const body = calls.at(-1)!;
 ingestEntry(data, { id: 1, conversationId: 1, kind: "pi.user", model: [{ role: "user", content: `<from user="local" channel="tui"/>\n${body.text}`, timestamp: Date.now() }] }, Date.now());
 session.receive({ type: "patch", key: session.key, side: { ...session.side, asks: [...data.asks.values()] } });
};
const setupLong = () => {
 setup(["long-question"]);
 const options = [
  "기존 사진 첨부와 질문 카드 배치를 유지하면서 긴 한국어 선택지는 카드 안에서 여러 줄로 표시하고 입력창과 버튼이 겹치지 않도록 수정해 주세요.",
  "사진 미리보기와 삭제 버튼을 입력 영역 안에 배치하고 기본값 설명이 길어져도 모든 선택지를 끝까지 읽고 직접 답변할 수 있도록 해 주세요.",
  "공백없는아주긴한국어선택지".repeat(12) + "UnbrokenOption".repeat(12),
 ];
 session.receive({ type: "patch", key: session.key, side: { ...session.side, asks: [{ ...session.side.asks[0]!, deadlineAt: Date.now() + 600000, question: "사진 첨부와 질문 카드가 화면 밖으로 나가지 않도록 어떤 방식으로 정리할까요? " + options[2], options, default: options[0]! }] } });
};
useSettings.setState({ theme: (new URLSearchParams(location.search).get("theme") ?? "light") as "light" | "dos-blue" | "dos-black", showHints: true });
Object.assign(window, { fixture: { setup, setupLong, resolve, calls, notices } });
function Fixture() {
 useThemeSync();
 // App shell height/flex constraints, with side panels omitted so width is the chat pane width.
 return <TooltipProvider><div className="flex h-full flex-col bg-bg text-fg">
  <header className="h-10 shrink-0" aria-label="App chrome" />
  <div className="flex min-h-0 flex-1"><main className="flex min-w-0 flex-1 flex-col">
   <ChatView threadKey={session.key} />
  </main></div>
 </div></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
