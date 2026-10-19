# Public source snapshot

## Origin and exclusions

Source commit: 307b7e20d8fc15dd702c41eb6c40f97dd1a56089. SOURCE_PROVENANCE.json contains the explicit 224-file selection and all 81 excluded source paths. Selection was read directly from Git objects, not the dirty working tree. No Git history was copied.

Excluded: private distribution services/get-worker, reports, all qa captures and scripts, existing internal release/invite/install/cloud scripts, old workflows, internal/research documents and screenshots, generated icon. Build outputs, downloaded dependencies and logs are disposable and not part of this snapshot.

Public adaptations: contribution/license/wiki/CI files; removal of operational root commands; real-capture replay replaced with hand-authored synthetic events while retaining replay assertions; personal path replaced by a synthetic Korean path; operational update-test domain replaced with example.test; third-party notice preservation and a public source guard. Runtime behavior is otherwise unchanged.

## Local verification

Windows x64, Bun 1.4.3. Commands were bounded to 120 seconds each.

- bun install --frozen-lockfile --ignore-scripts: passed (431 packages installed initially; final frozen recheck made no changes).
- bun run typecheck: passed.
- bun run test: 284 passed, 5 skipped, 0 failed across 31 files, 16,458 assertions.
- bun run build: passed for styleguide, renderer and Electron main/preload source bundles.
- bun run check:public: passed, including exact PolyForm license digest and pinned/read-only CI checks. Negative guard tests reject credential signatures, binary data and excluded paths.

The five existing Electron executable/GUI bytecode tests skip because the optional Electron binary was not downloaded (--ignore-scripts). No installer, live daemon, GUI E2E or hosted Linux CI run is claimed. Synthetic replay is not proof against historical real-session captures.

The pi-durable 1.0.2 npm archive does not contain a LICENSE file: direct extraction failed. Its metadata declares MIT and the upstream license was instead retrieved from the pinned repository commit documented in THIRD_PARTY_NOTICES.md.

## Remaining boundary

The historical local daemon tarball is not public. Source builds and CI do not need it. Installers remain unsupported until a compatible public core artifact is pinned and target-platform packaging is verified. No GitHub repository, organization or deployment mutation was performed.
