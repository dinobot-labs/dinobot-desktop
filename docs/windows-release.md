# Windows 0.1.5 preparation

Desktop 0.1.5 targets official dinobot 0.8.4 and Bun 1.4.3. This is **Dinobot app updating**, not Windows OS reinstallation. Only Windows x64 is built by the manual workflow; no macOS 0.1.5 artifact is claimed.

## Artifact lineage

The Windows package workflow accepts a successful official core Release run ID, at the exact v0.8.4 tag commit. Unrelated CI, other repositories, incomplete runs and runs whose workflow head differs from the tag are rejected. It downloads that run's audited npm archive, compares SHA-512 against CI SHA512SUMS and npm dist.integrity, then records SHA-256. A registry version's existence alone is not source provenance.

Unchanged stage-daemon checks enforce archive digest and package identity, Bun download checksum, installed version, native addon presence and passive browser-protocol compatibility. The package seal binds:

Desktop source SHA → core source SHA/run/tag → tarball SHA-256/npm integrity → packaged daemon marker → installer SHA-256 and observed signature status.

The default is **unsigned**, matching the existing release method. Signing is optional through workflow input sign=true and environment secrets WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD. There is currently no signing infrastructure; introducing it is not a release prerequisite. The seal records signingRequested, installerSigned and individual Authenticode statuses; it never labels unsigned bytes as signed. If signing is requested but unavailable or invalid, that requested signed build fails.

## Build and publication boundaries

1. Publish core 0.8.4 only after its DOS CI finishes. Core preparation uses release-please release-as 0.8.4; versions remain 0.8.3 until the actual release PR.
2. npm Trusted Publisher settings need dinobot-labs/dinobot, release.yml, environment npm. Local npm whoami failure does not test GitHub OIDC. The GitHub npm environment allows main; actual authorized workflow success is still needed.
3. Run source CI before packaging. The Windows workflow adds type and boundary checks, then the existing bytecode hooks. No native UI completion is inferred from these checks.

After authorized integration, not executed by this preparation:

    gh workflow run windows-package.yml --repo dinobot-labs/dinobot-desktop --ref main -f core_run_id=SUCCESSFUL_CORE_RELEASE_RUN_ID -f sign=false
    gh run download WINDOWS_RUN_ID --repo dinobot-labs/dinobot-desktop --name windows-package-DESKTOP_SOURCE_SHA --dir VERIFIED_WINDOWS_OUTPUT

The workflow only uploads build artifacts. It does not publish a release, change the endpoint, run an installer or restart an app. A maintainer may later create a draft GitHub v0.1.5 release targeting the exact source SHA, upload the Windows installer and windows-lineage.json, re-read asset digests, and publish after acceptance. State unsigned explicitly in release notes.

## This PC: preserve the allowed runtime when compatible

The historical application-resource update retained the already allowed Electron executable and replaced app.asar/web resources. It did not reinstall Windows. Do not treat that history as proof that a new artifact is compatible. Do not execute an installer as a probe: the existing install script can close the running app before a policy denial.

The read-only preflight compares every candidate Electron host file and every EXE/DLL/native .node module against installed bytes, allowing app.asar/web/daemon non-native resources to differ:

    bun scripts/resource-compatibility.ts CANDIDATE_WIN_UNPACKED INSTALLED_APP

This conservative preflight changes no files, launches no executable and changes no security policy. A changed/new native module or runtime fails. Rebranding can also change executable bytes; such a failure is not proof of runtime incompatibility and must not be bypassed. A narrower compatibility decision would require independently observed Electron/V8/Node ABI/architecture plus packaged bytecode acceptance on the retained runtime, and a documented review of every differing host file. No such alternate path is automatically selected here.

Before any resource switch, verify the actual packaged app.asar with the existing bytecode audit and retained compatible Electron runtime; confirm native modules, bundled Bun and daemon protocol. Then run the candidate in an isolated Desktop home/profile and daemon configuration, checking DOS blue/black/default persistence, Korean text, keyboard operation and a completed request/tool/result flow. Use no live credentials or sessions for that probe. The parent owns the later shutdown/switch/relaunch step; no installed resource was changed by this preparation.

## SAC and signatures

Authenticode status is evidence, not a guaranteed SAC verdict. Inspect Windows Security → App & browser control → Smart App Control and CodeIntegrity Operational events without changing policy. Events 3077/3089 can identify denied executables and signature information. Do not disable SAC, elevate, force a blocked executable to run, or use file unblocking as an acceptance substitute. If policy blocks the actual intended path, retain the denial and stop that path.

Microsoft signing guidance (retrieved current page; it supports trusted RSA and ECC certificates):
https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control

## Existing download endpoint

Keep get.dinobot.workers.dev unchanged. Its 0.1.4 global latest manifest advertises Windows and two macOS assets. **Do not overwrite it with a Windows-only 0.1.5 manifest or relabel old Mac bytes as 0.1.5.** Until matching Mac artifacts exist or a separately tested platform-specific channel is implemented, retain global latest.json at 0.1.4. A Windows-only GitHub release/direct app update is separate from automatic rollout.

The orchestrator confirmed cf CLI OAuth can read the existing R2 releases/latest.json. Write permission is unverified. Versioned asset upload and global manifest mutation are distinct actions. Use only official public-source deployment code, never private deployment source.

## Unverified stages

Core publication, actual installer build, retained-runtime compatibility, native profile flow, target SAC acceptance, asset publication and installed/running versions require separate evidence. A package marker, passive browser probe, source hash or prepared workflow is not native acceptance.
