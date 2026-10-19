# Third-party notices

The root LICENSE applies to first-party Dinobot source, not third-party code, fonts or dependencies. Third-party copyrights and licenses remain unchanged. This project is source-available, not an assertion that all dependencies use the same license.

THIRD_PARTY_INVENTORY.json lists installed dependency names, exact versions, declared licenses and preserved upstream notice paths. LICENSES contains unmodified notices copied from the locked packages. The inventory reflects packages installed on the verification platform; platform-specific optional packages and future distributed Electron/Bun binaries need their own notices reviewed before release. The lockfile remains the complete dependency-resolution record.

Geist and Geist Mono (Fontsource packages) and Pretendard are independently licensed under SIL Open Font License 1.1. Their OFL copyright notices and Reserved Font Name terms remain in LICENSES. Do not apply PolyForm terms to these fonts. Keep OFL notices when distributing generated font assets.

React, React DOM, Vite, TypeScript, Electron, Tailwind CSS, Tabler Icons, KaTeX, highlight.js, marked, react-markdown, remark-gfm, Zustand, Base UI, TanStack Virtual and other dependencies retain their upstream licenses; consult the inventory and actual notices, not this summary, for exact terms. Electron/Chromium and bundled runtime binary notices must accompany any future installer.

The protocol type shapes in packages/contracts/src/messages.ts are mirrored from @earendil-works/pi-ai; its original MIT license is retained in LICENSES/pi-ai-LICENSE (retrieved from the upstream earendil-works/pi repository). packages/contracts/src/durable.ts mirrors @earendil-works/pi-durable 1.0.2; its npm metadata declares MIT but the 1.0.2 archive does not ship a license file. The original MIT license from its declared upstream repository, earendil-works/pi at d2e7d8b7c1d31d3661f769d5caef7ba8d50c3e03, is retained in LICENSES/pi-durable-LICENSE (the same upstream license as pi-ai). These mirrored portions retain their upstream terms.
