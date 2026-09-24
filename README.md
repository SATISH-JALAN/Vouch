# Vouch

**Prove one fact about your shielded ZEC — "I hold at least 500 ZEC" — to one audience, for a limited time, without handing over a viewing key.**

A viewing key discloses every note, amount and memo, past and future, to whoever receives it, forever. Vouch replaces it with a single-purpose proof: a small `.pof` file (11.9 KB) that says one thing, to one named verifier, until one expiry, and that the holder can revoke. Anyone checks it in the browser in about 100 ms, against roots rebuilt from public Zcash data. For chains that cannot read Zcash, an attestor signs the verdict and a Solana program gates credit on it.

Built for the Colosseum Crypto World's Fair, Zcash track.

## What is real

| Piece | Status |
| --- | --- |
| Threshold circuit | The Zcash shielded-voting delegation circuit (Halo2, no trusted setup), extended with one public input so it proves `sum ≥ threshold` without revealing the sum. Real proofs, with tampering tests. |
| Verifier | One Rust implementation, compiled natively (CLI, attestor) and to WASM (the site). All three agree on every test vector, and CI checks it. |
| Anchors | `nc_root` and `nf_root` rebuilt from lightwalletd compact blocks. The mainnet anchor at height 3,493,000 matches lightwalletd's own tree root. |
| Prover | CLI: seed → trial-decrypt your Ironwood notes → proof. The key never leaves the process, and a test checks that the prover links no network client. |
| On Solana | `pof-gate` (Ed25519 attestations, k-of-n, per-proof receipts bound to the holder's wallet) and `pof-credit` (opens a credit line from a receipt). 11 LiteSVM tests: replay, stranger wallet, forged signer, foreign offsets, k-of-n and more. |
| Demo | The site's demo holder proves live against a **demo ledger**: a synthetic tree with real keys, real notes and real proofs, labelled `demo` wherever it appears. A mainnet proof needs a funded Ironwood wallet (see the status section below). |

## How it works

```
 holder (pof-prove)                     verifier (browser · CLI · attestor)
 ──────────────────                     ────────────────────────────────────
 notes ─┐                               .pof ─► checksum, format
 keys  ─┼─► Halo2 proof                        ► audience hash   = mine?
 claim ─┘   + RedPallas sig ─► .pof            ► expiry, revocation
            bound to:                          ► anchor          = published roots?
            claim·audience·expiry·anchor       ► signature, then the proof
            (and a Solana wallet, if asked)    ─► Valid | Expired | Revoked | WrongAudience | …

 attestor: Valid + bound ─► Ed25519 over 139 bytes ─► pof-gate receipt ─► pof-credit line
```

The statement (claim, audience hash, binding, anchor, expiry, revocation tag) is hashed into the circuit's round id, so changing any field invalidates the proof. The details are on the site under `/docs`: the format, the trust model and the attestor protocol.

## Layout

| Path | What it is |
| --- | --- |
| [frontend/](frontend/) | The site (Next.js 15): verifier, request builder, prover console, the live Solana demo, docs. |
| [backend/crates/](backend/crates/) | `pof-core` (format) · `pof-zk` (circuit glue) · `pof-verify` (verifier + CLI) · `pof-prove` (prover CLI) · `pof-anchor` (anchor indexer) · `pof-attest` (attestor service) · `pof-wasm` (browser build). |
| [backend/solana/](backend/solana/) | `pof-gate` and `pof-credit` (Anchor 1.2), LiteSVM tests. |
| [backend/vendor/](backend/vendor/) | Vendored crates carrying marked Vouch modifications ([THIRD-PARTY.md](THIRD-PARTY.md)). |
| [fixtures/](fixtures/) | Test vectors (real proofs) with their expected verdicts, anchor tables, the demo ledger. |
| [scripts/](scripts/) | WASM build, fixture sync, parity check, end-to-end test, local stack, devnet deploy. |

## Quick start

The site alone (in-browser verifier, committed WASM and fixtures):

```bash
cd frontend && pnpm install && pnpm dev     # http://localhost:3000
```

Check a proof from the command line:

```bash
cd backend
cargo run --release -p pof-verify -- check ../fixtures/proofs/valid.pof \
  --audience pof-credit:usdc-pool-1 --anchors ../fixtures/anchors.demo.json \
  --revocations ../fixtures/revocations.demo.json --now 1790208000
```

The whole stack (validator with both programs, attestor, demo holder, site in LIVE mode). It runs on Linux, macOS or WSL:

```bash
(cd backend/solana && anchor build)
./scripts/dev-stack.sh                       # open http://localhost:3000/demo
SITE=http://localhost:3000 node scripts/e2e.mjs   # 17 end-to-end checks, in another shell
```

Prove with your own wallet on mainnet:

```bash
cd backend
cargo run --release -p pof-anchor -- scan --out target/snapshots \
  --table ../fixtures/anchors.mainnet.json                         # snapshot + anchor from lightwalletd
cargo run --release -p pof-prove -- prove \
  --request '<link from /request>' --snapshot target/snapshots/mainnet-<h>.vsnp \
  --seed-file ~/seed.txt --out proof.pof
```

## Tests

| Command | What it checks |
| --- | --- |
| `cargo test --release --workspace` (in `backend/`) | Format, verifier on every vector, embedded verifying key, IMT, the no-network invariants |
| `cargo test --release -p pof-zk --features prove -- --ignored` | Real proofs: threshold round trip and every tampering case |
| `cargo test --release -p pof-prove --test wallet -- --ignored` | Seed → note discovery → proof → `Valid` |
| `cargo test -p pof-solana-tests` (in `backend/solana/`) | The programs against LiteSVM, including the attacks |
| `pnpm test:fixtures` · `pnpm test:wasm` (in `frontend/`) | TypeScript codec ≡ Rust encoder; WASM ≡ native verdicts |
| `pnpm e2e` | The full path through the site's API, with every breaker |

CI runs all of these except `pnpm e2e`, which needs a running stack ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Deploy

- **Attestor:** [backend/Dockerfile](backend/Dockerfile) and [backend/fly.toml](backend/fly.toml) (commands are in the file header).
- **Programs:** `ATTESTORS=<attestor pubkey> ./scripts/deploy-devnet.sh`. It deploys under the fixed program ids, allowlists the attestor, creates the pool and prints the site's environment.
- **Site:** Vercel, root `frontend/`, with the variables in [frontend/.env.example](frontend/.env.example).

## Status: not production ready

This is a hackathon build. It has not been audited: not the circuit modification, the programs or the attestor. The attestor is a trusted party for the chains it serves (k-of-n reduces that trust, but does not remove it). Proofs today cover `HoldsAtLeast` over up to five notes. Payment proofs and "received since" claims are designed but not built, and the site shows them as disabled.

## Licence

MIT OR Apache-2.0, at your option. Vendored crates keep their own licences; see [THIRD-PARTY.md](THIRD-PARTY.md).
