import type { SessionStatus } from "@dinobot/contracts";

/** Display-only activity: sessions snapshots contain running children, not terminal task history.
 * Keep the parent's busy flag unchanged: composer/stop controls describe the parent run only.
 */
export function hasActiveWork(status: SessionStatus | undefined): boolean {
	return Boolean(status?.busy) || (status?.subagents.length ?? 0) > 0;
}
