import type { RecalledMemory } from "./recall.ts";
import { ContextDisclosure } from "./ContextDisclosure.tsx";

export function MemoryRecall({ items }: { items: readonly RecalledMemory[] }) {
	return <ContextDisclosure testId="memory-recall" label={<>전달된 기억 {items.length}개</>}>
		{items.length ? <ul className="space-y-3 py-2">{items.map((item, index) => (
			<li key={index} className="min-w-0">
				<p className="selectable whitespace-pre-wrap break-words text-fg">{item.content ?? "이 기록에는 전달 당시의 기억 내용이 없어요."}</p>
				{item.scope ? <p className="mt-1 text-xs text-fg-3">프로젝트 기억{item.saved ? <span> · 저장 {item.saved}</span> : null}</p> : null}
			</li>
		))}</ul> : <p className="py-2 text-fg-3">전달된 기억이 없어요.</p>}
	</ContextDisclosure>;
}
