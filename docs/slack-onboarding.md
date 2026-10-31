# Slack onboarding integration

## Source identities

- Desktop canonical main: dinobot-labs/dinobot-desktop, 39d988f4abefaebfcce82ff09727ddea84b8a64e. Fresh clone HEAD matched ls-remote main before edits.
- Core contract tested: e0cb8ba6e414c54c8b90713050380c55076d344e in dinobot-slack-personal.
- Bundled daemon remains 0.8.4. This change does **not** package, install or start the new core. Integration must package a core containing the tested contract before the new onboarding works. Older core is explicitly rejected when its setup channel checklist lacks slack-personal.

## Implemented

Settings → Slack reuses Section, Button, Input, PromptView, Picker, RunLines, command-runner and the existing setupApply bridge. Slack setup always targets tui:desktop-settings even while a shared Slack conversation is active. It runs /setup channels and preserves all existing channel checklist selections (especially Telegram, whose deselection removes configuration).

The daemon owns the scope catalog, official manifest_json URL, validation, protected files and final CAS apply request. The UI decodes that exact manifest for copying; it does not maintain a competing manifest. Bot/app tokens are baseline, personal read-only user token is optional. Tokens are transient password inputs, sent only as command prompt replies, never as chat messages or localStorage. Prompt IDs remount inputs; cancellation, submission and leaving the tab discard fields. Retry, workspace/app mismatch and missing-scope messages use the backend response.

Reconnect uses the same protected-generation setup. Cancel does not disconnect an existing installation. Apply uses the existing CAS / busy refusal / idle restart behavior, and the UI distinguishes applied from runtime connectivity. Apply failures are caught and surfaced without logging request contents.

## Explicit contract limitations (not completion claims)

Core has no deterministic Desktop-callable Slack status, monitor configuration or disconnect command. slack_personal_status and slack_personal_monitor are agent tools, not HTTP endpoints. The UI therefore:

- never displays fabricated live Slack connectivity;
- disables disconnect and does not delete credentials or silently disable channels;
- exposes validated channel/DM, quiet-hour, time-zone and summary **drafts**, copyable into a local conversation for explicit tool execution. Copying does not apply or enable monitoring;
- documents owner-private-bot-DM access, local-only automatic notifications, bot-only sending and bounded polling latency.

Completing direct controls requires a versioned local command contract in core for safe status, monitor configure/disable and disconnect. Do not invent a tool-call HTTP route or route secrets through the model. The parent was notified through ask b09c8a442171104d41827f9e27231f1f; its default was the honest limited UI pending a core contract.

## Verification

Commands run sequentially:

- bun test apps/web/test/slack-model.test.ts apps/web/test/command-runner.test.ts apps/desktop/test/setup-apply.test.ts — 24 passed, 0 failed, 96 assertions.
- DEEPWORK_TYPECHECK_JOBS=2 bun run typecheck — passed.
- bun run --cwd apps/web build — passed.
- bun run --cwd apps/desktop build:main — passed.
- DINOBOT_CORE_PATH=C:/Users/정승현/dinobot-slack-personal bun scripts/slack-onboarding.e2e.ts — passed in headless Chrome.
- git diff --check — passed.

The browser script runs actual core setupCommand over an isolated SSE/prompt adapter with mock Slack auth, bot info and Socket Mode hello responses. It verifies bot-first and optional personal flows, missing_scope retry, keyboard submission/cancel and cleared secret fields, preserved Telegram, local command identity, protected-path-only apply candidate, unchanged manifest, no secret values in public events/runner/localStorage, monitor draft validation and unsupported-daemon fail-closed behavior. It does not start a daemon or contact Slack. Initial fixture attempts failed on a workspace dependency import and two incorrect English selectors; corrected fixture then passed.

Screenshots and machine-readable receipt (local ignored evidence):

- qa/slack/bot-token.png
- qa/slack/monitor-draft.png
- qa/slack/unsupported-daemon.png
- qa/slack/result.json

Actual Slack installation, Electron IPC exercise with a live daemon, restart of the shared runtime, release and push are intentionally not performed. Existing setupApply tests exercise CAS/restart outcomes with isolated process doubles; they are not live deployment proof.

## Change closure

LSP reported no installed servers. Search-based closure: Preferences tab registration → SlackTab → slack-model and existing command-runner surface → runCommandUi → existing setupApply. No transport contracts or shared PromptView behavior changed. One credential mutation owner remains core setup; monitor drafts are component-local and never persisted. Other command surfaces retain their original thread behavior.
