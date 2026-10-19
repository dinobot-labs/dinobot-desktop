import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";
import { Button } from "./button.tsx";
import { Kbd } from "./kbd.tsx";

export interface PickerOption {
	id: string;
	label: ReactNode;
	/** Text used by the filter (defaults to label when it is a string). */
	text?: string;
	description?: ReactNode;
	group?: string;
	current?: boolean;
	badge?: ReactNode;
	tag?: ReactNode;
	disabled?: boolean;
	checked?: boolean;
	icon?: ReactNode;
}

export interface PickerProps {
	open: boolean;
	title: ReactNode;
	header?: ReactNode;
	options: PickerOption[];
	mode?: "select" | "checklist";
	placeholder?: string;
	/** select: the chosen id; checklist: the checked ids in option order (disabled-but-checked included). */
	onChoose: (ids: string[]) => void;
	onCancel: () => void;
	footer?: ReactNode;
	loading?: boolean;
	emptyText?: string;
}

/**
 * The shared picker (TUI select/checklist modal): always-on filter with "N of M", gray group headers, current
 * marker, badges and tags, disabled rows skipped by the keyboard, Enter to choose (or apply), Space to toggle in
 * checklist mode, Esc to cancel. Every select/checklist prompt of the daemon renders through this.
 */
export function Picker({ open, title, header, options, mode = "select", placeholder, onChoose, onCancel, footer, loading, emptyText = "찾는 항목이 없어요" }: PickerProps) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [checked, setChecked] = useState<Set<string>>(() => new Set());
	const list = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setChecked(new Set(options.filter((o) => o.checked).map((o) => o.id)));
		const current = options.findIndex((o) => o.current && !o.disabled);
		setActive(current >= 0 ? current : Math.max(0, options.findIndex((o) => !o.disabled)));
	}, [open, options]);

	const q = query.trim().toLowerCase();
	const filtered = useMemo(
		() => (q ? options.filter((o) => `${o.text ?? (typeof o.label === "string" ? o.label : "")} ${typeof o.description === "string" ? o.description : ""} ${o.group ?? ""} ${o.id}`.toLowerCase().includes(q)) : options),
		[options, q],
	);
	const index = Math.min(active, Math.max(0, filtered.length - 1));

	useEffect(() => {
		list.current?.querySelector(`[data-row="${index}"]`)?.scrollIntoView({ block: "nearest" });
	}, [index]);

	const move = (delta: number) => {
		if (!filtered.length) return;
		let i = index;
		for (let n = 0; n < filtered.length; n++) {
			i = (i + delta + filtered.length) % filtered.length;
			if (!filtered[i]?.disabled) break;
		}
		setActive(i);
	};
	const toggle = (o: PickerOption) => {
		if (o.disabled) return;
		setChecked((c) => {
			const next = new Set(c);
			if (next.has(o.id)) next.delete(o.id);
			else next.add(o.id);
			return next;
		});
	};
	const apply = () => onChoose(options.filter((o) => checked.has(o.id)).map((o) => o.id));
	const choose = (o: PickerOption | undefined) => {
		if (!o || o.disabled) return;
		if (mode === "checklist") toggle(o);
		else onChoose([o.id]);
	};
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.nativeEvent.isComposing) return;
		if (e.key === "ArrowDown") (e.preventDefault(), move(1));
		else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
		else if (e.key === "PageDown") (e.preventDefault(), move(8));
		else if (e.key === "PageUp") (e.preventDefault(), move(-8));
		else if (e.key === "Home" && !query) (e.preventDefault(), setActive(0));
		else if (e.key === "End" && !query) (e.preventDefault(), setActive(filtered.length - 1));
		else if (e.key === " " && mode === "checklist" && !query) (e.preventDefault(), toggle(filtered[index] as PickerOption));
		else if (e.key === "Enter") {
			e.preventDefault();
			if (mode === "checklist") apply();
			else choose(filtered[index]);
		}
	};

	let lastGroup: string | undefined;
	return (
		<DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onCancel()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-scrim transition-opacity duration-(--dur-state) data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<DialogPrimitive.Popup
					data-slot="picker"
					className="fixed top-[12vh] left-1/2 z-50 flex max-h-[72vh] w-[min(92vw,600px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line bg-surface text-fg shadow-pop outline-none transition-[opacity,transform] duration-(--dur-enter) ease-(--motion-out) data-ending-style:-translate-y-1 data-ending-style:opacity-0 data-starting-style:-translate-y-1 data-starting-style:opacity-0"
				>
					<div className="px-4 pt-3.5 pb-2">
						<DialogPrimitive.Title className="text-md font-semibold">{title}</DialogPrimitive.Title>
						{header ? <div className="mt-0.5 text-sm whitespace-pre-wrap text-fg-3">{header}</div> : null}
					</div>
					<div className="mx-3 mb-1 flex items-center gap-2 rounded-md border border-line-strong px-2.5 focus-within:border-focus">
						<IconSearch size={14} className="shrink-0 text-fg-3" />
						<input
							autoFocus
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setActive(0);
							}}
							onKeyDown={onKeyDown}
							placeholder={placeholder ?? "입력해서 찾기"}
							aria-label="필터"
							className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
						/>
						<span className="shrink-0 font-mono text-micro text-fg-3">
							{filtered.length} / {options.length}
						</span>
					</div>
					<div ref={list} role="listbox" aria-multiselectable={mode === "checklist"} className="min-h-0 flex-1 overflow-y-auto p-1.5">
						{loading ? <div className="px-3 py-6 text-center text-sm text-fg-3">불러오는 중…</div> : null}
						{!loading && filtered.length === 0 ? <div className="px-3 py-6 text-center text-sm text-fg-3">{emptyText}</div> : null}
						{filtered.map((o, i) => {
							const header = o.group && o.group !== lastGroup ? o.group : null;
							lastGroup = o.group;
							const on = checked.has(o.id);
							return (
								<div key={o.id}>
									{header ? <div className="px-2.5 pt-2.5 pb-1 font-mono text-micro uppercase tracking-[var(--tr-label)] text-fg-3">{header}</div> : null}
									<button
										type="button"
										role="option"
										aria-selected={i === index}
										aria-checked={mode === "checklist" ? on : undefined}
										aria-disabled={o.disabled}
										data-row={i}
										onMouseMove={() => !o.disabled && setActive(i)}
										onClick={() => choose(o)}
										className={cn(
											"flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm",
											i === index && !o.disabled && "bg-hover",
											o.disabled && "cursor-not-allowed opacity-45",
										)}
									>
										{mode === "checklist" ? (
											<span className={cn("flex size-4 shrink-0 items-center justify-center rounded-xs border", on ? "border-inverse bg-inverse text-fg-inverse" : "border-line-ui")}>
												{on ? <IconCheck size={12} stroke={3} /> : null}
											</span>
										) : o.current ? (
											<span className="size-1.5 shrink-0 rounded-full bg-status-success" />
										) : (
											<span className="size-1.5 shrink-0" />
										)}
										{o.icon ? <span className="shrink-0 text-fg-3 [&_svg]:size-4">{o.icon}</span> : null}
										<span className="min-w-0 flex-1">
											<span className="block truncate text-fg">{o.label}</span>
											{o.description ? <span className="block truncate text-xs text-fg-3">{o.description}</span> : null}
										</span>
										{o.current ? <span className="shrink-0 rounded-xs bg-accent-tint px-1 text-micro text-accent-deep">현재</span> : null}
										{o.badge ? <span className="shrink-0 rounded-xs bg-status-success-tint px-1 text-micro text-status-success-fg">{o.badge}</span> : null}
										{o.tag ? <span className="shrink-0 text-micro text-fg-3">{o.tag}</span> : null}
									</button>
								</div>
							);
						})}
					</div>
					<div className="flex items-center gap-2 border-t border-line px-3 py-2">
						<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-micro text-fg-3">
							<Kbd>↑↓</Kbd> 이동 {mode === "checklist" ? <><Kbd>Space</Kbd> 선택 <Kbd>Enter</Kbd> 적용</> : <><Kbd>Enter</Kbd> 고르기</>} <Kbd>Esc</Kbd> 닫기
							{mode === "checklist" ? <span>· {checked.size}/{options.length} 선택</span> : null}
							{footer}
						</div>
						{mode === "checklist" ? (
							<>
								<Button size="sm" variant="ghost" onClick={onCancel}>
									취소
								</Button>
								<Button size="sm" variant="primary" onClick={apply}>
									적용
								</Button>
							</>
						) : null}
					</div>
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
