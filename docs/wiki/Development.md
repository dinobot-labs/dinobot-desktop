# Development

Requirements: Bun 1.4.3, Node.js 22+, Git. From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check:public
bun run typecheck
bun run test
bun run build
```

Public CI performs source build, not installers. The renderer and styleguide can be developed with bun run dev and bun run dev:styleguide. The renderer expects a compatible local daemon; no credentials are needed for the source build or synthetic unit tests. Dependency install scripts are deliberately disabled. To run Electron locally, its upstream runtime installer must be run separately; that download is not part of source-only verification.

packages/contracts defines client wire types; packages/ui contains shared components; apps/web is the renderer; apps/styleguide is the visual catalog; apps/desktop contains Electron integration.

Synthetic replay scenarios replace excluded real session captures. No production reports, private distribution workers, deployment scripts, session archives or generated binaries are included.
