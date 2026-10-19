import { IconX } from "@tabler/icons-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { cn } from "../lib/cn.ts";
import { StatusMark } from "./status.tsx";

export interface ToastItem {
	id: number;
	tone: "info" | "success" | "error" | "waiting";
	title: ReactNode;
	body?: ReactNode;
	actions?: ReactNode;
	/** ms; 0 keeps it until dismissed. */
	duration: number;
}

let items: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const emit = () => {
	for (const l of listeners) l();
};

/** Show a toast; returns a dismiss function. Safe to call from anywhere (no React context needed). */
export function toast(input: Omit<ToastItem, "id" | "duration" | "tone"> & { tone?: ToastItem["tone"]; duration?: number }): () => void {
	const id = ++nextId;
	const item: ToastItem = { id, tone: input.tone ?? "info", duration: input.duration ?? 5000, title: input.title, ...(input.body ? { body: input.body } : {}), ...(input.actions ? { actions: input.actions } : {}) };
	items = [...items.slice(-4), item];
	emit();
	const dismiss = () => {
		items = items.filter((t) => t.id !== id);
		emit();
	};
	if (item.duration > 0) setTimeout(dismiss, item.duration);
	return dismiss;
}

export function dismissToast(id: number) {
	items = items.filter((t) => t.id !== id);
	emit();
}

/** The toast stack (bottom right). Mount once. */
export function Toaster() {
	const list = useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => items,
	);
	return (
		<div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" data-slot="toaster">
			{list.map((t) => (
				<div key={t.id} role="status" className="dn-enter pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-float">
					<StatusMark kind={t.tone === "error" ? "failed" : t.tone === "success" ? "done" : t.tone === "waiting" ? "waiting" : "ready"} size={15} className={cn("mt-0.5", t.tone === "info" && "text-fg-3")} />
					<div className="min-w-0 flex-1">
						<div className="text-sm text-fg">{t.title}</div>
						{t.body ? <div className="mt-0.5 text-xs text-fg-3">{t.body}</div> : null}
						{t.actions ? <div className="mt-2 flex flex-wrap gap-1.5">{t.actions}</div> : null}
					</div>
					<button type="button" aria-label="닫기" onClick={() => dismissToast(t.id)} className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-3 hover:bg-hover hover:text-fg">
						<IconX size={14} />
					</button>
				</div>
			))}
		</div>
	);
}
