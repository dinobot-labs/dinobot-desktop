import { Button, Dino, formatClock, formatTokens, Kbd, Shimmer } from "@dinobot/ui";
import { IconPlayerStopFilled } from "@tabler/icons-react";
import { useNow } from "../lib/hooks.ts";
import type { RunState } from "./model.ts";
import type { SideState } from "./protocol.ts";

/** Whole phrases per tool, so each language can order tool and verb its own way. */
const TOOL_PHASE: Record<string, string> = { bash: "bash 실행 중", shell: "shell 실행 중", read: "read 읽기 중", write: "write 쓰기 중", edit: "edit 수정 중", codemode: "codemode 스크립트 실행 중", web_search: "web_search 웹 검색 중", web_fetch: "web_fetch 페이지 가져오기 중" };

function label(run: RunState, side: SideState): string {
	switch (run.phase) {
		case "waiting_response":
			return "응답을 기다리는 중";
		case "thinking":
			return "생각하는 중";
		case "responding":
			return "답하는 중";
		case "tool":
			return run.tool === "todo_write" ? "Todo 정리하는 중" : (TOOL_PHASE[run.tool ?? ""] ?? `${run.tool ?? "도구"} 실행 중`);
		case "waiting_subagents": {
			const n = side.subagents.filter((s) => s.status === "running").length;
			return `서브에이전트 ${n || ""}${n ? "개" : ""} 기다리는 중`;
		}
		case "compacting":
			return "컨텍스트 압축 중";
		case "retry":
			return "다시 시도하는 중";
	}
}

/**
 * Turn status (TUI T144/T145): phase label with its own timer, turn time, context tokens, last call speed and cache
 * hit ratio, and Stop (Esc). Timers tick once a second; nothing renders when idle.
 */
export function StatusLine({ run, side, onStop, readOnly }: { run: RunState | undefined; side: SideState; onStop: () => void; readOnly: boolean }) {
	const now = useNow(Boolean(run), 1000);
	if (!run) return null;
	return (
		<div className="flex min-w-0 items-center gap-2.5 px-1 text-sm" role="status" aria-live="polite" data-testid="status-line">
			<Dino state={run.phase === "thinking" || run.phase === "waiting_response" ? "thinking" : "running"} size={30} shape="pixel" />
			<Shimmer className={run.phase === "retry" ? "font-medium text-status-failed-fg" : run.phase === "tool" ? "font-medium text-status-running-fg" : "font-medium text-fg-2"}>{label(run, side)}</Shimmer>
			<span className="shrink-0 font-mono text-micro text-fg-3">{formatClock(now - run.phaseStartedAt)}</span>
			{run.retry ? <span className="min-w-0 truncate text-xs text-status-failed-fg">{run.retry}</span> : null}
			<span className="flex-1" />
			<span className="hidden shrink-0 items-center gap-2.5 font-mono text-micro text-fg-3 md:flex" data-testid="turn-metrics">
				{run.attached ? null : <span title="이번 차례 경과">⏱ {formatClock(now - run.startedAt)}</span>}
				{side.usage.contextTokens ? <span title="컨텍스트 토큰">↑{formatTokens(side.usage.contextTokens)}</span> : null}
				{side.call.tps ? <span title="최근 호출 출력 속도">{side.call.tps < 10 ? side.call.tps.toFixed(1) : Math.round(side.call.tps)} tok/s</span> : null}
				{side.call.cacheRatio !== undefined ? <span title="프롬프트 캐시 적중">cache {Math.round(side.call.cacheRatio * 100)}%</span> : null}
			</span>
			{!readOnly ? (
				<Button variant="ghost" size="xs" onClick={onStop} aria-label="중지">
					<IconPlayerStopFilled /> 중지 <Kbd>Esc</Kbd>
				</Button>
			) : null}
		</div>
	);
}
