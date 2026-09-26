// WASM ≡ native: run every committed vector through the WebAssembly verifier the site serves
// (frontend/public/wasm) and compare with fixtures/expected.json — the same list the native
// test (pof-verify/tests) checks.
import { existsSync, readFileSync } from 'node:fs'
import * as wasm from '../frontend/public/wasm/pof_wasm.js'
wasm.initSync({ module: readFileSync(new URL('../frontend/public/wasm/pof_wasm_bg.wasm', import.meta.url)) })
const dir = new URL('../fixtures/', import.meta.url)
// the table the site and the attestor ship: every network's records, merged as sync-fixtures.sh does
const table = (net) => (existsSync(new URL(`anchors.${net}.json`, dir)) ? JSON.parse(readFileSync(new URL(`anchors.${net}.json`, dir), 'utf8')) : [])
const anchors = JSON.stringify(['mainnet', 'testnet', 'demo'].flatMap(table))
const revoked = JSON.stringify(JSON.parse(readFileSync(new URL('revocations.demo.json', dir), 'utf8')).secrets)
// expected.json: the demo vectors; expected.testnet.json: real Zcash testnet proofs (kept by hand)
const sets = ['expected.json', 'expected.testnet.json'].filter((f) => existsSync(new URL(f, dir))).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
let t = performance.now()
wasm.warm()
console.log(`warm (params + verifying key): ${(performance.now() - t).toFixed(0)} ms`)
let fail = 0
for (const meta of sets) {
  for (const [name, want] of Object.entries(meta.expected)) {
    const bytes = readFileSync(new URL(`proofs/${name}.pof`, dir))
    t = performance.now()
    const r = JSON.parse(wasm.verify(bytes, want.audience, BigInt(meta.evaluatedAt), anchors, revoked))
    const ms = (performance.now() - t).toFixed(0)
    const ok = r.verdict.kind === want.verdict && (!want.network || r.anchor?.network === want.network)
    if (!ok) fail++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} ${r.verdict.kind.padEnd(15)} ${want.network ? `${r.anchor?.network ?? '-'} ` : ''}${ms} ms`)
  }
}
console.log(wasm.version(), fail ? `${fail} FAILED` : 'all match native')
process.exit(fail ? 1 : 0)
