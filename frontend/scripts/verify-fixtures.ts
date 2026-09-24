// The TypeScript mirror of the .pof format against the proofs the Rust prover wrote:
// every committed vector must decode, and re-encode to the identical bytes.
// Verdicts themselves are checked by the WASM verifier (scripts/verify-fixtures-wasm.mjs at
// the repo root) and the native one (cargo test -p pof-verify) against fixtures/expected.json.
import { readdirSync, readFileSync } from 'node:fs'
import { decode, encode } from '../src/lib/pof/codec.ts'
import { audienceHash } from '../src/lib/pof/hash.ts'
import { fromBase64Url, toBase64Url } from '../src/lib/pof/bytes.ts'
import { decodeRequestDetailed, encodeRequest } from '../src/lib/request.ts'

const dir = new URL('../public/proofs/', import.meta.url)
let fail = 0
const expect = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

for (const f of readdirSync(dir).filter((f) => f.endsWith('.pof')).sort()) {
  const bytes = new Uint8Array(readFileSync(new URL(f, dir)))
  const d = decode(bytes)
  if (!d.ok) {
    expect(f, false, d.reason)
    continue
  }
  const again = encode(d.envelope)
  expect(`${f} round-trips byte-for-byte`, again.length === bytes.length && again.every((b, i) => b === bytes[i]), `${bytes.length} bytes, proof ${d.envelope.evidence.proof.length}`)
  const b64 = toBase64Url(bytes)
  const back = fromBase64Url(b64)!
  expect(`${f} base64url`, back.length === bytes.length && back.every((b, i) => b === bytes[i]))
}

// the audience hash the builder shows is the one the verifier compares
const valid = decode(new Uint8Array(readFileSync(new URL('valid.pof', dir))))
expect('audience hash matches pof_core', valid.ok && valid.envelope.audience === audienceHash('pof-credit:usdc-pool-1'))
expect('truncated file is refused', !decode(new Uint8Array(readFileSync(new URL('valid.pof', dir))).slice(0, 900)).ok)

// requests
const req = { v: 1 as const, claim: 'HoldsAtLeast' as const, zatoshi: '50000000000', audience: 'pof-credit:usdc-pool-1', expiryDays: 7 }
expect('request round-trips', decodeRequestDetailed(encodeRequest(req)).ok)
expect('0.125 ZEC granularity enforced', !decodeRequestDetailed(encodeRequest({ ...req, zatoshi: '50000000001' })).ok)
expect('roadmap claims refused', !decodeRequestDetailed(encodeRequest({ ...req, claim: 'ReceivedPayment' as never })).ok)
expect('garbage refused', !decodeRequestDetailed('!!!').ok)

console.log(fail ? `${fail} FAILED` : 'all passed')
process.exit(fail ? 1 : 0)
