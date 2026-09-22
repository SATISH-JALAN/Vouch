# web — Vouch frontend

Next.js 15 (App Router) · React 19 · Tailwind v4 · GSAP + Lenis · zustand. pnpm only. No Framer Motion, no WebGL.

```bash
pnpm install          # from the repo root
pnpm dev              # http://localhost:3000
pnpm --filter web build
pnpm --filter web test:fixtures   # fixture verifier sanity checks (13 cases + 20 tampered runs)
```

## Fixtures first

Every page renders from `src/lib/data/fixtures.ts` with no wallet, WASM or network.
`src/lib/data/adapter.ts` is the single switch:

- `NEXT_PUBLIC_POF_WASM=1` → `live.ts`: loads `public/wasm/pof_wasm.js` (wasm-pack `--target web` output of `crates/pof-wasm`) lazily on first verify.
- `POF_ATTEST_URL=https://…` → `/api/attest` proxies to `pof-attest`. Unset, the demo shows "attestor unreachable" rather than spinning.

What the fixture verifier really does: parses the `.pof` format, recomputes the blake2b-256 checksum, and checks expiry and audience.
Revocation, the anchor and the Halo2 proof are compared against committed vectors. Every verdict surface says so via `<SourceNote>`.

Vectors anchor to real Zcash mainnet block 3,491,040 (hash in `src/lib/data/chain.ts`); the tree root and evidence bytes are fixture material.
They regenerate per UTC day so "valid for 7 days" and "expired 3 days ago" stay true whenever the site is opened.

## Before submission

- `src/lib/site.ts`: set `LINKS.repo` and `LINKS.forum`. Links that are `null` are not rendered.
- Set `NEXT_PUBLIC_SITE_URL` on Vercel so the OG image resolves to an absolute URL.
- Open `/opengraph-image` in a browser.

Fonts: Instrument Serif and Geist Mono via `next/font/google`; Switzer (Fontshare, ITF FFL) self-hosted in `src/fonts` so the fallback is size-matched (no CLS). `src/og-fonts` holds TTFs for the OG renderer.

## Visuals

`public/visuals/` holds the web-ready paintings and hero loops (WebP, MP4/WebM without audio). `visuals-src/` holds the original PNG/MP4 exports and is not served.
Prompts and art direction: `docs/Visual Direction — Image Prompts.md`.

- The oval plates (`step-*.webp`, `not-found.webp`) have their paper recoloured to exactly `#F3F1EA` and are served `unoptimized`. Next's re-encode would shift that colour and show a box around them. If you replace one, re-run the same colour match.
- The hero video is added client-side only when motion is allowed and data saver is off; it pauses off-screen. The painting underneath is the LCP.
