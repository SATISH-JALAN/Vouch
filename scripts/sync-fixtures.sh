#!/usr/bin/env bash
# Copy what the Rust side produced into the site: real proofs (public/proofs), the anchor table
# and the demo revocation list (src/data). Run after `pof-prove demo fixtures` or `pof-anchor`.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p frontend/public/proofs frontend/src/data
cp fixtures/proofs/*.pof frontend/public/proofs/
node -e '
const fs = require("fs")
const read = (p) => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : []
const all = [...read("fixtures/anchors.mainnet.json"), ...read("fixtures/anchors.testnet.json"), ...read("fixtures/anchors.demo.json")]
fs.writeFileSync("frontend/src/data/anchors.json", JSON.stringify(all, null, 2) + "\n")
fs.copyFileSync("fixtures/revocations.demo.json", "frontend/src/data/revocations.demo.json")
console.log(`anchors: ${all.length} records · proofs: ${fs.readdirSync("frontend/public/proofs").length}`)
'
