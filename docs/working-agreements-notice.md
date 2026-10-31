# Working-agreement context disclosure

## Decision

Independent AI UX and UI/accessibility reviews informed this change; no human design meeting is claimed.

- Adopt UX wording **전달된 작업 약속 N개**, not the UI review’s retained **적용**: a `pi.system` section proves instruction delivery, not compliance.
- Adopt both reviews’ neutral left-aligned row, document icon, default collapse, wrapping text, 32px minimum button, visible keyboard focus and no live-region announcements on historical rows.
- Preserve the request-time section rather than fetching current agreements. Details explain the meaning and render the original section as escaped plain text, including continuation lines. Unknown nonempty formats show an uncounted label, not a false zero.
- Reuse the existing memory row’s disclosure pattern through `ContextDisclosure`. Only the shared presentation/state is abstracted; memories and agreements keep their distinct data and meaning.
- A browser check with 30 agreements showed an unbounded panel pushed its own toggle above the transcript viewport. Bound details to min(16rem, 40vh), scroll inside it, and give the named region a keyboard tab stop. The memory disclosure uses this same bounded presentation.
- Reject success colors/checks, management links without a destination, and count-only deduplication. No new suppression is needed; entry-ID deduplication already exists.

## State and closed change set

`undefined` section → no row; `null` → explicit removal row; string → immutable historical section. Equal counts with different content remain distinct; A → null → A is preserved. Existing `ingestEntry` remains the single transcript writer. The sole open/closed state owner is each mounted `ContextDisclosure`; no backend/store mutations or fetches occur on expansion.

Search-based closure (no installed LSP): notice construction, `NoticeBlock`, `BlockView`, worker forwarding, session map and `Transcript` dispatch were inspected. The optional serializable `agreements` field survives existing worker structured-clone transport without a protocol/backend change. Memory and ordinary notices retain their routing. Translations use the existing compile-time Korean-source dictionary.

Canonical base: `dinobot-labs/dinobot-desktop` main `b23e0cc`; latest tag `desktop-v0.1.3` still used count-only notices. The dirty source checkout was not edited; dependencies were installed independently with the frozen lockfile.

## Verification

- 28 related Bun tests passed: model/replay, working agreements, memory recall and English i18n completeness. New cases cover missing/removal, changed same-count content, A → null → A, duplicate event delivery, snapshot replay, structured cloning, safe HTML escaping and unknown nonempty format.
- Repository TypeScript check and web production build passed, sequentially with `DEEPWORK_TYPECHECK_JOBS=2`.
- Synthetic real `Transcript` fixture: `apps/web/test/browser/agreements.fixture.html`, served by Vite. Isolated agent-browser session/profile only; no installed app replacement or user window interaction. Enter expands with focus retained, Tab/End scrolls detail, Shift+Tab/Space collapses. 360px viewport at CSS 200% zoom wraps labels without clipping.
- Scoped axe 4.12.1: light expanded 0 violations / 0 incomplete; dark narrow collapsed 0 violations / 0 incomplete. Screenshots inspected locally in ignored `qa/agreements-*.png`; generated artifacts are not committed.
- This is a browser fixture, not live-daemon/native-app E2E or a screen-reader user test. CSS zoom is a reflow stress check, not proof of native browser zoom behavior.

## References reviewed by the independent reviewers

Carbon notification guidelines
https://www.carbondesignsystem.com/building-blocks/core/components/notification/guidelines

WAI disclosure pattern
https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/

WCAG status messages
https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
