import { type CommandArgument, MESSAGE_IMAGE_LIMITS, type ThreadModelState } from "@dinobot/contracts";
import { Button, cn, Kbd, toast, Tooltip } from "@dinobot/ui";
import { IconArrowUp, IconBolt, IconBrain, IconClipboardText, IconPaperclip, IconPlayerStopFilled, IconX } from "@tabler/icons-react";
import { type ClipboardEvent, type DragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { desktop } from "../lib/bridge.ts";
import { LOCAL_COMMANDS, loadCommands, useCommands } from "../state/commands.ts";

export type Attachment = { mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string; name: string; bytes: number };
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}M` : `${Math.max(1, Math.round(n / 1024))}K`);

function readImage(file: File): Promise<Attachment | string> {
	if (!IMAGE_TYPES.has(file.type)) return Promise.resolve(`${file.name || "파일"}: png, jpeg, gif, webp 이미지만 보낼 수 있어요`);
	if (file.size > MESSAGE_IMAGE_LIMITS.maxBytesPerImage) return Promise.resolve(`${file.name || "이미지"}: 이미지는 2MB까지 보낼 수 있어요`);
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => {
			const url = String(reader.result);
			resolve({ mimeType: file.type as Attachment["mimeType"], data: url.slice(url.indexOf(",") + 1), name: file.name || "image", bytes: file.size });
		};
		reader.onerror = () => resolve(`${file.name}: 읽지 못했어요`);
		reader.readAsDataURL(file);
	});
}

/** Input history shared by every thread (TUI: 100 entries, consecutive duplicates dropped). */
const HISTORY_MAX = 100;
const history: string[] = (() => {
	try {
		return JSON.parse(localStorage.getItem("dn-history") ?? "[]") as string[];
	} catch {
		return [];
	}
})();
function remember(text: string) {
	if (!text.trim() || history.at(-1) === text) return;
	history.push(text);
	if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
	try {
		localStorage.setItem("dn-history", JSON.stringify(history));
	} catch {}
}

/** Long pastes collapse into a marker that expands on send (TUI: > 10 lines or > 1000 chars). */
type Paste = { id: number; text: string };
const PASTE_RE = /\[붙여넣기 #(\d+)[^\]]*\]/g;
const pasteMarker = (p: Paste) => {
	const lines = p.text.split("\n").length;
	return lines > 1 ? `[붙여넣기 #${p.id} +${lines}줄]` : `[붙여넣기 #${p.id} ${p.text.length}자]`;
};

/** Drafts survive thread switches (TUI T109), per thread key, in memory. */
const drafts = new Map<string, string>();

type Suggestion = { insert: string; label: string; description?: string; kind: "command" | "argument" | "ref" };

export interface ComposerProps {
	busy: boolean;
	disabled?: string | undefined;
	hasQueue: boolean;
	threadKey: string;
	cwd?: string | undefined;
	model?: ThreadModelState | undefined;
	onSend: (text: string, images: Attachment[]) => Promise<boolean>;
	onCommand: (name: string, args: string, quiet?: boolean) => void;
	onStop: () => void;
	onSendQueueNow: () => void;
	onRecallQueued: () => Promise<string | null>;
	onError: (message: string) => void;
	onDraftChange?: (hasText: boolean) => void;
}

/**
 * The composer. Enter sends (steers while dinobot works), Shift+Enter breaks the line, Esc stops, ↑/↓ browse input
 * history, ↓ on an empty box takes back the newest queued message, "/" completes commands and their arguments, "@"
 * attaches workspace context (files, folders, diff, git), images paste/drop in, long pastes fold into markers.
 * The footer carries the model line: model, reasoning (Shift+Tab cycles) and fast mode.
 */
