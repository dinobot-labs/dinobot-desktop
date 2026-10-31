# Slack onboarding integration

## Delivery boundary

Desktop source and a compatible **local, unpublished win-x64 daemon bundle are staged**. No installer, live installation, shared daemon restart, real Slack calls, public release or push was performed. The normal dist scripts resolve the daemon from npm; this prerelease is not published, so they cannot fetch it. Use the explicit tarball/checksum staging command below for this local handoff. Never substitute public 0.8.4 as compatibility proof.

- Desktop base: 89005fd34706f72dc748fc557550df9b6ee00bf5 (existing onboarding retained).
- Core source: a8bdea8114fa6d6fde7ca047bcb9c74e407e37fa, clean before/after.
- Daemon: 0.8.4-slack.a8bdea8.1; runtime: Bun 1.4.3 win-x64 baseline.
- Schema: apps/web/src/prefs/slack-command-v1.schema.json, copied unchanged from that core commit.

## Behavior and ownership

Settings → Slack reuses Section, Button, Input, PromptView, Picker, RunLines, command-runner and setupApply. All Slack commands target the existing local tui:desktop-settings thread, never the active shared Slack conversation. Credentials go only through secret command prompts; no chat/model request, localStorage or transcript is used.

The bot-first /setup channels wizard preserves existing checklist selections, optional read-only user access, core-generated manifest, protected token generations and server validation. All outgoing messages/files remain bot-only. Cancel closes the wizard, not an existing connection.

Direct controls use POST /v1/threads/tui/desktop-settings/commands:

- name slack, args status: on opening and on refresh; the UI accepts exactly one schema-valid slack.status v1 output only after done. Terminal errors or incompatible responses clear stale status and disable controls until refresh succeeds.
- args monitor <JSON>: commits channels (up to five), IANA timezone, quiet hours, summary option and 60–3600-second interval to core SQLite. Refresh/reopen restores actual persisted values. Disable is a real command, not a copied draft. Saving resets prior monitor history/candidates as the core contract specifies.
- args disconnect: immediate durable monitor disable, followed by apply handoff. The UI says configuration/restart pending; it never claims Socket Mode has closed. Credentials and unrelated settings remain intact. Re-enabling is disabled while disconnect is staged.

Only core owns durable monitor state; the UI owns an editable draft and the last validated snapshot. Config presence, loaded service, enabled watch, started monitor and unknown live connectivity stay distinct. Poll failures are visible. No realtime/full-history guarantee: the core uses bounded polling, local-only notices and permission/retention limits.

The existing setupApply path retains validation, manifest CAS, daemon ownership, idle refusal, journal and restart handling. Only completed commands hand off apply. After applied, reconnect completes and Slack status is queried again. saved_external remains a saved configuration requiring its external owner's restart; busy/conflict/failure are not disconnection success.

## Verification

Sequential execution, DEEPWORK_TYPECHECK_JOBS=2:

- bun test apps/web/test/slack-model.test.ts apps/web/test/slack-status.test.ts apps/web/test/command-runner.test.ts apps/desktop/test/setup-apply.test.ts: **27 pass, 0 fail, 117 assertions**.
- bun test apps/desktop/test/browser/local-package.test.ts: **5 pass, 0 fail, 56 assertions**. Updated its exact expected pin to the local prerelease; all hash/cache/adversarial checks retained.
- bun run typecheck: passed.
- bun run --cwd apps/desktop build: passed (web + main/preload).
- DINOBOT_CORE_PATH=<pinned-core-checkout> bun scripts/slack-onboarding.e2e.ts: passed, headless Chrome, real core setup and real createCommands registry dispatch for Slack over the existing POST/SSE transport shape.
- git diff --check: passed.

E2E uses only mocked Slack transport plus real temporary protected files/SQLite. It proves bot and optional personal setup, missing-scope retry, secret clearing, keyboard cancel, local identity despite active shared thread, Telegram preservation, actual monitor commits, close/reload persistence including interval/summary/quiet hours, actual disable, error recovery for invalid manifest, staged disconnect, retained token, CAS conflict, isolated successful CAS and disabled-state restoration. It renders busy/saved_external outcomes and exercises automatic status refresh on applied using an injected outcome; it does not claim a real Electron IPC restart occurred.

A cancellation race was reproduced: while the cancel prompt reply was pending, a late daemon error changed cancelled to error and could retain a late apply. A failing unit guard and E2E reproduced it. command-runner now ignores events for cancelled/superseded runs. The same guards pass after the fix. No shared PromptView behavior changed.

Evidence (ignored local QA): qa/slack/result.json, bot-token.png, monitor-restored.png, disconnect-applied-fixture.png, unsupported-daemon.png, build.log, package-proof.json. Final monitor screenshot inspected: persisted values visible, controls legible, no token contents.

## Local artifact

The clean core commit was exported with git archive into ignored core-artifact/slack-a8bdea8. Only the snapshot package version was changed; core tracked files were untouched. The existing release.ts --local bundler and strict archive audit produced six allowed regular members, no source maps/build paths/secrets, and 59 bundled-package notices. No audit rule was weakened. Build dependencies were reused locally via an ignored junction; no machine-specific dependency was committed.

Tarball (relative to Desktop):

    core-artifact/slack-a8bdea8/dist/npm/dinobot-0.8.4-slack.a8bdea8.1.tgz

SHA-256:

    28abe986c9fc2639d008502d2e9b1854c1047e197eca35f2e3dcf8627dfe2d7e

Stage with an absolute path to those bytes:

    bun apps/desktop/scripts/stage-daemon.ts --os win --arch x64 --dinobot-tarball <absolute-tarball> --sha256 28abe986c9fc2639d008502d2e9b1854c1047e197eca35f2e3dcf8627dfe2d7e

Actual output: apps/desktop/vendor/daemon/win-x64. Native addon installed with scripts disabled; packaged --version matched the exact pin. All six staged package members matched the audited build output by SHA-256. A separate passive browser-host JSONL ui_state probe used the **staged Bun executable**, stripped inherited browser settings, returned disconnected/dedicated, and created no browser profile.

- Bun release ZIP SHA-256 (checked against published sums): d7a7d3eb216614544aab0cde2d8d9f2e4e87839bf5a30a1cd11d077f02d84e0c
- Staged bun.exe SHA-256: 095db4abae203d42f29fdec26da4a882fcde6333cdd84e40c0c7828c0cf543f6
- Staged main.js SHA-256: bbe0502134700b2401a156071ef06d23b20f72ba5747d6d3840067cee850b27d
- Staged browser-host.js SHA-256: 624b87535078c6935450b0a1dba50d1fc032265ee77f729a1cf7d274fe26a9bc

Full member hashes and passive reply are in qa/slack/package-proof.json. The tarball and vendor are local ignored artifacts, not downloaded automatically from a machine-specific path.

## Remaining live limitations

No actual Slack installation/token/account, actual outgoing message/file, bundled daemon Slack session, live Electron IPC, shared daemon restart, OS installation or installer acceptance has been exercised. Source/fixture UI acceptance and package integrity/protocol acceptance are separate evidence layers, not proof of a running deployment.

## Change closure

No LSP server was installed. Search-based closure: Preferences → SlackTab → slack-model/slack-status and pinned schema → command-runner → runCommandUi → setupApply; exact daemon pin → local-package guard → unchanged staging/audit tooling. Other command surfaces retain thread behavior; the only shared runner change makes cancellation terminal and guards apply on successful completion.
