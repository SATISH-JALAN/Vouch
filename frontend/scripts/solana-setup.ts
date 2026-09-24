// One-time setup on a cluster (devnet, or a local test validator): pof-gate's attestor
// allowlist, a demo USDC mint, the pof-credit pool that asks for ≥ 500 ZEC, and a funded vault.
// Idempotent: anything that already exists is left alone. Prints the env lines the site needs.
//
//   SOLANA_RPC_URL=… ADMIN_KEYPAIR=~/.config/solana/id.json ATTESTORS=<b58,…> [THRESHOLD=1] \
//   [MINT=<b58>] node --no-warnings scripts/solana-setup.ts
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { Keypair, PublicKey } from '@solana/web3.js'
import { createMint, getAccount, mintTo } from '@solana/spl-token'
import { blake2b } from '../src/lib/pof/blake2b.ts'
import { utf8 } from '../src/lib/pof/bytes.ts'
import { configPda, connection, initializeIx, initPoolIx, poolPda, send, setAttestorsIx, vaultPda } from '../src/lib/server/solana.ts'

const expand = (p: string) => p.replace(/^~(?=$|[\/])/, os.homedir())
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(expand(process.env.ADMIN_KEYPAIR ?? '~/.config/solana/id.json'), 'utf8')) as number[]))
const attestors = (process.env.ATTESTORS ?? '').split(',').filter(Boolean).map((k) => new PublicKey(k.trim()))
if (!attestors.length) throw new Error('ATTESTORS is required (comma-separated base58 attestor pubkeys)')
const threshold = Number(process.env.THRESHOLD ?? 1)
const maxAge = Number(process.env.MAX_AGE_SLOTS ?? 300)
const conn = connection()

console.error(`admin ${admin.publicKey.toBase58()} · ${(await conn.getBalance(admin.publicKey)) / 1e9} SOL`)

if (await conn.getAccountInfo(configPda())) {
  await send(conn, [setAttestorsIx(admin.publicKey, attestors, threshold, maxAge)], [admin])
  console.error(`pof-gate config updated: ${attestors.length} attestor(s), threshold ${threshold}`)
} else {
  await send(conn, [initializeIx(admin.publicKey, attestors, threshold, maxAge)], [admin])
  console.error(`pof-gate initialised: ${attestors.length} attestor(s), threshold ${threshold}`)
}

const mint = process.env.MINT ? new PublicKey(process.env.MINT) : await createMint(conn, admin, admin.publicKey, null, 6)
const pool = poolPda(mint)
if (!(await conn.getAccountInfo(pool))) {
  const audience = blake2b(utf8('pof-audience:pof-credit:usdc-pool-1'))
  await send(conn, [initPoolIx(admin.publicKey, mint, audience, 50_000_000_000n, 25_000_000_000n)], [admin])
  console.error('pof-credit pool created: ≥ 500 ZEC → 25,000 dUSDC lines')
}
const vault = vaultPda(pool)
const balance = (await getAccount(conn, vault)).amount
if (balance < 1_000_000_000_000n) {
  await mintTo(conn, admin, mint, vault, admin, 10_000_000_000_000n)
  console.error('vault funded with 10,000,000 dUSDC')
}

console.log(`POF_POOL=${pool.toBase58()}`)
console.log(`POF_MINT=${mint.toBase58()}`)
