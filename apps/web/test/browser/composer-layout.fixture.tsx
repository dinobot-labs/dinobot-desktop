import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Composer as SharedComposer, TooltipProvider } from "@dinobot/ui";
import { Composer } from "../../src/chat/Composer.tsx";
import { Hints } from "../../src/chat/WorkDeck.tsx";
import { useSettings } from "../../src/lib/settings.ts";
import { useThemeSync } from "../../src/lib/theme.ts";
import "../../src/styles.css";

const query = new URLSearchParams(location.search);
const busy = query.get("busy") === "true";
const theme = query.get("theme") as "dos-blue" | "dos-black" | "light";
useSettings.setState({ theme, showHints: true });
const calls = { sent: [] as string[], stopped: 0, commands: [] as string[] };
Object.assign(window, { composerLayout: calls });
function Fixture() {
 useThemeSync();
 const [hasText, setHasText] = useState(false);
 return <TooltipProvider><main style={{padding: 16}}>
  <section data-testid="desktop-composer">
   <Composer busy={busy} hasQueue={false} threadKey="layout-fixture"
    model={{model:"openai-codex/gpt-5.4",thinkingLevel:"xhigh",supportedThinkingLevels:["low","high","xhigh"],fast:true,fastSupported:true,contextWindow:272000}}
    usage={{contextTokens:149600,sent:149000,output:600}}
    onSend={async text => {calls.sent.push(text);return true;}}
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
