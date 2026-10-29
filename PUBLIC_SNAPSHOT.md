# Public source provenance

## Current maintained source

Desktop is maintained in this repository, not in the previous private repository. Core and TUI are maintained in the matching public repository:

Desktop
https://github.com/dinobot-labs/dinobot-desktop

Core and TUI
https://github.com/dinobot-labs/dinobot

The 2026-10-29 source sync starts at public `8224ef73ed78c116d4b7294d4bcfcc9e7c32cced` and applies the product delta between historical export `307b7e20d8fc15dd702c41eb6c40f97dd1a56089` and frozen source `448ade1a8834f2ca2d4263295c1c8f00caaebdcd`. These are unrelated public/legacy histories, not a merge or a claim of direct commit ancestry.

The delta covers 27 runtime and 11 test paths: slow startup/reconnect, provider-reported context usage, in-row copy actions, connected-daemon identity, arbitrary file attachments, problem reporting and the public install-base parser. The source lists and public adaptations are recorded in `SOURCE_PROVENANCE.json.currentSource`. The local artifact test preserves the historical manifest pin rather than promoting the legacy registry pin to a trusted artifact.

Public synthetic fixtures, update example domains, license files, bytecode/browser checks and checksum-pinned staging remain in place. No private backend, installer, workflow, QA capture, session, local dirty file or feature branch was imported. The report client uses the core `report consent|agree|send --json` CLI contract; fake CLI tests are not acceptance of a production report service.

## Verification of maintained source

On 2026-10-29, Bun 1.4.3 checks ran sequentially on the synchronized source (`DEEPWORK_TYPECHECK_JOBS=2`):

- Windows `bun test packages apps scripts`: **401 passed, 12 skipped, 0 failed**, 38 files, 16,751 assertions. Two directory-link fixtures first reproduced Windows privilege errors; using real Windows directory junctions preserved their assertions and made both pass.
- Linux/WSL, with the identical Git tree: **405 passed, 6 skipped, 0 failed**, 38 files, 16,764 assertions. This includes POSIX attachment permission, failed-copy cleanup and real directory-symlink behavior.
- Windows `bun run typecheck` and `bun run build`: passed for styleguide, renderer and Electron main/preload source bundles. The unchanged public guard and exact Git-blob checksum coverage pass.
- Independent source review confirmed the 27 runtime/11 test delta, retained public boundaries and the core report/attachment contracts.

The optional Electron executable was not installed (`--ignore-scripts`), so five executable/GUI bytecode tests skipped on both platforms. Windows additionally skips POSIX attachment and non-Windows process checks; Linux skips the Windows launcher check. No GUI window, real report upload, installer, app installation or daemon restart was used. Synthetic report/CLI checks are not production-service acceptance. Historical counts below describe only the original export.

`SOURCE_HASHES.json` covers every tracked file except itself. Hashes are SHA-256 of raw Git blobs, not checkout bytes; this avoids CRLF-dependent license hashes. Stage the intended source files, then generate with `bun scripts/source-hashes.ts --json`, stage the resulting manifest and verify with `bun scripts/source-hashes.ts --check`. Passing an optional revision to either command reads that Git tree instead of the index. The public guard checks a separate content/path/license/CI boundary; it is not a substitute for the hash audit.

## Historical export origin and exclusions

Export source: `307b7e20d8fc15dd702c41eb6c40f97dd1a56089`. The top-level `sourceCommit`, `included`, `excluded` and `modifiedFromPin` in `SOURCE_PROVENANCE.json` preserve the original 224-file selection and all 81 excluded source paths. They describe the original export, not the current complete tree. Selection was read directly from Git objects, not a dirty working tree; no Git history was copied.

Excluded: private distribution services/get-worker, reports, all QA captures and scripts, internal release/invite/install/cloud scripts, old workflows, internal/research documents and screenshots, generated icon. Build outputs, downloaded dependencies and logs are disposable and not source.

The original public adaptations added contribution/license/wiki/CI files, removed operational root commands, replaced real-capture replay with hand-authored synthetic events while retaining assertions, replaced personal paths and operational test domains, and preserved third-party notices with a public source guard.

### Historical local verification (not rerun by this record)

The export recorded Windows x64, Bun 1.4.3, with commands bounded to 120 seconds each:

- `bun install --frozen-lockfile --ignore-scripts`: passed; 431 packages installed initially.
- `bun run typecheck`: passed.
- `bun run test`: 284 passed, 5 skipped, 0 failed across 31 files, 16,458 assertions.
- `bun run build`: passed for styleguide, renderer and Electron main/preload source bundles.
- `bun run check:public`: passed, including PolyForm digest and read-only pinned CI checks.

The five historical Electron executable/GUI bytecode tests skipped because the optional Electron binary was not downloaded (`--ignore-scripts`). No installer, live daemon, GUI E2E or hosted Linux CI acceptance was claimed. Synthetic replay is not proof against historical real-session captures.

The pi-durable 1.0.2 npm archive lacked a LICENSE file. Its metadata declared MIT, and the upstream license was retrieved from the pinned repository commit documented in `THIRD_PARTY_NOTICES.md`. That license inventory is preserved.

## Artifact boundary

The app version `0.1.2-local.browser.1`, daemon pin `0.7.15-local.browser.1` and Bun pin `1.4.3` remain unchanged historical packaging identity. Source freshness is established by Git revisions, not by those version fields. The historical daemon artifact is not public; source builds and CI do not need it. Do not replace it with a registry version and call that verified canonical provenance.

Installers remain unsupported until a compatible artifact built from the public core is pinned, its name/version/SHA and Bun checksum verified, and target-platform packaging tested. This source sync does not publish packages or installers, install/restart an app or daemon, or establish that an installed runtime contains these changes.
