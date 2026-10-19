import type { ReactNode } from "react";

export function Section({ title, description, aside, children }: { title: string; description?: ReactNode; aside?: ReactNode; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2.5">
			<div className="flex items-end gap-3">
				<div className="min-w-0 flex-1">
					<h3 className="text-md font-semibold text-fg">{title}</h3>
					{description ? <p className="mt-0.5 text-xs text-fg-3">{description}</p> : null}
				</div>
				{aside}
			</div>
			{children}
		</section>
	);
}

export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
	return (
		<div className="flex items-center gap-4 py-2.5">
			<div className="min-w-0 flex-1">
				<div className="text-sm text-fg">{label}</div>
				{hint ? <div className="mt-0.5 text-xs text-fg-3">{hint}</div> : null}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}
