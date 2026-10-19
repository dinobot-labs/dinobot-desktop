import { cn } from "../../lib/cn.ts";
import { Shimmer } from "../shimmer.tsx";
import { type StatusKind, StatusMark } from "../status.tsx";

/** dinobot's TodoItem (src/core/ui-contract.ts). */
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
}

const MARK: Record<TodoStatus, StatusKind> = { pending: "pending", in_progress: "running", completed: "done", cancelled: "skipped" };

export function TodoList({ todos, className }: { todos: readonly TodoItem[]; className?: string }) {
	const done = todos.filter((t) => t.status === "completed").length;
	return (
		<div data-slot="todo-list" className={cn("flex flex-col gap-0.5", className)}>
			<div className="mb-1 flex items-center justify-between font-mono text-micro uppercase tracking-[var(--tr-label)] text-fg-3">
				<span>Todo</span>
				<span className="tabular-nums">
					{done}/{todos.length}
				</span>
			</div>
			{todos.map((t) => (
				<div key={t.id} className="flex min-w-0 items-start gap-2 py-0.5 text-sm">
					<StatusMark kind={MARK[t.status]} size={14} className="mt-0.5" />
					<span className={cn("min-w-0", t.status === "completed" && "text-fg-3 line-through decoration-line-strong", t.status === "cancelled" && "text-fg-3", t.status === "pending" && "text-fg-2")}>
						{t.status === "in_progress" ? <Shimmer className="whitespace-normal">{t.content}</Shimmer> : t.content}
					</span>
				</div>
			))}
		</div>
	);
}
