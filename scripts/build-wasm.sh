#!/usr/bin/env bash
# Build pof-wasm and emit bindings: web → frontend/public/wasm, nodejs → backend/target/wasm-node.
# Always run before `pnpm build` in frontend: a stale verifier is the classic phantom bug.
set -euo pipefail
cd "$(dirname "$0")/.."
# cargo picks the toolchain from the working directory: build from backend/ so rust-toolchain.toml applies
(cd backend && cargo build --release --target wasm32-unknown-unknown -p pof-wasm)
WASM=backend/target/wasm32-unknown-unknown/release/pof_wasm.wasm
wasm-bindgen "$WASM" --target web --out-dir frontend/public/wasm --no-typescript
wasm-bindgen "$WASM" --target nodejs --out-dir backend/target/wasm-node --no-typescript
if command -v wasm-opt >/dev/null; then
  wasm-opt -O3 frontend/public/wasm/pof_wasm_bg.wasm -o frontend/public/wasm/pof_wasm_bg.wasm
fi
ls -la frontend/public/wasm
