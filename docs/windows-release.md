# Windows 0.1.5 preparation

This source pins Desktop 0.1.5 to dinobot 0.8.4 and Bun 1.4.3. It does not claim that these artifacts are published, installed or accepted by Smart App Control (SAC). Only Windows x64 is built by the new manual workflow. No macOS artifact is claimed.

## Immutable inputs and outputs

The manual Windows package workflow accepts a successful **official core Release run ID**. It requires that run to be at the exact v0.8.4 tag commit. A successful unrelated CI run, another repository, an incomplete run or a retry whose workflow head differs from the tag is rejected. For that last case, use a new release run at the tag source rather than weakening the binding.

The helper downloads the existing audited npm artifact from that run, compares its SHA-512 against both CI SHA512SUMS and npm dist.integrity, and records its SHA-256. No npm token is needed to read the public registry. The existing stage-daemon path verifies archive SHA-256, package identity, pinned Bun download checksum, installed version/native addon and passive shared-browser protocol. Its audits are unchanged.

The seal checks packaged daemon.json against the selected archive and records:

Desktop source SHA → core source SHA/run/tag → tarball SHA-256 and npm integrity → packaged daemon marker → signed installer SHA-256 and signer thumbprints.

A source package, passive browser-protocol probe, bytecode audit or valid signature is **not** a completed native application flow.

## Prerequisites

1. Core 0.8.4 must be published successfully from dinobot-labs/dinobot. Its pending DOS CI must finish first. The core preparation uses release-please release-as 0.8.4; package and release manifest stay at 0.8.3 until the actual release PR.
2. Configure the Desktop windows-release environment with WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD for a trusted Windows code-signing certificate. The runner requires signing; unsigned artifacts cannot pass the seal. Existing repository secret listing was empty, which says nothing about organization/environment credentials or npm OIDC readiness.
3. npm Trusted Publisher settings must map package dinobot to organization dinobot-labs, repository dinobot, workflow release.yml, environment npm. A local npm whoami failure does not test GitHub OIDC. Only the actual authorized publish workflow establishes that path.
4. Run source CI before dispatch. The package workflow runs additional type, boundary and package tests, then the existing bytecode hooks during packaging. Keep native acceptance separate.

After these prerequisites and authorized integration (not run by this preparation):

    gh workflow run windows-package.yml --repo dinobot-labs/dinobot-desktop --ref main -f core_run_id=SUCCESSFUL_CORE_RELEASE_RUN_ID
    gh run download WINDOWS_RUN_ID --repo dinobot-labs/dinobot-desktop --name windows-signed-DESKTOP_SOURCE_SHA --dir VERIFIED_WINDOWS_OUTPUT

Do not use watch/poll loops. Inspect one completion result, signatures and digests before further action. The workflow does not create a release, update the download service, run an installer or restart an app.

## Native and SAC acceptance before installation

Use the signed package in an isolated Desktop home/profile and an isolated daemon configuration, not the user's running session. Verify DOS blue/black/default persistence, Korean text, keyboard operation and one completed real request/tool/result flow. Keep screenshots and runtime logs outside Git. Record exact executable/resource hashes and test outcomes.

Get-AuthenticodeSignature is a static signing check, not a prediction of SAC reputation. Read the target machine's Windows Security → App & browser control → Smart App Control status and CodeIntegrity Operational events without changing policy. In particular, events 3077/3089 can identify a denied executable and its signature information. Do not launch the installer as a probe: existing installation scripts may close the app before a later failure. Do not disable SAC, unblock files as a substitute for acceptance, elevate or use force flags. If target policy prevents the isolated signed app from running, retain the denial and stop installation.

## Publishing and the existing endpoint

Use only canonical public sources. A maintainer may, after native verification, create a draft GitHub v0.1.5 release targeting the exact source SHA and upload the signed Windows installer plus windows-lineage.json. Re-read the uploaded asset bytes and hashes before publishing the draft. No tag or release is created by this preparation.

The existing get.dinobot.workers.dev endpoint remains unchanged. Its 0.1.4 latest manifest advertises Windows and two macOS assets. **Do not replace latest.json with a Windows-only 0.1.5 manifest**, and do not label old macOS bytes as 0.1.5. Until matching Mac artifacts exist or a separately verified platform-specific channel contract is introduced, retain global latest.json at 0.1.4. The verified Windows asset may be published as an explicitly Windows-only GitHub release and installed directly after target acceptance; that does not establish automatic update rollout.

Local cf CLI OAuth successfully read the existing R2 releases/latest.json (reported by the orchestrator); write access is unverified. Uploading versioned objects and changing the global manifest are separate actions. Retain the old Mac entries and installation contract; do not reuse private deployment source. A separate official-source endpoint change, with consumer tests, is needed for independent platform rollout.

## Current evidence boundary

This change provides preparation code and tests, not a Windows runtime acceptance result. Core publication, signing credentials, signed installer creation, native profile acceptance, SAC target acceptance, asset upload and live installation remain subsequent stages. No user configuration, installed executable or running daemon is changed here.
