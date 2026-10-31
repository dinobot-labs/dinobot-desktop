<p align="center">
  <img src=".github/assets/logo.svg" alt="Dinobot logo" width="160">
</p>

# Dinobot Desktop

**A desktop interface for Dinobot.**

Follow conversations, respond to agent questions and inspect generated files in an Electron app with a React interface. Desktop is a client: a compatible Dinobot daemon runs the agent.

[English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md)

Source-available under [PolyForm Noncommercial 1.0.0](LICENSE). Not OSI open source; commercial use requires separate permission from the relevant rights holders.

## See it in action

https://github.com/user-attachments/assets/1955b0cb-3f0f-4266-b968-35b7844964b7

## Choose your interface

- **Desktop — this repository.** A graphical client, Electron integration and shared React UI components.
- **Core + terminal UI (TUI).** The agent daemon and terminal interface, maintained separately.

Dinobot core and TUI
https://github.com/dinobot-labs/dinobot

## What the interface brings together

| Area | In the client |
| --- | --- |
| Conversations | Send text, images and files; answer agent questions and stop a running turn. File attachments assume the daemon runs on the same machine. |
| Generated files | Inspect supported local artifacts, including image and HTML previews, beside the conversation. |
| Settings and usage | Access account, model, plugin and daemon settings. Context usage displays provider-reported token counts when available, not a guessed breakdown. |

Availability depends on the connected daemon and runtime. The shared UI has a separate styleguide for component development.

## Start with the source

**This repository currently supports source builds, not a public installer.** The historical daemon pin `0.7.15-local.browser.1` is not a publicly downloadable release. The source build alone does not produce an installable application.

Requirements: **Bun 1.4.3**, **Node.js 22+** and **Git**. From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check:public
bun run typecheck
bun run test
bun run build
```

The build produces the renderer, styleguide and Electron main/preload bundles. It does not download a daemon, build an installer, publish a release or require a private repository. Dependency lifecycle scripts are deliberately disabled; source builds and synthetic unit tests need no model credentials.

For interface development, run either command from the repository root:

```sh
bun run dev
bun run dev:styleguide
```

The renderer expects a compatible local daemon. Running Electron locally also requires its upstream runtime installer to be run separately; that download is outside source-only verification. See [Development](docs/wiki/Development.md) for the project layout and runtime boundary.

Installer commands such as `dist`, `dist:win`, `dist:mac` and `stage:daemon` in `apps/desktop` are retained for future packaging work, not supported public-installer instructions. See [Release](docs/wiki/Release.md) before attempting packaging.

## Runtime and privacy boundaries

- Model credentials and paid services are not included. A local interface does not mean every operation stays offline; the connected daemon and configured providers determine external requests.
- Production reporting services and private deployment systems are outside this source repository. The problem-report interface needs a core exposing `dinobot report consent|agree|send --json`; synthetic tests do not verify a production reporting service.
- For issues, share a minimal synthetic reproduction, not session exports, tokens or personal screenshots. Report vulnerabilities privately as described in [Security](SECURITY.md).

## Explore and contribute

- [Development guide](docs/wiki/Development.md) · [Wiki source](docs/wiki/Home.md) · [Release boundary](docs/wiki/Release.md)
- [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Security](SECURITY.md)
- [Licensing guide](docs/wiki/Licensing.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

`main` is maintained source, not a frozen export. [Public source provenance](PUBLIC_SNAPSHOT.md) and [Source provenance data](SOURCE_PROVENANCE.json) distinguish the current source delta, historical export and unchanged packaging-version fields. [Source hashes](SOURCE_HASHES.json) record canonical Git-blob bytes: `bun scripts/source-hashes.ts --check` checks the staged index, or accepts a revision to check its tree.

## License

Free for uses permitted by [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires separate permission from the relevant rights holders. Dependencies and fonts retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).

Licensing and security contact: dev0jsh@gmail.com.
