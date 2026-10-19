import { IconArrowsSplit2, IconBolt, IconChecklist, IconMessageQuestion, IconRobot } from "@tabler/icons-react";
import { cn } from "../../lib/cn.ts";
import type { NodeKind } from "./types.ts";

/** Node kind glyphs. Kind never takes color (the state owns color); verify is a checklist, not a check, so it never reads as "done". */
const ICONS = { act: IconBolt, delegate: IconRobot, verify: IconChecklist, ask: IconMessageQuestion, expand: IconArrowsSplit2 } as const;
export const KIND_LABEL: Readonly<Record<NodeKind, string>> = { act: "act", delegate: "delegate", verify: "verify", ask: "ask", expand: "expand" };

export function KindIcon({ kind, className, size = 14 }: { kind: NodeKind; className?: string; size?: number }) {
	const Icon = ICONS[kind];
	return <Icon aria-label={KIND_LABEL[kind]} size={size} stroke={1.75} className={cn("shrink-0 text-fg-3", className)} />;
}
