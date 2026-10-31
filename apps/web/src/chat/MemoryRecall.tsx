import { IconChevronRight, IconNotes } from "@tabler/icons-react";
import { useId, useState } from "react";
import type { RecalledMemory } from "./recall.ts";

/** Disclosure state belongs to this mounted row, not the transcript or memory store. */
export function MemoryRecall({ items }: { items: readonly RecalledMemory[] }) {
	const [open, setOpen] = useState(false);
	const panel = useId();
	return (
		<div className="text-sm text-fg-2" data-testid="memory-recall">
			<button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((value) => !value)}
				className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-1 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent-deep">
				<IconNotes size={16} stroke={1.5} aria-hidden="true" className="shrink-0" />
				<span>전달된 기억 {items.length}개</span>
				<IconChevronRight size={14} stroke={1.5} aria-hidden="true" className={open ? "rotate-90" : ""} />
			</button>
			<div id={panel} hidden={!open} className="ml-3 mt-1 border-l border-line pl-5">
				{items.length ? <ul className="space-y-3 py-2">{items.map((item, index) => (
					<li key={index} className="min-w-0">
						<p className="selectable whitespace-pre-wrap break-words text-fg">{item.content ?? "이 기록에는 전달 당시의 기억 내용이 없어요."}</p>
						{item.scope ? <p className="mt-1 text-xs text-fg-3">프로젝트 기억{item.saved ? <span> · 저장 {item.saved}</span> : null}</p> : null}
					</li>
				))}</ul> : <p className="py-2 text-fg-3">전달된 기억이 없어요.</p>}
			</div>
		</div>
	);
}
