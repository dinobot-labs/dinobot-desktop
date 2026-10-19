import { IconArrowUp, IconPaperclip, IconPlayerStopFilled } from "@tabler/icons-react";
import { type FormEvent, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../button.tsx";
import { Kbd } from "../kbd.tsx";

/**
 * The message box. While a turn streams, the send button becomes stop and a scan line runs along the bottom
 * edge of the frame. Enter sends, Shift+Enter breaks the line.
 */
export function Composer({
	placeholder = "dinobot에게 일을 맡겨 보세요",
	busy = false,
	onSubmit,
	onStop,
	footer,
	className,
}: {
	placeholder?: string;
	busy?: boolean;
	onSubmit?: (text: string) => void;
	onStop?: () => void;
	footer?: React.ReactNode;
	className?: string;
}) {
	const [text, setText] = useState("");
	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		if (busy || !text.trim()) return;
		onSubmit?.(text);
		setText("");
	};
	return (
		<form
			data-slot="composer"
			onSubmit={submit}
			className={cn("relative overflow-hidden rounded-xl border border-line-strong bg-surface transition-colors focus-within:border-line-ui", className)}
		>
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
				}}
				rows={2}
				placeholder={placeholder}
				aria-label="Message"
				className="block max-h-60 min-h-14 w-full resize-none bg-transparent px-3.5 pt-3 text-md leading-[var(--lh-chat)] text-fg outline-none placeholder:text-fg-3"
			/>
			<div className="flex items-center gap-1.5 px-2 pb-2">
				<Button variant="ghost" size="icon-sm" aria-label="Attach">
					<IconPaperclip />
				</Button>
				<div className="min-w-0 flex-1 truncate text-xs text-fg-3">{footer}</div>
				<span className="hidden items-center gap-1 text-micro text-fg-3 sm:flex">
					<Kbd>Enter</Kbd> 보내기
				</span>
				{busy ? (
					<Button variant="primary" size="icon-sm" shape="pill" aria-label="Stop" onClick={onStop}>
						<IconPlayerStopFilled className="size-3.5" />
					</Button>
				) : (
					<Button variant="primary" size="icon-sm" shape="pill" aria-label="Send" type="submit" disabled={!text.trim()}>
						<IconArrowUp />
					</Button>
				)}
			</div>
			{busy ? <span className="dn-scan" /> : null}
		</form>
	);
}
