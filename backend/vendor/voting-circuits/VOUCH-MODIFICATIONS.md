# Vouch modifications to voting-circuits 0.12.1

Vendored from crates.io `voting-circuits` 0.12.1 (Valar Group, MIT OR Apache-2.0).
Licence files and notices are unchanged. Every change is marked `VOUCH MODIFICATION` in the source.

| File | Change |
| --- | --- |
| `src/delegation/circuit.rs` | New public input at offset 14, `min_ballots`. Condition 8 additionally witnesses `excess = num_ballots - min_ballots`, constrains `excess + min_ballots == num_ballots`, and range-checks `excess` to 30 bits. `Instance` gains `min_ballots` (default 0) and `with_min_ballots`. |
| `src/delegation/builder.rs`, `circuit.rs` tests | Shape tripwires updated from 14 to 15 public inputs. |
| `src/delegation/prove.rs` | Added `vouch_threshold` real-proof test. |

With `min_ballots = 0` the statement is identical to upstream. The verifying key differs from upstream
because the constraint system changed; Halo2 over Pasta uses IPA, so there is no trusted setup and the
new key is derived deterministically from the circuit.
| `src/delegation/imt.rs`, `mod.rs` | Added `DenseImtProvider`: the same canonical punctured-range IMT over any number of nullifiers (upstream's provider is a 32-leaf fixture). Test `dense_matches_spaced_fixture`. |
