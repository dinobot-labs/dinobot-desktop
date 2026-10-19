import { Button, Input } from "@dinobot/ui";
import { IconArrowLeft, IconArrowRight, IconPlus, IconRefresh, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { BrowserUiAction } from "../../../desktop/src/browser-types.ts";
import { browserAvailable, browserClient } from "./browser-client.ts";
import type { BrowserInput } from "./browser-input.ts";
import { BrowserFrame } from "./BrowserFrame.tsx";
import { useBrowserMirror } from "./use-browser-mirror.ts";

export function BrowserPanel() {
	const { state, frame, error, accept, invalidate } = useBrowserMirror();
	const [address, setAddress] = useState("");
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const busyRef = useRef(false);
	const live = useRef(true);
	const inputAllowed = useRef(false);
	const inputEpoch = useRef(0);
	const identity = `${state?.connected}:${state?.control}:${state?.current}:${state?.url}:${state?.width}:${state?.height}`;
	const previousIdentity = useRef(identity);
	const user = state?.control === "user";
	const canInput = !!(user && state?.connected && frame && !busy && !state.dialog);
	if (previousIdentity.current !== identity) { inputEpoch.current++; previousIdentity.current = identity; }
	inputAllowed.current = canInput;
	useEffect(() => {
		live.current = true;
		const hidden = () => { if (document.visibilityState === "hidden") inputEpoch.current++; };
		document.addEventListener("visibilitychange", hidden);
		return () => { live.current = false; inputAllowed.current = false; inputEpoch.current++; document.removeEventListener("visibilitychange", hidden); };
	}, []);
	useEffect(() => { setAddress(state?.url ?? ""); }, [state?.url]);
	useEffect(() => { setPrompt(""); }, [state?.dialog?.message, state?.dialog?.type]);
	const command = async (action: BrowserUiAction, args?: Record<string, unknown>) => {
		if (busyRef.current || !browserAvailable) return;
		busyRef.current = true;
		inputAllowed.current = false;
		setBusy(true); setMessage("");
		if (action !== "takeover" && action !== "resume") invalidate();
		try {
			const reply = await browserClient.request(action, args);
			if (live.current) accept(reply);
		} catch (error) {
			if (live.current) setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			busyRef.current = false;
			if (live.current) setBusy(false);
		}
	};
	const send = (input: BrowserInput) => {
		if (!inputAllowed.current || busyRef.current) return;
		if (input.kind === "text" && input.text.length > 10_000) { setMessage("한 번에 10,000자까지 입력할 수 있어요. 나눠서 붙여 넣어 주세요."); return; }
		const epoch = inputEpoch.current;
		void browserClient.transaction(async (call) => {
			// Earlier accepted input drains before a queued navigation or handback; never discard typed text merely because a button became busy.
			if (!live.current || inputEpoch.current !== epoch || document.visibilityState === "hidden") return;
			const reply = await call("input", { ...input });
			if (live.current) accept(reply);
		}).catch((error: unknown) => {
			if (live.current) { setMessage(error instanceof Error ? error.message : String(error)); invalidate(); }
		});
	};
	if (!browserAvailable) return <div className="p-4 text-sm text-fg-3" data-testid="browser-unavailable">브라우저 연결은 최신 데스크톱 앱에서 사용할 수 있어요.</div>;
	return (
		<section className="flex min-h-0 flex-1 flex-col" aria-label="Chrome 브라우저 화면" data-testid="browser-panel">
			<div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
				<span className="min-w-0 flex-1 text-xs text-fg-3">실제 Chrome 화면 · {user ? "직접 조작 중" : "에이전트 조작 중"}</span>
				<Button size="sm" disabled={busy} data-testid="browser-control" onClick={() => void command(user ? "resume" : "takeover")}>{user ? "에이전트에게 넘기기" : "직접 조작"}</Button>
			</div>
			<div className="flex items-center gap-1 border-b border-line p-2">
				<Button size="sm" variant="ghost" aria-label="뒤로" title="뒤로" disabled={!user || !state?.connected || busy} onClick={() => void command("back")}><IconArrowLeft size={14} /></Button>
				<Button size="sm" variant="ghost" aria-label="앞으로" title="앞으로" disabled={!user || !state?.connected || busy} onClick={() => void command("forward")}><IconArrowRight size={14} /></Button>
				<Button size="sm" variant="ghost" aria-label="브라우저 새로고침" title="브라우저 새로고침" disabled={!user || !state?.connected || busy} onClick={() => void command("reload")}><IconRefresh size={14} /></Button>
				<form className="flex min-w-0 flex-1 gap-1" onSubmit={(e) => { e.preventDefault(); if (user && address.trim()) void command("open", { url: address.trim() }); }}>
					<Input aria-label="브라우저 주소" placeholder="https://example.com" value={address} disabled={!user || busy} onChange={(e) => setAddress(e.target.value)} className="font-mono text-xs" />
					<Button size="sm" disabled={!user || busy || !address.trim()} type="submit">이동</Button>
				</form>
			</div>
			{state?.tabs.some((tab) => tab.owned) ? <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2" aria-label="에이전트 브라우저 탭">
				{state.tabs.filter((tab) => tab.owned).map((tab) => <div key={tab.index} className="flex min-w-0 shrink-0 items-center rounded-md border border-line">
					<button type="button" aria-current={state.current === tab.index ? "page" : undefined} disabled={!user || busy} title={tab.url} className="max-w-36 truncate px-2 py-1 text-xs text-fg-2 hover:bg-hover aria-[current=page]:bg-hover disabled:cursor-default" onClick={() => void command("tab", { index: tab.index })}>{tab.title || tab.url || "새 탭"}</button>
					<button type="button" aria-label="브라우저 탭 닫기" disabled={!user || busy} className="p-1 text-fg-3 hover:text-fg disabled:opacity-40" onClick={() => void command("close_tab", { index: tab.index })}><IconX size={12} /></button>
				</div>)}
				<Button size="sm" variant="ghost" aria-label="새 탭" title="새 탭" disabled={!user || busy} onClick={() => void command("open", { url: "about:blank", newTab: true })}><IconPlus size={14} /></Button>
			</div> : null}
			{message || error ? <p role="alert" className="break-words border-b border-line px-3 py-2 text-xs text-status-failed-fg">{message || error}</p> : null}
			{state?.dialog ? <div className="flex shrink-0 flex-col gap-2 border-b border-line bg-hover p-3" data-testid="browser-dialog">
				<p className="text-xs text-fg-3">페이지 대화상자</p><p className="selectable break-words text-sm text-fg">{state.dialog.message}</p>
				{state.dialog.type === "prompt" ? <Input aria-label="페이지 대화상자 입력" value={prompt} disabled={!user || busy} onChange={(e) => setPrompt(e.target.value)} /> : null}
				<div className="flex gap-2"><Button size="sm" disabled={!user || busy} onClick={() => void command("dialog", { accept: true, ...(state.dialog?.type === "prompt" ? { promptText: prompt } : {}) })}>확인</Button><Button size="sm" variant="ghost" disabled={!user || busy} onClick={() => void command("dialog", { accept: false })}>취소</Button></div>
			</div> : null}
			{frame && state?.connected ? <BrowserFrame frame={frame} enabled={canInput} send={send} /> : <div className="flex min-h-48 flex-1 items-center justify-center p-5 text-center text-sm text-fg-3">{state?.connected ? "Chrome 화면을 불러오는 중…" : "연결된 Chrome 화면이 없어요. 직접 조작을 누른 뒤 주소를 입력해 주세요."}</div>}
			<p className="shrink-0 border-t border-line px-3 py-2 text-micro text-fg-3">{user ? "화면을 클릭한 뒤 입력하세요. 붙여넣기도 가능해요. Esc를 누르면 키보드 입력에서 나와요." : "같은 Chrome을 에이전트와 함께 봐요. 직접 조작 중에는 에이전트가 브라우저를 조작할 수 없어요."}</p>
		</section>
	);
}
