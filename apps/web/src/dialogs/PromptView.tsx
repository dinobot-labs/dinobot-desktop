import type { CommandPromptSpec } from "@dinobot/contracts";
import { Button, Input, Picker, type PickerOption } from "@dinobot/ui";
import { useMemo, useState } from "react";

/** select/checklist prompts open the shared Picker; text kinds render an inline field (secrets masked, never stored). */
export function PromptView({ spec, onAnswer, onCancel }: { spec: CommandPromptSpec; onAnswer: (value: string) => void; onCancel: () => void }) {
	const [value, setValue] = useState("");
	const options: PickerOption[] = useMemo(
		() =>
			spec.type === "select" || spec.type === "checklist"
				? spec.options.map((o) => ({
						id: o.id,
						label: o.label,
						text: `${o.label} ${o.description ?? ""}`,
						...(o.description ? { description: o.description } : {}),
						...(o.group ? { group: o.group } : {}),
						...(o.current ? { current: true } : {}),
						...(o.badge ? { badge: o.badge } : {}),
						...(o.tag ? { tag: o.tag } : {}),
						...(o.disabled ? { disabled: true } : {}),
						...("checked" in o ? { checked: Boolean(o.checked) } : {}),
					}))
				: [],
		[spec],
	);
	if (spec.type === "select" || spec.type === "checklist") {
		const [title = "", ...rest] = spec.message.split("\n");
		return (
			<Picker
				open
				title={title}
				header={rest.join("\n") || undefined}
				options={options}
				mode={spec.type === "checklist" ? "checklist" : "select"}
				onChoose={(ids) => onAnswer(spec.type === "checklist" ? JSON.stringify(ids) : (ids[0] ?? ""))}
				onCancel={onCancel}
			/>
		);
	}
	const secret = spec.type === "secret" || /key|token|secret|password|비밀|키/i.test(spec.message);
	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={(e) => {
				e.preventDefault();
				onAnswer(value.trim());
			}}
		>
			<label className="text-sm font-medium text-fg" htmlFor="prompt-field">
				{spec.message}
			</label>
			<Input
				id="prompt-field"
				autoFocus
				type={secret ? "password" : "text"}
				autoComplete="off"
				spellCheck={false}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						onCancel();
					}
				}}
				placeholder={spec.placeholder ?? (secret ? "붙여넣고 Enter" : "")}
				data-testid="prompt-field"
			/>
			<div className="flex justify-end gap-2">
				<Button variant="ghost" size="sm" type="button" onClick={onCancel}>
					취소
				</Button>
				<Button variant="primary" size="sm" type="submit">
					확인
				</Button>
			</div>
		</form>
	);
}
