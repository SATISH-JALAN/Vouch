// Sanity checks for the fixture verifier: node scripts/verify-fixtures.ts
import { presets, verifyBytes, vectors, toBytes } from '../src/lib/data/fixtures.ts'
import { DEMO_AUDIENCE } from '../src/lib/data/chain.ts'
import { encode, decode } from '../src/lib/pof/codec.ts'
import { toBase64Url } from '../src/lib/pof/bytes.ts'

const now = Math.floor(Date.now() / 1000)
const aud = DEMO_AUDIENCE.id
let fail = 0
const expect = (name: string, got: string, want: string) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got}${ok ? '' : ` (want ${want})`}`)
}
const run = (s: string | Uint8Array, a: string = aud) => verifyBytes(toBytes(s), a, now)

for (const p of presets()) {
  const r = run(p.encoded)
  console.log(`     ${p.id}: ${p.encoded.length} chars, ${r.elapsedMs.toFixed(2)}ms`, JSON.stringify(r.verdict).slice(0, 120))
}
const [valid, tampered, expired] = presets()
expect('valid', run(valid!.encoded).verdict.kind, 'Valid')
expect('tampered', run(tampered!.encoded).verdict.kind, 'ProofInvalid')
expect('expired', run(expired!.encoded).verdict.kind, 'Expired')
expect('wrong audience', run(valid!.encoded, 'someone-else').verdict.kind, 'WrongAudience')
expect('garbage', run('hello world!').verdict.kind, 'Malformed')
expect('truncated', run(valid!.encoded.slice(0, 900)).verdict.kind, 'Malformed')
const chars = valid!.encoded.split(''); chars[1500] = chars[1500] === 'A' ? 'B' : 'A'
expect('hand-edited char (no reseal)', run(chars.join('')).verdict.kind, 'Malformed')
// forger raises the claim and re-seals
const v = vectors(now)
const forged = structuredClone({ ...v.envelopes.valid, evidence: { ...v.envelopes.valid.evidence } })
forged.claim = { kind: 'HoldsAtLeast', zatoshi: 5_000_000_000_000 }
const fr = run(encode(forged)); expect('forged claim', fr.verdict.kind, 'ProofInvalid'); console.log('     ', JSON.stringify(fr.verdict))
// extend an expired proof
const ext = { ...v.envelopes.expired, expiresAt: now + 86400 }
expect('extended expiry', run(encode(ext)).verdict.kind, 'ProofInvalid')
// unknown but well-formed
const unk = { ...v.envelopes.valid, evidence: { ...v.envelopes.valid.evidence, proof: new Uint8Array(100) }, revocation: 'ab'.repeat(16) }
expect('unknown proof', run(encode(unk)).verdict.kind, 'Unchecked')
// round trip
const d = decode(v.files.valid); expect('round trip', d.ok ? toBase64Url(encode(d.envelope)) === valid!.encoded ? 'same' : 'diff' : 'err', 'same')
// 20 tampered runs
let times: number[] = []
for (let i = 0; i < 20; i++) { const r = run(tampered!.encoded); if (r.verdict.kind !== 'ProofInvalid') fail++; times.push(r.elapsedMs) }
console.log('     tampered x20 max ms', Math.max(...times).toFixed(2), JSON.stringify(run(tampered!.encoded).verdict))
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0)
