// End to end through the site's own API, the way /demo and /prove drive it:
// demo holder proves (bound to the borrower) → WASM verifies → attestor signs → pof-gate
// records a receipt → pof-credit opens a line. Then every breaker: replay, another wallet,
// a tampered attestation, a tampered proof, and a revoked proof.
//
//   SITE=http://localhost:3000 node scripts/e2e.mjs
//
// SOLANA_RPC_URL defaults to the local validator (localnet) or public devnet, from /api/status.
import { readFileSync } from 'node:fs'
import * as wasm from '../frontend/public/wasm/pof_wasm.js'
import { reseal } from '../frontend/src/lib/pof/codec.ts'
wasm.initSync({ module: readFileSync(new URL('../frontend/public/wasm/pof_wasm_bg.wasm', import.meta.url)) })

const SITE = process.env.SITE ?? 'http://localhost:3000'
const AUDIENCE = 'pof-credit:usdc-pool-1'
let fail = 0
const check = (name, ok, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
async function post(path, body) {
  try {
    const r = await fetch(SITE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) })
    return { status: r.status, body: await r.json().catch(() => null) }
  } catch (err) {
    return { status: 0, body: { error: `${path}: ${err.cause?.code ?? err.message}` } }
  }
}
/** GET → parsed body, or null (and a line saying why) when the route is down or not 2xx. */
async function get(path, as = 'json') {
  try {
    const r = await fetch(SITE + path, { signal: AbortSignal.timeout(30_000) })
    if (r.ok) return await r[as]()
    console.log(`     GET ${path}: HTTP ${r.status}`)
  } catch (err) {
    console.log(`     GET ${path}: ${err.cause?.code ?? err.message}`)
  }
  return null
}
async function verify(proof) {
  if (typeof proof !== 'string') return { verdict: { kind: 'no proof to verify' } }
  const anchors = await get('/api/anchors', 'text')
  const revoked = (await get('/api/revocations'))?.secrets
  if (anchors === null || !revoked) return { verdict: { kind: 'anchors or revocations unavailable' } }
  const bytes = new TextEncoder().encode(proof)
  return JSON.parse(wasm.verify(bytes, AUDIENCE, BigInt(Math.floor(Date.now() / 1000)), anchors, JSON.stringify(revoked)))
}
const request = { v: 1, claim: 'HoldsAtLeast', zatoshi: '50000000000', audience: AUDIENCE, expiryDays: 7, bind: 'solana' }

const status = await get('/api/status')
check('services are live', Boolean(status?.attestor?.ok && status.demoProver && status.solana), JSON.stringify(status?.solana ?? status?.attestor))
const RPC = process.env.SOLANA_RPC_URL ?? (status?.solana?.cluster === 'localnet' ? 'http://127.0.0.1:8899' : 'https://api.devnet.solana.com')
async function lamports(account) {
  try {
    const body = { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [account, { commitment: 'confirmed' }] }
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
    return (await r.json()).result?.value ?? null
  } catch {
    return null
  }
}

const { body: b } = await post('/api/relay', { action: 'borrower' })
const borrower = b?.borrower
check('relayer names the borrower', Boolean(borrower), borrower ?? b?.error)

async function freshProof() {
  const t = Date.now()
  const r = await post('/api/demo-prove', { request, bindSolana: borrower })
  check('demo holder proves', r.status === 200 && typeof r.body?.proof === 'string', r.status === 200 ? `${r.body?.notesUsed} note(s), ${r.body?.provingMs} ms prove, ${Date.now() - t} ms round trip` : r.body?.error ?? `HTTP ${r.status}`)
  return r.body ?? {}
}

// 1 · the proof
const p1 = await freshProof()
const v1 = await verify(p1.proof)
check('browser verifier says Valid', v1.verdict.kind === 'Valid', v1.verdict.kind === 'Valid' ? `${v1.anchor?.network} anchor ${v1.anchor?.height}` : v1.verdict.kind)

// 2 · the attestation
const a1 = await post('/api/attest', { proof: p1.proof })
const att = a1.body?.attestation
check('attestor signs', a1.status === 200 && Boolean(att), att ? `slot ${att.slot}` : a1.body?.error ?? `HTTP ${a1.status}`)

// 3 · the transaction
const s1 = await post('/api/relay', { action: 'submit', attestation: att })
const receipt = s1.body?.tx?.receipt
check('pof-gate records a receipt', s1.status === 200 && Boolean(receipt), receipt ?? s1.body?.error)

// 4 · the line. The relayer pays the fee and the line's rent, so the borrower needs no SOL.
const before = borrower ? await lamports(borrower) : null
const l1 = await post('/api/relay', { action: 'open-line', receipt })
check('pof-credit opens the line', l1.status === 200, l1.body?.line?.limit ?? l1.body?.error)
const after = borrower ? await lamports(borrower) : null
check("the borrower's balance is untouched (the relayer pays)", before !== null && after === before, `${before} → ${after} lamports via ${RPC}`)

// breakers
const r2 = await post('/api/relay', { action: 'submit', attestation: att })
check('replay is refused', r2.status === 422, r2.body?.failedAt ?? r2.body?.error)
const w2 = await post('/api/relay', { action: 'open-line', receipt, wallet: 'stranger' })
check('another wallet is refused', w2.status === 422 && /bound|consumed/i.test(w2.body?.error ?? ''), w2.body?.error)

const p2 = await freshProof()
const a2 = await post('/api/attest', { proof: p2.proof })
check('attestor signs the second proof', a2.status === 200 && Boolean(a2.body?.attestation), a2.body?.error ?? `HTTP ${a2.status}`)
const t2 = await post('/api/relay', { action: 'submit', attestation: a2.body?.attestation, tamper: true })
check('tampered attestation fails at the Ed25519 instruction', t2.status === 422 && /Instruction 0/.test(t2.body?.failedAt ?? ''), t2.body?.failedAt ?? t2.body?.error)

// flip one byte of Halo2 evidence and re-seal the checksum, as a forger would
let tp = { status: 0, body: { error: 'no proof to tamper with' } }
if (typeof p2.proof === 'string') {
  const bytes = Buffer.from(p2.proof, 'base64url')
  bytes[bytes.length - 32 - 64 - 2000] ^= 1
  tp = await post('/api/attest', { proof: Buffer.from(reseal(bytes)).toString('base64url') })
}
check('tampered proof is refused as ProofInvalid', tp.status === 422 && tp.body?.verdict?.kind === 'ProofInvalid', tp.body?.verdict?.kind ?? tp.body?.error)

const p3 = await freshProof()
const rv = await post('/api/revocations', { secret: p3.revocationSecret })
check('revocation accepted', rv.status === 201 || rv.status === 200, rv.body?.error)
const v3 = await verify(p3.proof)
check('revoked proof verifies as Revoked', v3.verdict.kind === 'Revoked', v3.verdict.kind)
await new Promise((r) => setTimeout(r, 10_500)) // the attestor caches the list for 10 s
const a3 = await post('/api/attest', { proof: p3.proof })
check('attestor refuses a revoked proof', a3.status === 422 && a3.body?.verdict?.kind === 'Revoked', a3.body?.verdict?.kind ?? a3.body?.error)

console.log(fail ? `${fail} FAILED` : 'end to end: all passed')
process.exit(fail ? 1 : 0)
