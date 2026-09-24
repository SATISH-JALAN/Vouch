// End to end through the site's own API, the way /demo and /prove drive it:
// demo holder proves (bound to the borrower) → WASM verifies → attestor signs → pof-gate
// records a receipt → pof-credit opens a line. Then every breaker: replay, another wallet,
// a tampered attestation, a tampered proof, and a revoked proof.
//
//   SITE=http://localhost:3000 node scripts/e2e.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const wasm = require('../backend/target/wasm-node/pof_wasm.js')

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
async function verify(proof) {
  const anchors = await (await fetch(`${SITE}/api/anchors`)).text()
  const revoked = JSON.stringify((await (await fetch(`${SITE}/api/revocations`)).json()).secrets)
  const bytes = new TextEncoder().encode(proof)
  return JSON.parse(wasm.verify(bytes, AUDIENCE, BigInt(Math.floor(Date.now() / 1000)), anchors, revoked))
}
const request = { v: 1, claim: 'HoldsAtLeast', zatoshi: '50000000000', audience: AUDIENCE, expiryDays: 7, bind: 'solana' }

const status = await (await fetch(`${SITE}/api/status`)).json()
check('services are live', status.attestor.ok && status.demoProver && status.solana, JSON.stringify(status.solana))

const { body: b } = await post('/api/relay', { action: 'borrower' })
const borrower = b.borrower
check('relayer names the borrower', Boolean(borrower), borrower)

async function freshProof() {
  const t = Date.now()
  const r = await post('/api/demo-prove', { request, bindSolana: borrower })
  check('demo holder proves', r.status === 200, `${r.body?.notesUsed} note(s), ${r.body?.provingMs} ms prove, ${Date.now() - t} ms round trip`)
  return r.body
}

// 1 · the proof
const p1 = await freshProof()
const v1 = await verify(p1.proof)
check('browser verifier says Valid', v1.verdict.kind === 'Valid', `${v1.anchor?.network} anchor ${v1.anchor?.height}`)

// 2 · the attestation
const a1 = await post('/api/attest', { proof: p1.proof })
check('attestor signs', a1.status === 200 && a1.body.attestation, `slot ${a1.body?.attestation?.slot}`)
const att = a1.body.attestation

// 3 · the transaction
const s1 = await post('/api/relay', { action: 'submit', attestation: att })
check('pof-gate records a receipt', s1.status === 200, s1.body?.tx?.receipt ?? s1.body?.error)

// 4 · the line
const l1 = await post('/api/relay', { action: 'open-line', receipt: s1.body.tx.receipt })
check('pof-credit opens the line', l1.status === 200, l1.body?.line?.limit ?? l1.body?.error)

// breakers
const r2 = await post('/api/relay', { action: 'submit', attestation: att })
check('replay is refused', r2.status === 422, r2.body?.failedAt)
const w2 = await post('/api/relay', { action: 'open-line', receipt: s1.body.tx.receipt, wallet: 'stranger' })
check('another wallet is refused', w2.status === 422 && /bound|consumed/i.test(w2.body?.error ?? ''), w2.body?.error)

const p2 = await freshProof()
const a2 = await post('/api/attest', { proof: p2.proof })
check('attestor signs the second proof', a2.status === 200 && a2.body?.attestation, a2.body?.error ?? `HTTP ${a2.status}`)
const t2 = await post('/api/relay', { action: 'submit', attestation: a2.body.attestation, tamper: true })
check('tampered attestation fails at the Ed25519 instruction', t2.status === 422 && /Instruction 0/.test(t2.body?.failedAt ?? ''), t2.body?.failedAt)

const bytes = Buffer.from(p2.proof, 'base64url')
bytes[bytes.length - 32 - 64 - 2000] ^= 1 // flip one byte of Halo2 evidence…
const { blake2b } = await import('../frontend/src/lib/pof/blake2b.ts').catch(() => ({ blake2b: null }))
let tampered = bytes
if (blake2b) {
  const body = bytes.subarray(6, bytes.length - 32) // …and re-seal the checksum, as a forger would
  tampered = Buffer.concat([bytes.subarray(0, 6), body, Buffer.from(blake2b(body))])
}
const tp = await post('/api/attest', { proof: tampered.toString('base64url') })
check('tampered proof is refused by the attestor', tp.status === 422, tp.body?.verdict?.kind)

const p3 = await freshProof()
const rv = await post('/api/revocations', { secret: p3.revocationSecret })
check('revocation accepted', rv.status === 201 || rv.status === 200)
const v3 = await verify(p3.proof)
check('revoked proof verifies as Revoked', v3.verdict.kind === 'Revoked')
await new Promise((r) => setTimeout(r, 10_500)) // the attestor caches the list for 10 s
const a3 = await post('/api/attest', { proof: p3.proof })
check('attestor refuses a revoked proof', a3.status === 422 && a3.body?.verdict?.kind === 'Revoked', a3.body?.verdict?.kind)

console.log(fail ? `${fail} FAILED` : 'end to end: all passed')
process.exit(fail ? 1 : 0)
