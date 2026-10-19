import { Input, Kbd } from "@dinobot/ui";
import { useState } from "react";
import { SHORTCUTS } from "../lib/shortcuts.ts";

export function ShortcutsList() {
	const [q, setQ] = useState("");
	const list = SHORTCUTS.filter((s) => !q || `${s.keys} ${s.label}`.toLowerCase().includes(q.toLowerCase()));
	const sections = [...new Set(list.map((s) => s.section))];
	return (
		<div className="flex flex-col gap-4" data-testid="shortcuts">
			<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="단축키 찾기" autoFocus />
			{sections.map((section) => (
				<div key={section}>
					<div className="mb-1 font-mono text-micro uppercase tracking-[var(--tr-label)] text-fg-3">{section}</div>
					<div className="divide-y divide-line rounded-lg border border-line bg-surface">
						{list
							.filter((s) => s.section === section)
							.map((s) => (
								<div key={s.keys + s.label} className="flex items-center gap-3 px-3 py-1.5 text-sm">
									<span className="min-w-0 flex-1 text-fg">{s.label}</span>
									<span className="flex shrink-0 gap-1">
										{s.keys.split("+").map((k) => (
											<Kbd key={k}>{k}</Kbd>
										))}
									</span>
								</div>
							))}
					</div>
				</div>
			))}
		</div>
	);
}
