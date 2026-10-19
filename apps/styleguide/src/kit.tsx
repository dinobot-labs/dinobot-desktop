import { cn } from "@dinobot/ui";
import { type ReactNode, useEffect, useState } from "react";

export function Section({ id, eyebrow, title, lede, children }: { id: string; eyebrow: string; title: string; lede?: ReactNode; children: ReactNode }) {
	return (
		<section id={id} className="scroll-mt-6 border-t border-line pt-12 pb-16 first:border-t-0 first:pt-0">
			<div className="mb-8 max-w-2xl">
				<div className="font-mono text-micro uppercase tracking-[var(--tr-label)] text-accent-deep">{eyebrow}</div>
				<h2 className="mt-1.5 text-2xl font-semibold tracking-[var(--tr-title)] text-fg">{title}</h2>
				{lede ? <p className="mt-2 text-md text-fg-2">{lede}</p> : null}
			</div>
			<div className="flex flex-col gap-10">{children}</div>
		</section>
	);
}

export function Block({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
	return (
		<div className={className}>
			<div className="mb-3 flex items-baseline gap-3">
				<h3 className="text-md font-semibold text-fg">{title}</h3>
				{note ? <span className="text-xs text-fg-3">{note}</span> : null}
			</div>
			{children}
		</div>
	);
}

export function Stage({ children, className, dots = false }: { children: ReactNode; className?: string; dots?: boolean }) {
	return <div className={cn("rounded-lg border border-line bg-surface p-5", dots && "dot-paper bg-bg", className)}>{children}</div>;
}

export function Caption({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("font-mono text-micro text-fg-3", className)}>{children}</div>;
}

/** A clock for live fixtures: ticks every second (paused under reduced motion is not needed; it only changes text). */
export function useNow(interval = 1000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), interval);
		return () => clearInterval(id);
	}, [interval]);
	return now;
}