export function Composer({ busy, disabled, hasQueue, threadKey, cwd, model, onSend, onCommand, onStop, onSendQueueNow, onRecallQueued, onError, onDraftChange }: ComposerProps) {
	const [text, setText] = useState(() => drafts.get(threadKey) ?? "");
	const [images, setImages] = useState<Attachment[]>([]);
	const [pastes, setPastes] = useState<Paste[]>([]);
	const [sending, setSending] = useState(false);
	const [pick, setPick] = useState(0);
	const [args, setArgs] = useState<{ name: string; rows: CommandArgument[] } | null>(null);
	const [refs, setRefs] = useState<Suggestion[]>([]);
	const [closedFor, setClosedFor] = useState<string | null>(null);
	const browse = useRef<{ index: number; draft: string } | null>(null);
	const area = useRef<HTMLTextAreaElement>(null);
	const pasteSeq = useRef(0);
	const commands = useCommands((s) => s.commands);

	useEffect(() => {
		void loadCommands();
		area.current?.focus();
	}, []);
	useEffect(() => {
		onDraftChange?.(text.trim().length > 0);
		if (text) drafts.set(threadKey, text);
		else drafts.delete(threadKey);
		const el = area.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
	}, [text]);

	// "/" commands, then "/<cmd> " arguments (fetched once per command), then "@" references.
	const slash = /^\/(\S*)$/.exec(text);
	const argMatch = /^\/(\S+) (\S*)$/.exec(text);
	const atMatch = /(?:^|\s)@(\S*)$/.exec(text);
	useEffect(() => {
		const name = argMatch?.[1];
		if (!name || args?.name === name || !commands.some((c) => c.name === name)) return;
		let live = true;
		void api
			.commandArguments(name, threadKey)
			.then((r) => live && setArgs({ name, rows: r.arguments }))
			.catch(() => live && setArgs({ name, rows: [] }));
		return () => {
			live = false;
		};
	}, [argMatch?.[1], commands, threadKey]);
	useEffect(() => {
		const token = atMatch?.[1];
		if (token === undefined || !desktop?.refsComplete || !cwd) {
			setRefs([]);
			return;
		}
		let live = true;
		const timer = setTimeout(() => {
			void desktop?.refsComplete(cwd, token).then((rows) => live && setRefs(rows.map((r) => ({ insert: r.insert, label: r.label, ...(r.description ? { description: r.description } : {}), kind: "ref" as const }))));
		}, 60);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [atMatch?.[1], cwd]);

	const suggestions: Suggestion[] = useMemo(() => {
		if (closedFor === text) return [];
		if (slash) {
			const q = (slash[1] ?? "").toLowerCase();
			return [...LOCAL_COMMANDS, ...commands]
				.filter((c) => c.name.startsWith(q))
				.slice(0, 8)
				.map((c) => ({ insert: `/${c.name} `, label: `/${c.name}`, description: c.description, kind: "command" as const }));
		}
		if (argMatch && args && args.name === argMatch[1]) {
			const q = (argMatch[2] ?? "").toLowerCase();
			const name = args.name;
			return args.rows
				.filter((r) => !r.disabled && `${r.value} ${r.label}`.toLowerCase().includes(q))
				.slice(0, 50)
				.map((r) => ({ insert: `/${name} ${r.value}`, label: r.label, description: [r.current ? "현재" : "", r.badge ?? "", r.description ?? r.group ?? ""].filter(Boolean).join(" · "), kind: "argument" as const }));
		}
		if (atMatch) return refs;
		return [];
	}, [text, slash?.[1], argMatch?.[2], args, commands, refs, closedFor]);
	const chosen = suggestions[Math.min(pick, Math.max(0, suggestions.length - 1))];

	const addImages = async (files: Iterable<File>) => {
		const next = [...images];
		for (const file of files) {
			const total = next.reduce((n, i) => n + i.bytes, 0);
			if (next.length >= MESSAGE_IMAGE_LIMITS.maxImages) {
				onError(`이미지를 붙이지 않았어요: 한 번에 ${MESSAGE_IMAGE_LIMITS.maxImages}장까지예요`);
				break;
			}
			const result = await readImage(file);
			if (typeof result === "string") onError(`이미지를 붙이지 않았어요: ${result}`);
			else if (total + result.bytes > MESSAGE_IMAGE_LIMITS.maxTotalBytes) onError("이미지를 붙이지 않았어요: 한 메시지에 8MB까지예요");
			else next.push(result);
		}
		setImages(next);
	};

	const accept = (s: Suggestion) => {
		if (s.kind === "ref") setText((t) => t.replace(/@(\S*)$/, s.insert));
		else setText(s.insert);
		setPick(0);
		area.current?.focus();
	};

	const expand = (value: string) => value.replace(PASTE_RE, (m, id: string) => pastes.find((p) => p.id === Number(id))?.text ?? m);

	const submit = async () => {
		const raw = text;
		const value = expand(raw).trim();
		if (disabled) return;
		if (sending) {
			toast({ title: "아직 보내는 중이에요", body: "입력한 내용은 그대로 둘게요." });
			return;
		}
		const command = /^\/(\w[\w-]*)(?:\s+([\s\S]*))?$/.exec(value);
		if (command) {
			const [, name = "", rest = ""] = command;
			if ([...LOCAL_COMMANDS, ...commands].some((c) => c.name === name)) {
				if (images.length) {
					onError("명령을 실행하려면 먼저 이미지를 빼 주세요");
					return;
				}
				remember(raw);
				onCommand(name, rest.trim());
				setText("");
				setPastes([]);
				return;
			}
			if (!/\s/.test(value)) {
				onError(`unknown command /${name}`);
				return;
			}
		}
		if (!value && images.length === 0) {
			if (hasQueue) onSendQueueNow();
			return;
		}
		let body = value;
		if (/(?:^|\s)@(file:|folder:|git:|diff\b|staged\b)/.test(value) && desktop?.refsExpand && cwd) {
			const expanded = await desktop.refsExpand(cwd, value, {});
			for (const w of expanded.warnings) toast({ tone: "waiting", title: w });
			if (expanded.blocked) {
				onError(`참조를 붙이지 않았어요: ${expanded.blocked}`);
				return;
			}
			body = expanded.text;
		}
		setSending(true);
		const draftBefore = raw;
		const ok = await onSend(body, images);
		setSending(false);
		if (ok) {
			remember(raw);
			browse.current = null;
			// Anything typed while sending stays.
			setText((t) => (t === draftBefore ? "" : t.startsWith(draftBefore) ? t.slice(draftBefore.length).trimStart() : t));
			setImages([]);
			setPastes([]);
		}
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.nativeEvent.isComposing) return;
		const el = e.currentTarget;
		if (suggestions.length) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setPick((p) => (p + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setClosedFor(text);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				if (chosen && (chosen.kind === "ref" || chosen.insert.trimEnd() !== text.trimEnd())) {
					e.preventDefault();
					accept(chosen);
					return;
				}
			}
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void submit();
			return;
		}
		if (e.key === "Escape" && busy) {
			e.preventDefault();
			onStop();
			return;
		}
		if (e.key === "Tab" && e.shiftKey && model && model.supportedThinkingLevels.length > 1) {
			e.preventDefault();
			onCommand("reasoning", "cycle", true);
			return;
		}
		if (e.key === "v" && e.ctrlKey && e.altKey) {
			e.preventDefault();
			setImages((list) => list.slice(0, -1));
			return;
		}
		const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
		const atEnd = el.selectionStart === text.length;
		if (e.key === "ArrowUp" && (text === "" || browse.current || atStart) && history.length) {
			e.preventDefault();
			const b = browse.current ?? { index: history.length, draft: text };
			b.index = Math.max(0, b.index - 1);
			browse.current = b;
			setText(history[b.index] ?? "");
			return;
		}
		if (e.key === "ArrowDown" && browse.current && atEnd) {
			e.preventDefault();
			const b = browse.current;
			b.index += 1;
			if (b.index >= history.length) {
				setText(b.draft);
				browse.current = null;
			} else setText(history[b.index] ?? "");
			return;
		}
		if (e.key === "ArrowDown" && !text && hasQueue) {
			e.preventDefault();
			void onRecallQueued().then((recalled) => recalled && setText(recalled));
		}
	};

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
		if (files.length) {
			e.preventDefault();
			if (text.startsWith("/")) return onError("명령을 입력하는 중에는 이미지를 붙일 수 없어요");
			void addImages(files);
			return;
		}
		const pasted = e.clipboardData.getData("text/plain");
		// A pasted image path (quoted, escaped or file://) attaches the file (TUI T37).
		const path = pasted.trim().replace(/^file:\/\/\/?/, "").replace(/^["']|["']$/g, "").replace(/\\ /g, " ");
		if (desktop?.readImageFile && !pasted.includes("\n") && /\.(png|jpe?g|gif|webp)$/i.test(path)) {
			e.preventDefault();
			void desktop.readImageFile(decodeURIComponent(path)).then((r) => {
				if ("error" in r) onError(r.error);
				else if (images.length >= MESSAGE_IMAGE_LIMITS.maxImages) onError(`이미지를 붙이지 않았어요: 한 번에 ${MESSAGE_IMAGE_LIMITS.maxImages}장까지예요`);
				else setImages((list) => [...list, { mimeType: r.mimeType, data: r.data, name: path.split(/[\\/]/).pop() ?? "image", bytes: r.bytes }]);
			});
			return;
		}
		// Nothing usable in the paste event: ask the main process for a clipboard image (screenshots on some systems).
		if (!pasted && desktop?.clipboardImage) {
			e.preventDefault();
			void desktop.clipboardImage().then((img) => {
				if (!img) onError("클립보드에 이미지나 텍스트가 없어요");
				else if (img.bytes > MESSAGE_IMAGE_LIMITS.maxBytesPerImage) onError("이미지를 붙이지 않았어요: 이미지는 2MB까지예요");
				else setImages((list) => [...list, { mimeType: img.mimeType, data: img.data, name: "clipboard.png", bytes: img.bytes }]);
			});
			return;
		}
		if (pasted.split("\n").length > 10 || pasted.length > 1000) {
			e.preventDefault();
			const p = { id: ++pasteSeq.current, text: pasted };
			setPastes((list) => [...list, p]);
			const el = e.currentTarget;
			const start = el.selectionStart;
			const end = el.selectionEnd;
			setText((t) => `${t.slice(0, start)}${pasteMarker(p)}${t.slice(end)}`);
		}
	};

	const showStop = busy && !text.trim() && images.length === 0;
	const usedPastes = pastes.filter((p) => text.includes(`#${p.id} `) || text.includes(`#${p.id}]`));
	const reasoning = !model
		? "추론 ?"
		: model.supportedThinkingLevels.length === 0
			? "추론 없음"
			: model.supportedThinkingLevels.length === 1 && model.supportedThinkingLevels[0] === "off"
				? "추론 미지원"
				: model.supportedThinkingLevels.length === 1
					? `추론 ${model.thinkingLevel} (고정)`
					: `추론 ${model.thinkingLevel}`;
	return (
		<div className="relative">
			{suggestions.length ? (
				<div className="absolute right-0 bottom-full left-0 mb-2 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface shadow-float" role="listbox" data-testid="composer-suggestions">
					{suggestions.map((s, i) => (
						<button
							key={`${s.kind}:${s.insert}`}
							type="button"
							role="option"
							aria-selected={i === pick}
							onMouseDown={(e) => {
								e.preventDefault();
								accept(s);
							}}
							className={cn("flex w-full cursor-pointer items-center gap-3 px-3 py-1.5 text-left text-sm", i === pick ? "bg-hover" : "hover:bg-hover")}
						>
							<span className={cn("shrink-0 text-fg", s.kind !== "argument" && "font-mono")}>{s.label}</span>
							<span className="min-w-0 truncate text-fg-3">{s.description}</span>
						</button>
					))}
				</div>
			) : null}
			<div
				data-slot="composer"
				onDragOver={(e: DragEvent) => {
					if ([...e.dataTransfer.items].some((i) => i.kind === "file")) e.preventDefault();
				}}
				onDrop={(e: DragEvent) => {
					if (!e.dataTransfer.files.length) return;
					e.preventDefault();
					void addImages(e.dataTransfer.files);
				}}
				className={cn("relative overflow-hidden rounded-xl border border-line-strong bg-surface transition-colors focus-within:border-line-ui", disabled && "opacity-60")}
			>
				{images.length || usedPastes.length ? (
					<div className="flex flex-wrap items-end gap-2 px-3 pt-3" data-testid="attachments">
						{images.map((img, i) => (
							<div key={i} className="group relative">
								<img src={`data:${img.mimeType};base64,${img.data}`} alt={img.name} className="size-14 rounded-md border border-line object-cover" />
								<span className="absolute right-0.5 bottom-0.5 rounded-xs bg-black/60 px-1 font-mono text-[9px] text-white">{img.mimeType.split("/")[1]?.toUpperCase()} {kb(img.bytes)}</span>
								<button type="button" aria-label="이미지 빼기" onClick={() => setImages((list) => list.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-inverse text-fg-inverse">
									<IconX size={12} />
								</button>
							</div>
						))}
						{usedPastes.map((p) => (
							<span key={p.id} className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-sunken px-2 text-xs text-fg-2">
								<IconClipboardText size={13} /> 붙여넣기 #{p.id} · {p.text.split("\n").length}줄
								<button type="button" className="cursor-pointer text-accent-deep hover:underline" onClick={() => setText((t) => t.replace(new RegExp(`\\[붙여넣기 #${p.id}[^\\]]*\\]`), p.text))}>
									펼치기
								</button>
							</span>
						))}
					</div>
				) : null}
				<textarea
					ref={area}
					value={text}
					disabled={Boolean(disabled)}
					onChange={(e) => {
						setText(e.target.value);
						setPick(0);
						browse.current = null;
					}}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					rows={1}
					placeholder={disabled ?? (busy ? "작업 중에 보내면 진행 방향을 바꿔요 (steer)" : "무엇이든 맡겨 보세요  ·  / 명령  ·  @ 파일")}
					aria-label="메시지"
					data-testid="composer-input"
					className="selectable block max-h-[40vh] min-h-12 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-md leading-[var(--lh-chat)] text-fg outline-none placeholder:text-fg-3"
				/>
				<div className="flex items-center gap-1 px-2 pb-2">
					<Tooltip content="이미지 첨부 (붙여넣기·끌어 놓기도 돼요)">
						<label className={cn("flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg", disabled && "pointer-events-none")}>
							<IconPaperclip size={16} />
							<input
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								multiple
								className="hidden"
								onChange={(e) => {
									if (e.target.files) void addImages(e.target.files);
									e.target.value = "";
								}}
							/>
						</label>
					</Tooltip>
					{model ? (
						<div className="flex min-w-0 items-center gap-0.5" data-testid="model-line">
							<Tooltip content="모델 바꾸기 (/model)">
								<button type="button" onClick={() => onCommand("model", "")} className="h-6 max-w-48 cursor-pointer truncate rounded-sm px-1.5 font-mono text-xs text-fg-2 hover:bg-hover hover:text-fg">
									{model.model.split("/").pop()}
								</button>
							</Tooltip>
							<Tooltip content="추론 강도 (Shift+Tab으로 바꾸기)">
								<button type="button" disabled={model.supportedThinkingLevels.length < 2} onClick={() => onCommand("reasoning", "")} className="flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs text-fg-3 hover:bg-hover hover:text-fg disabled:cursor-default disabled:hover:bg-transparent">
									<IconBrain size={13} /> {reasoning}
								</button>
							</Tooltip>
							<Tooltip content={model.fastSupported ? "빠른 모드: 우선 처리, 비용 더 큼" : "이 모델은 빠른 모드가 없어요"}>
								<button
									type="button"
									disabled={!model.fastSupported}
									aria-pressed={model.fast}
									onClick={() => onCommand("fast", "toggle", true)}
									className={cn("flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs hover:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent", model.fast ? "text-accent-deep" : "text-fg-3")}
								>
									<IconBolt size={13} /> fast
								</button>
							</Tooltip>
						</div>
					) : null}
					<div className="flex-1" />
					<span className="hidden items-center gap-1 text-micro text-fg-3 lg:flex">
						<Kbd>Enter</Kbd> {busy ? "steer" : "보내기"}
					</span>
					{showStop ? (
						<Button variant="primary" size="icon-sm" shape="pill" aria-label="중지" data-testid="stop" onClick={onStop}>
							<IconPlayerStopFilled className="size-3.5" />
						</Button>
					) : (
						<Button variant="primary" size="icon-sm" shape="pill" aria-label={busy ? "steer" : "보내기"} data-testid="send" disabled={Boolean(disabled) || sending || (!text.trim() && images.length === 0 && !hasQueue)} onClick={() => void submit()}>
							<IconArrowUp />
						</Button>
					)}
				</div>
				{busy ? <span className="dn-scan" style={{ ["--scan-color" as string]: "var(--status-running)" }} /> : null}
			</div>
		</div>
	);
}
