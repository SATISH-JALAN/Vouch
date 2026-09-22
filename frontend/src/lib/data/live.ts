// The live source: the WASM build of pof-verify, plus the attestor via /api/attest.
// Same shape as fixtures.ts. The adapter picks one; nothing else in the app knows which.
//
// The WASM package is produced by `wasm-pack build crates/pof-wasm --target web` and copied
// to public/wasm/. It is loaded lazily, on first verification, never in the root layout.

import type { AttestOutcome, DataSource, SubmitOutcome, VerificationResult, Verdict } from './types.ts'
import { attest as fixtureAttest, openLine, presets, submit as fixtureSubmit, toBytes } from './fixtures.ts'
import { DEMO_AUDIENCE } from './chain.ts'

interface PofWasm {
  default: (url?: string) => Promise<unknown>
  /** Returns the JSON projection of pof-verify's VerificationResult. */
  verify: (bytes: Uint8Array, audience: string, nowSec: bigint) => string
}

const WASM_JS = '/wasm/pof_wasm.js'
let mod: Promise<PofWasm> | null = null

function loadWasm(): Promise<PofWasm> {
  mod ??= import(/* webpackIgnore: true */ WASM_JS).then(async (m: PofWasm) => {
    await m.default()
    return m
  })
  return mod
}

const ATTEST_TIMEOUT_MS = 6_000

async function attest(encoded: string, opts: { simulateDown?: boolean }): Promise<AttestOutcome> {
  if (opts.simulateDown) return fixtureAttest(encoded, opts)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ATTEST_TIMEOUT_MS)
  try {
    const res = await fetch('/api/attest', { method: 'POST', body: encoded, signal: ctrl.signal })
    const body = await res.json().catch(() => null)
    if (res.status === 422 && body?.verdict) {
      return { ok: false, reason: 'refused', verdict: body.verdict as Verdict, message: `The attestor ran the verifier, got ${body.verdict.kind}, and refused to sign.` }
    }
    if (!res.ok || !body?.attestation) {
      return { ok: false, reason: 'unreachable', message: `Attestor unreachable: HTTP ${res.status}${body?.error ? ` — ${body.error}` : ''}.` }
    }
    return { ok: true, attestation: body.attestation }
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError'
    return { ok: false, reason: 'unreachable', message: aborted ? `Attestor unreachable: no answer in ${ATTEST_TIMEOUT_MS / 1000}s.` : `Attestor unreachable: ${(err as Error).message}.` }
  } finally {
    clearTimeout(timer)
  }
}

// Solana submission stays on fixtures until the gate program is deployed to devnet.
async function submit(...args: Parameters<typeof fixtureSubmit>): Promise<SubmitOutcome> {
  return fixtureSubmit(...args)
}

export const live: DataSource = {
  kind: 'wasm',
  defaultAudience: DEMO_AUDIENCE.id,
  presets,
  async verify(input, { audience }) {
    const wasm = await loadWasm()
    const bytes = toBytes(input) ?? new Uint8Array()
    const now = Math.floor(Date.now() / 1000)
    const t0 = performance.now()
    const result = JSON.parse(wasm.verify(bytes, audience, BigInt(now))) as VerificationResult
    return { ...result, source: 'wasm', elapsedMs: performance.now() - t0, now }
  },
  attest,
  submit,
  openLine,
}
