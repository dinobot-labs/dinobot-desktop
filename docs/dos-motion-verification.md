# DOS progress motion verification

## Scope and invariant

Base: public/main `e668be6` (dinobot-labs/dinobot-desktop). This checkout was independently installed with `bun install --frozen-lockfile`; `bun scripts/dos-resolution.ts` confirmed both UI code and stylesheet resolved inside this worktree. No installed application, user window, daemon or model was used. LSP was unavailable; references were enumerated by repository search.

The closed change is the DOS animation override and the existing `.dn-spin` consumers: `Spinner` and the running `StatusMark` (also rendered by `ToolCall`). No React state ownership, stream timing, tool execution, typography or Composer alignment changes.

Invariant: in normal motion, running/loading glyphs change rotation over time; done/failed remove the running glyph and expose their accessible status. With reduced motion, running glyphs remain readable but static. DOS decorative animation and all transitions stay disabled.

## RED and cause

`bun scripts/dos-motion.e2e.ts --measure` on the base stylesheet produced **5 failed behavioral checks**: both actual Spinner and ToolCall status glyphs were stationary in both DOS colors, and a mounted DOS spinner did not resume after changing reduced-motion back to no-preference. Each stationary glyph had three `transform: none` observations 130 ms apart and no browser animation. Default/light rotated normally; reduced-motion and done/failed checks passed.

Cause: the DOS descendant `animation: none !important` override also suppressed functional `.dn-spin` glyphs. The minimal fix excludes that class from animation suppression, retaining transition suppression separately. The existing motion stylesheet remains responsible for reduced-motion; no duplicate spinner keyframes/timing are introduced.

## GREEN

The same real-Chrome regression and measurement run passed after the stylesheet change. Additional behavioral coverage checks that decorative animations remain off. The script exercises actual UI components and the production settings/theme hook in a local fixture, not an external agent run.

Also passed:

- `DEEPWORK_TYPECHECK_JOBS=2 bun run typecheck`
- `DEEPWORK_TYPECHECK_JOBS=2 bun run --cwd apps/web build`
- `bun scripts/dos-theme.e2e.ts` — theme settings, persistence, five tool states, keyboard activation/focus and local approval fixture
- `bun scripts/dos-app.e2e.ts` — built full web app with explicit local protocol mock; settings, DOS colors, persistence, tool expansion, approval and reduced-motion
- `bun test packages/ui/test apps/web/test/settings.test.ts apps/web/test/typography.test.ts` — 92 pass, 0 fail

## Performance measurement (not a performance-fix claim)

Windows, Chrome 156.0.8078.74 headless, 1440×1000, Vite development build. Identical workload per theme: 80 expanded real ToolCalls (4 running), 120 animation-frame-driven text updates plus scrolling; 30 warmup frames, five samples/theme, alternating forward/reverse theme order. Metrics are browser frame intervals and CDP main-thread task duration. Each sample has 119 intervals after removing the initial interval.

Values below are medians of five samples; brackets are sample min–max. Task duration is total milliseconds per 120-update sample, not response latency.

| Version / theme | Frame interval median ms | Frame p95 ms | Main-thread task ms |
| --- | ---: | ---: | ---: |
| Base / default light | 17.7 [15.9–19.4] | 30.3 [26.1–33.3] | 2161 [1909–2388] |
| Base / DOS blue | 14.3 [12.5–16.3] | 26.6 [25.6–33.7] | 1770 [1586–2024] |
| Base / DOS black | 15.8 [13.0–17.2] | 27.4 [22.7–31.2] | 1948 [1655–2143] |
| Fixed / default light | 17.3 [14.4–19.8] | 30.5 [28.2–33.6] | 2123 [1842–2455] |
| Fixed / DOS blue | 14.7 [13.3–17.8] | 26.5 [24.0–32.2] | 1739 [1637–2185] |
| Fixed / DOS black | 14.1 [13.5–15.5] | 26.2 [24.2–28.0] | 1773 [1678–1873] |

This workload did **not reproduce DOS being slower than default**. The small before/after differences overlap run variability and are not evidence of a speedup. Restoring the spinner adds expected style-animation work (DOS style duration median 0 ms before, approximately 13.5–13.8 ms after per sample). No speculative performance optimization was made. The user-perceived slowdown in the installed Electron app remains unattributed: this measurement excludes its GPU/window compositor, long conversation virtualization, live stream/network timing and background workloads.

## Repeat / evidence

From the worktree root, install dependencies if needed, then run the commands above. The focused command without `--measure` runs only behavioral checks; with it, measurements are also included. It creates its own headless Chrome and loopback Vite server and closes both in `finally`. The report is written to ignored `test-results/dos-motion/report.json`; generated reports and screenshots must not be committed. Original local RED/GREEN reports were retained as `test-results/dos-motion/red.json` and `green.json`.

To independently replay RED, use a separate worktree at `e668be6`, copy only `scripts/dos-motion.e2e.ts` into it, install dependencies there, and run it. Do not change the verified checkout or an installed app.
