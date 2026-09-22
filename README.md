# Vouch

Prove one fact about shielded ZEC — a balance threshold, a settled payment — without handing over a viewing key.

## Layout

One folder per part of the system. The root holds nothing but the files that must live there.

| Folder     | What it is                                                     |
| ---------- | -------------------------------------------------------------- |
| `frontend` | The site: Next.js 15, React 19, Tailwind v4, GSAP + Lenis.      |
| `backend`  | The prover, the verifier, the attestor service and the on-chain programs. |

Each folder owns its own dependencies and config, so there is no workspace file at the root.

## Running the site

Requires Node 20+ and pnpm 10.

```bash
cd frontend
pnpm install
pnpm dev        # http://localhost:3000
pnpm build      # production build
pnpm typecheck
```
