// WASM ≡ native: run every committed vector through the WebAssembly verifier and compare
// with fixtures/expected.json — the same list the native test (pof-verify/tests) checks.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const wasm = require('../backend/target/wasm-node/pof_wasm.js')
const dir = new URL('../fixtures/', import.meta.url)
const anchors = readFileSync(new URL('anchors.demo.json', dir), 'utf8')
const revoked = JSON.stringify(JSON.parse(readFileSync(new URL('revocations.demo.json', dir), 'utf8')).secrets)
const meta = JSON.parse(readFileSync(new URL('expected.json', dir), 'utf8'))
let t = performance.now()
wasm.warm()
console.log(`warm (params + verifying key): ${(performance.now() - t).toFixed(0)} ms`)
let fail = 0
for (const [name, want] of Object.entries(meta.expected)) {
  const bytes = readFileSync(new URL(`proofs/${name}.pof`, dir))
  t = performance.now()
  const r = JSON.parse(wasm.verify(bytes, want.audience, BigInt(meta.evaluatedAt), anchors, revoked))
  const ms = (performance.now() - t).toFixed(0)
  const ok = r.verdict.kind === want.verdict
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} ${r.verdict.kind.padEnd(15)} ${ms} ms`)
}
console.log(wasm.version(), fail ? `${fail} FAILED` : 'all match native')
process.exit(fail ? 1 : 0)
