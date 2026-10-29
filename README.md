<p align="center">
  <img src=".github/assets/logo.svg" alt="Dinobot logo" width="160">
</p>

# Dinobot Desktop

Source-available Electron desktop client for Dinobot, with a React interface and shared UI components. Free for uses permitted by PolyForm Noncommercial 1.0.0; not OSI open source. Commercial use requires separate permission from the relevant rights holders. Contact: dev0jsh@gmail.com.

## Demo

https://github.com/user-attachments/assets/1955b0cb-3f0f-4266-b968-35b7844964b7

## Build the source

Install Bun 1.4.3 and Node.js 22 or newer.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check:public
bun run typecheck
bun run test
bun run build
```

The build produces the renderer, styleguide and Electron main/preload bundles. It does not download a daemon, build an installer, publish a release or require a private repository. Dependency lifecycle scripts are disabled for this build.

The Desktop application needs a compatible Dinobot daemon to run; the source build alone is not an installable release. The pinned local daemon version is historical, not a publicly downloadable release. Installer commands in apps/desktop are retained for future packaging work and are not supported by public CI. See docs/wiki/Development.md and docs/wiki/Release.md.

`main` is maintained source, not a frozen export. PUBLIC_SNAPSHOT.md and SOURCE_PROVENANCE.json separate the current source delta from the historical export and unchanged packaging-version fields. SOURCE_HASHES.json records canonical Git-blob bytes; `bun scripts/source-hashes.ts --check` checks the staged index (or pass a revision to check its tree).

Core and TUI repository
https://github.com/dinobot-labs/dinobot

Desktop repository
https://github.com/dinobot-labs/dinobot-desktop

## Contribute

Read CONTRIBUTING.md, CODE_OF_CONDUCT.md and SECURITY.md. Wiki source is in docs/wiki. File minimal synthetic reproductions, not session exports, tokens or personal screenshots. See THIRD_PARTY_NOTICES.md for independently licensed dependencies and fonts.
