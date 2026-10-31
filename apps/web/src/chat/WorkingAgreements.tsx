import { ContextDisclosure } from "./ContextDisclosure.tsx";

/** Exact request-time section, including an explicit removal (null). */
export function WorkingAgreements({ section }: { section: string | null }) {
	const count = section?.split("\n").filter(row => row.startsWith("- [")).length ?? 0;
	const label = section === null || section.trim() === "" ? "전달된 작업 약속 없음" : count ? `전달된 작업 약속 ${count}개` : "전달된 작업 약속";
	return <ContextDisclosure testId="working-agreements" label={label}>
		<p className="py-2">이 요청에 전달된 작업 지침이에요. 실제 준수 여부를 뜻하지는 않아요.</p>
		{section?.trim() ? <p className="selectable whitespace-pre-wrap break-words pb-2 text-fg">{section}</p> : <p className="pb-2">전달된 작업 약속이 없어요.</p>}
	</ContextDisclosure>;
}
