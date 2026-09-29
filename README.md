# Vouch

**Prove one fact about your shielded ZEC — "I hold at least 500 ZEC" — to one audience, for a limited time, without handing over a viewing key.**

A viewing key discloses every note, amount and memo, past and future, to whoever receives it, forever. Vouch replaces it with a single-purpose proof: a small `.pof` file (11.9 KB) that says one thing, to one named verifier, until one expiry, and that the holder can revoke. Anyone checks it in the browser in about 100 ms, against roots rebuilt from public Zcash data. For chains that cannot read Zcash, an attestor signs the verdict and a Solana program gates credit on it.

Built for the Colosseum Crypto World's Fair, Zcash track.

## What is real

| Piece | Status |
| --- | --- |
| Threshold circuit | The Zcash shielded-voting delegation circuit (Halo2, no trusted setup), extended with one public input so it proves `sum ≥ threshold` without revealing the sum. Real proofs, with tampering tests. |
| Verifier | One Rust implementation, compiled natively (CLI, attestor) and to WASM (the site). All three agree on every test vector, and CI checks it. |
| Anchors | `nc_root` and `nf_root` rebuilt from lightwalletd compact blocks. The mainnet anchor at height 3,493,000 and the testnet anchor at 4,410,000 both match lightwalletd's own tree root. |
| Prover | CLI: seed → trial-decrypt your Ironwood notes → proof. The key never leaves the process, and a test checks that the prover links no network client. |
| On Solana | `pof-gate` (Ed25519 attestations, k-of-n, per-proof receipts bound to the holder's wallet) and `pof-credit` (opens a credit line from a receipt, then pays out draws up to its limit). 18 LiteSVM tests: replay, stranger wallet, forged signer, foreign offsets, k-of-n and more. |
| Demo | The site's demo holder proves live against a **demo ledger**: a synthetic tree with real keys, real notes and real proofs, labelled `demo` wherever it appears. Beside it, `fixtures/proofs/testnet-valid.pof` is a real proof from a real **Zcash testnet** wallet (holds ≥ 1 TAZ, anchored at block 4,410,000), one click away on `/verify`. TAZ has no monetary value, and the verifier says so. |

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
SITE=http://localhost:3000 node scripts/e2e.mjs   # 20 end-to-end checks, in another shell
```

The CLIs (`pof-prove`, `pof-verify`, `pof-anchor`) for Linux, macOS and Windows are on the [releases page](https://github.com/SATISH-JALAN/Vouch/releases/latest), built by [.github/workflows/release.yml](.github/workflows/release.yml) from each `v*` tag. Or build them from `backend/` as below.

Prove with your own wallet on mainnet:

```bash
cd backend
cargo run --release -p pof-anchor -- scan    # lightwalletd → target/snapshots/mainnet-<h>.vsnp + ../fixtures/anchors.mainnet.json
../scripts/sync-fixtures.sh                     # copy the anchor into the site's table
# commit, then redeploy the attestor and the site (see Deploy): each trusts only the anchors it shipped with
cargo run --release -p pof-prove -- prove \
  --request '<link from /request>' --snapshot target/snapshots/mainnet-<h>.vsnp \
  --seed-file ~/seed.txt --out proof.pof
```

On Zcash testnet (TAZ, free from a faucet; Ironwood active since block 4,134,000), the same steps with `--network testnet`:
`pof-anchor` then uses `https://testnet.zec.rocks:443`, starts at testnet activation and writes `target/snapshots/testnet-<h>.vsnp` +
`../fixtures/anchors.testnet.json`; `pof-prove` takes the network (ZIP 32 coin type 1) from the snapshot.

```bash
cargo run --release -p pof-anchor -- scan --network testnet
cargo run --release -p pof-anchor -- check --snapshot target/snapshots/testnet-<h>.vsnp
../scripts/sync-fixtures.sh
cargo run --release -p pof-prove -- prove --request '<link>' --snapshot target/snapshots/testnet-<h>.vsnp --seed-file ~/testnet-seed.txt --out proof.pof
```

Verifiers label a testnet anchor as such: a real proof over real testnet notes, which have no monetary value.

## Tests

| Command | What it checks |
| --- | --- |
| `cargo test --release --workspace` (in `backend/`) | Format, verifier on every vector, embedded verifying key, IMT, the no-network invariants |
| `cargo test --release -p pof-zk --features prove --test roundtrip -- --ignored` | Real proofs: threshold round trip and every tampering case |
| `cargo test --release -p pof-prove --test wallet -- --ignored` | Seed → note discovery → proof → `Valid` |
| `cargo test -p pof-solana-tests` (in `backend/solana/`) | The programs against LiteSVM, including the attacks |
| `pnpm test:fixtures` · `pnpm test:wasm` (in `frontend/`) | TypeScript codec ≡ Rust encoder; the committed WASM the site serves ≡ native verdicts, and every result matches [/schema/pof-v1.json](frontend/public/schema/pof-v1.json) |
| `pnpm e2e` | The full path through the site's API, with every breaker |

CI runs all of these except `pnpm e2e`, which needs a running stack ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Deploy

- **Attestor:** [backend/Dockerfile](backend/Dockerfile) and [backend/fly.toml](backend/fly.toml) (commands are in the file header).
- **Programs:** `POF_ATTEST_URL=https://<attestor> [ATTESTORS=<b58,…>] ./scripts/deploy-devnet.sh`. It rebuilds and deploys under the fixed program ids (the admin keeps the upgrade authority, which `initialize` requires), copies the IDLs, allowlists the attestor (read from `/v1/pubkey` when `ATTESTORS` is unset), creates the pool with the mint kept in `backend/solana/keys/mint.json`, and prints the site's environment.
- **Site:** Vercel, root `frontend/`, with the variables in [frontend/.env.example](frontend/.env.example).

## Status: not production ready

This is a hackathon build. It has not been audited: not the circuit modification, the programs or the attestor. The attestor is a trusted party for the chains it serves (k-of-n reduces that trust, but does not remove it). Proofs today cover `HoldsAtLeast` over up to five notes. Payment proofs and "received since" claims are designed but not built, and the site shows them as disabled.

## Licence

MIT OR Apache-2.0, at your option. Vendored crates keep their own licences; see [THIRD-PARTY.md](THIRD-PARTY.md).
