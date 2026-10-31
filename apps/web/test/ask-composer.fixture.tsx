import { createRoot } from "react-dom/client";
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
const setup = (ids: string[], failure = false, expired = false) => {
 calls.length = 0; notices.length = 0; fail = failure;
 session.receive({ type: "patch", key: session.key, side: { ...initial, firstUserText: "Existing thread", run: { startedAt: Date.now(), phase: "thinking", phaseStartedAt: Date.now() }, asks: ids.map(id => ({ id, from: "1", to: "human", kind: "clarification", refs: [], question: "Question " + id, options: ["First", "Second"], default: "First", state: "open", createdAt: Date.now() - 1000, deadlineAt: Date.now() + (expired ? -1000 : 60000) })) } });
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
Object.assign(window, { fixture: { setup, resolve, calls, notices } });
createRoot(document.getElementById("root")!).render(<TooltipProvider><ChatView threadKey={session.key} /></TooltipProvider>);
