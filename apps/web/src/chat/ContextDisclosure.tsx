import { IconChevronRight, IconNotes } from "@tabler/icons-react";
import { useId, useState, type ReactNode } from "react";

/** Local disclosure state; historical context is never fetched or mutated here. */
export function ContextDisclosure({ label, children, testId }: { label: ReactNode; children: ReactNode; testId: string }) {
	const [open, setOpen] = useState(false);
	const panel = useId();
	return <div className="min-w-0 text-sm text-fg-2" data-testid={testId}>
		<button id={`${panel}-toggle`} type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(value => !value)}
			className="flex min-h-8 max-w-full cursor-pointer items-center gap-2 rounded-sm px-1 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent-deep">
			<IconNotes size={16} stroke={1.5} aria-hidden="true" className="shrink-0" />
			<span className="min-w-0 break-words">{label}</span>
			<IconChevronRight size={14} stroke={1.5} aria-hidden="true" className={open ? "shrink-0 rotate-90" : "shrink-0"} />
		</button>
		<div id={panel} hidden={!open} tabIndex={open ? 0 : -1} role="region" aria-labelledby={`${panel}-toggle`} className="ml-3 mt-1 max-h-[min(16rem,40vh)] overflow-y-auto border-l border-line pl-5 focus-visible:outline-2 focus-visible:outline-accent-deep">{children}</div>
	</div>;
}
