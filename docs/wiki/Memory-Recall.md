# Memory recall in the transcript

The collapsed row reads `전달된 기억 n개` (English: `Memories provided: n`), with Tabler’s outlined Notes icon and a separate chevron. Enter, Space or a click opens a plain content list. No memory-management action is implied.

Content comes only from the immutable `dinobot.nudge` entry. Schema 1 stores keys/revisions in `data.items`; the actual clipped text sent to the model lives in `entry.model` user messages. `chat/recall.ts` decodes the existing core `noteText` format, matches keys internally and copies content and supplied project/saved-date metadata into the notice view. It never fetches current memory. Clipping ellipses remain exactly as recorded. Unknown formats and key-only historical items show an unavailable-content message without exposing hashes or inventing sources. An empty record has an explicit empty state.

Both snapshot replay and live deliveries use `ingestEntry`, including existing entry-id deduplication. `BlockView` already carries notice fields and the worker passes non-tool blocks unchanged. Notice grouping and search use the recalled content. The only new UI state is a row-local boolean; it resets on virtualized unmount. Existing `virtualizer.measureElement` ResizeObserver measurement updates row heights when the disclosure changes. No persistent setting or network mutation is added.

Styling reuses Signal Paper/Night foreground, line and hover tokens; focus is visible and expanded state/control association is exposed to assistive technology. English strings use the existing build-time Korean-source i18n transform.

Checks:

- `bun test apps/web/test/recall.test.ts apps/web/test/memory-recall.test.tsx apps/web/test/model.test.ts packages/ui/test/i18n.test.ts`
- `bun scripts/memory-recall.e2e.ts` (installed Chrome; synthetic transcript only)
- `bun run typecheck` and `bun run build` sequentially

The decoder deliberately recognizes the current durable text format rather than guessing future payloads. Future format changes should add a versioned snapshot contract and behavioral fixtures. No wire contract or core memory implementation is modified.
