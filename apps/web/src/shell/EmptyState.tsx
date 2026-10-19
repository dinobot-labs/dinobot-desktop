import { Button, Dino, Kbd } from "@dinobot/ui";
import { IconPlus } from "@tabler/icons-react";
import { newThread } from "../state/app.ts";

export function EmptyState() {
	return (
		<div className="dot-paper flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
			<Dino state="idle" size={150} />
			<div>
				<h2 className="text-xl font-semibold">무엇을 맡길까요?</h2>
				<p className="mt-1 text-sm text-fg-3">새 스레드를 열고 일을 맡겨 보세요.</p>
			</div>
			<Button variant="primary" size="lg" onClick={() => newThread()}>
				<IconPlus /> 새 스레드 <Kbd className="ml-1 border-transparent bg-white/15 text-fg-inverse">Ctrl N</Kbd>
			</Button>
		</div>
	);
}
