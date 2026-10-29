# Release boundary

This repository initially supports source builds only. No automatic deployment, installer publication, private artifact upload or private repository access runs in CI. The historical daemon pin 0.7.15-local.browser.1 is not a public release artifact. Do not expect dist, dist:win, dist:mac or stage:daemon to produce a working public installer yet.

A future installer release must pin a compatible public Dinobot release, preserve stage-daemon checksum and browser-protocol validation, generate its icon from source, retain runtime/Chromium/font notices, test on each target OS, and document source-to-artifact provenance. Do not substitute a private vendor tarball.

Public core source
https://github.com/dinobot-labs/dinobot

The root build command needs none of those packaging inputs. The source sync from frozen `448ade1a8834f2ca2d4263295c1c8f00caaebdcd` does not change the historical app/daemon version fields or claim an installer release. Do not use an npm version's existence as proof that it was built from the canonical public core. See PUBLIC_SNAPSHOT.md for the current source boundary.

The problem-report UI requires a core exposing `dinobot report consent|agree|send --json`. Its CLI/client tests use synthetic context and fake protocol endpoints; they must not transmit actual user diagnostics for verification. File-attachment paths assume the daemon runs on the same machine. Platform-specific permission and packaging checks remain part of acceptance, not something a source hash or static guard proves.

## Tracking fixes

A merged change is available in source at its commit, not necessarily in a release or installer. When closing a fixed issue, link the merged PR or commit and state `unreleased` until a named release contains it. For partial fixes, keep the remaining scope open. GitHub closing keywords can close an issue on merge; maintainers must still verify its scope and add the release status.

When publishing a future release, list notable fixes and breaking changes, link the included issues and record the exact source revision. Update those issues with the release identifier. Do not promise release dates or describe source-only verification as packaged application acceptance.
