# Backend

Nothing here yet. This is where the non-web side of Vouch lands:

- the prover and the verifier (Rust: `pof-core`, `pof-prove`, `pof-verify`)
- the attestor service that signs verdicts for chains that cannot read Zcash (`pof-attest`)
- the Solana programs (`pof-gate`, `pof-credit`)

The Rust crates will need their own Cargo workspace rooted in this folder, so the repo
root stays clean and `pnpm-workspace.yaml` keeps managing only the JavaScript side.
