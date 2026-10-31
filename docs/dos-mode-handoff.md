# DOS appearance source handoff

## Scope
Canonical dinobot-labs/dinobot-desktop main 01a2ccba84d41f1bb4cfbc7a9b62355cddc88eac, re-fetched before delivery. DOS Blue/Black are opt-in; system/light/dark defaults remain unchanged. Existing settings setter persists dn-settings/dn-theme. Typography and dinosaur choices remain stored while DOS overrides presentation. No model, execution or stream-state changes.

Neo둥근모 v1.601 WOFF2 is bundled with SIL OFL license/provenance. SHA256 0c0ca9cd73f692a5da5d7fb39737902aa9ea312537237779972a9d81ef0a33bf, 44352 bytes. DOS uses 16px, square controls, double major frames, single inner frames, inverse selection and separate focus. No CRT or simulated progress.

## Executed verification (2026-10-31)

1. bun scripts/dos-resolution.ts proves web @dinobot/ui and styles.css resolve inside this worktree.
2. bun test apps/web/test/dos-settings.test.ts apps/web/test/settings.test.ts apps/web/test/typography.test.ts: 26 pass, 121 assertions. Existing tests include legacy source checks; new DOS test exercises persistence/state.
3. bun run typecheck passes. Initial missing yaml/styleguide workspace dependencies were linked to installed development dependencies; @dinobot/ui points to worktree source. Original dependency files were not modified.
4. bun run build passes: styleguide, web and Electron main/preload. Web rebuilt after the CSS regression fix below. Bundled neodgm asset is present.
5. bun scripts/dos-theme.e2e.ts passes in isolated Chrome: actual components, blue/black, font, persistence/reload/default, five valid tool statuses, Enter/Space, focus and mock approval. Initial prepared fixture had unescaped string newlines and an invalid success status; repaired to raw template/done. Linked default font paths are explicitly allowed for the test server; final run has no font403 warnings.
6. bun scripts/dos-app.e2e.ts passes against the production-built full web entry: Ctrl+, settings, blue/black selection, root and dialog colors, stored reload, default restoration, Korean font loaded, 16px, double frame, reduced-motion and focus. A synthetic protocol snapshot travels through the app's worker/reducer/transcript; failed bash output with diff text opens via keyboard, Korean text renders, and Enter on the real AskBar emits the expected askId/option POST to the local protocol mock. No real model or tool execution. No page exceptions or failed non-daemon assets.
7. Screenshot inspection exposed a real CSS cascade defect: dinosaur root selectors overrode DOS dialog surface. Added a runtime computed-color assertion, observed rgb(27,30,29) instead of blue, added the root data-dino selector, rebuilt and passed the same test. Both blue and black chat/settings screenshots inspected directly.
8. git diff --check passes; LSP unavailable.

Screenshots are generated locally under apps/web/dos-app-dos-{blue,black}.png, dos-chat-dos-{blue,black}.png and dos-dos-{blue,black}.png. Do not commit generated images/logs/builds. Protocol mocks are explicitly labeled LOCAL MOCK, not captured user data.

## Remaining native/release boundary

No native app launch: this isolated worktree has no vendor daemon. Main/preload build is not Electron native runtime acceptance. Packaged font/protocol, native titlebar, OS theme changes, IME, accessibility and zoom still need downstream packaged validation. No installer executed, no installed app replaced, no daemon restarted, no policy disabled.

Source package metadata is currently desktop 0.1.2-local.browser.1 with daemon 0.7.15-local.browser.1; only public-source.yml exists here. The release owner must use the current official stable channel for monotonic patch versions, build from these canonical sources, stage the verified daemon, validate native packaging and preserve existing settings/processes. This handoff does not claim release or installation completion.
