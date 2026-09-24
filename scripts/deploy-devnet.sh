#!/usr/bin/env bash
# Deploy pof-gate and pof-credit to Solana devnet under their fixed program ids, then allowlist the
# attestor, create the dUSDC mint and the ≥ 500 ZEC credit pool, and fund the demo relayer.
# Prints the environment the site needs (paste into Vercel).
#
#   ATTESTORS=<attestor pubkey b58>[,…] ./scripts/deploy-devnet.sh
#
# The attestor pubkey is GET <attestor>/v1/pubkey. The deployer is backend/solana/keys/admin.json
# and needs ~5 devnet SOL (two programs ≈ 3.2 SOL of rent, plus setup): https://faucet.solana.com
# Needs: solana CLI, anchor (only if the .so files are missing), node 22+, pnpm.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
KEYS=$ROOT/backend/solana/keys
DEPLOY=$ROOT/backend/solana/target/deploy
URL=${SOLANA_RPC_URL:-https://api.devnet.solana.com}
ADMIN=$KEYS/admin.json
: "${ATTESTORS:?set ATTESTORS to the attestor pubkey(s), from GET <attestor>/v1/pubkey}"

[ -f "$ADMIN" ] || { echo "missing $ADMIN (the deployer and pof-gate admin)"; exit 1; }
for p in pof_gate pof_credit; do
  [ -f "$KEYS/program-$p.json" ] || { echo "missing $KEYS/program-$p.json (the program id keypair)"; exit 1; }
done
if [ ! -f "$DEPLOY/pof_gate.so" ] || [ ! -f "$DEPLOY/pof_credit.so" ]; then
  mkdir -p "$DEPLOY"
  cp "$KEYS/program-pof_gate.json" "$DEPLOY/pof_gate-keypair.json"
  cp "$KEYS/program-pof_credit.json" "$DEPLOY/pof_credit-keypair.json"
  (cd backend/solana && anchor build)
fi

echo "deployer $(solana-keygen pubkey "$ADMIN") · $(solana balance "$(solana-keygen pubkey "$ADMIN")" --url "$URL")"
for p in pof_gate pof_credit; do
  echo "· deploying $p → $(solana-keygen pubkey "$KEYS/program-$p.json")"
  solana program deploy "$DEPLOY/$p.so" --program-id "$KEYS/program-$p.json" \
    --keypair "$ADMIN" --url "$URL" --with-compute-unit-price 10000
done

for k in relayer borrower stranger; do
  [ -f "$KEYS/$k.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "$KEYS/$k.json"
done
echo "· funding the relayer (pays fees for the demo's transactions)"
solana transfer "$(solana-keygen pubkey "$KEYS/relayer.json")" 0.5 --allow-unfunded-recipient \
  --keypair "$ADMIN" --url "$URL" >/dev/null

echo "· pof-gate allowlist, dUSDC mint and the credit pool"
cd frontend
[ -d node_modules ] || pnpm install --frozen-lockfile
OUT=$(SOLANA_RPC_URL=$URL ADMIN_KEYPAIR=$ADMIN ATTESTORS=$ATTESTORS node --no-warnings scripts/solana-setup.ts)

cat <<EOF

Done. Site environment (Vercel → Settings → Environment Variables):

SOLANA_RPC_URL=$URL
SOLANA_CLUSTER=devnet
$OUT
RELAYER_SECRET_KEY=$(tr -d ' \n' < "$KEYS/relayer.json")
BORROWER_SECRET_KEY=$(tr -d ' \n' < "$KEYS/borrower.json")
STRANGER_SECRET_KEY=$(tr -d ' \n' < "$KEYS/stranger.json")

And on the attestor: SOLANA_RPC_URL=$URL
EOF
