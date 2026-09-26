// The browser verifier: pof-verify compiled to WebAssembly (backend/crates/pof-wasm), built by
// scripts/build-wasm.sh into public/wasm. Loaded lazily on the first verification, never in
// the root layout. The anchor table and the revocation list are fetched here and passed in as
// data; the WASM itself never touches the network.

import type { AnchorRecord, Envelope, VerificationResult } from './types.ts'
import { fromBase64Url, fromHex } from '../pof/bytes.ts'

interface PofWasm {
  default: (input?: unknown) => Promise<unknown>
  warm: () => void
  verify: (bytes: Uint8Array, audience: string, nowSec: bigint, anchors: string, revoked: string) => string
  version: () => string
}

const WASM_JS = '/wasm/pof_wasm.js'
/** ~4.5 MB of WASM: generous on a slow line, but never an endless spinner. */
const WASM_TIMEOUT_MS = 45_000
const FETCH_TIMEOUT_MS = 12_000
let mod: Promise<PofWasm> | null = null

/** Rejects after `ms` with a message a person can read. The work itself is not cancelled. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${what} did not load within ${ms / 1000}s`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(t))
}

/** fetch with a deadline; a timeout reads as one. */
async function fetchWithin(url: string, what: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (e) {
    const name = (e as Error).name
    throw new Error(name === 'TimeoutError' || name === 'AbortError' ? `${what}: no answer in ${FETCH_TIMEOUT_MS / 1000}s` : `${what}: network error`)
  }
}

export function loadVerifier(): Promise<PofWasm> {
  mod ??= within(
    import(/* webpackIgnore: true */ WASM_JS).then(async (m: PofWasm) => {
      await m.default()
      m.warm()
      return m
    }),
    WASM_TIMEOUT_MS,
    'the verifier (WASM)',
  )
    .catch((e: unknown) => {
      mod = null
      throw e
    })
  return mod
}

let anchors: Promise<AnchorRecord[]> | null = null
export function loadAnchors(): Promise<AnchorRecord[]> {
  anchors ??= fetchWithin('/api/anchors', 'anchor table')
    .then((r) => {
      if (!r.ok) throw new Error(`anchor table: HTTP ${r.status}`)
      return r.json() as Promise<AnchorRecord[]>
    })
    .catch((e: unknown) => {
      anchors = null
      throw e
    })
  return anchors
}

/** Fetched fresh each time: a revocation must take effect on the next check. */
export async function loadRevocations(): Promise<string[]> {
  const r = await fetchWithin('/api/revocations', 'revocation list', { cache: 'no-store' })
  const body = (await r.json().catch(() => null)) as { secrets?: unknown; error?: string } | null
  if (!r.ok) throw new Error(`revocation list: ${body?.error ?? `HTTP ${r.status}`}`)
  if (!Array.isArray(body?.secrets)) throw new Error('revocation list: unreadable answer')
  return body.secrets as string[]
}

type RawEnvelope = Omit<Envelope, 'evidence'> & { evidence: Omit<Envelope['evidence'], 'proof'> & { proof: string } }
type RawResult = Omit<VerificationResult, 'envelope' | 'elapsedMs'> & { envelope: RawEnvelope | null }

export function toBytes(input: string | Uint8Array): Uint8Array {
  if (typeof input !== 'string') return input
  return fromBase64Url(input) ?? new TextEncoder().encode(input)
}

/** `count` adds the verdict to the public /api/stats counter: for checks a person asked for, not the site's own. */
export async function verify(input: string | Uint8Array, audience: string, { count = false } = {}): Promise<VerificationResult> {
  const [wasm, table, revoked] = await Promise.all([loadVerifier(), loadAnchors(), loadRevocations()])
  const bytes = toBytes(input)
  const now = Math.floor(Date.now() / 1000)
  const t0 = performance.now()
  const raw = JSON.parse(wasm.verify(bytes, audience, BigInt(now), JSON.stringify(table), JSON.stringify(revoked))) as RawResult
  const elapsedMs = performance.now() - t0
  if (count) void recordVerdict(raw.verdict.kind)
  return {
    ...raw,
    elapsedMs,
    envelope: raw.envelope ? { ...raw.envelope, evidence: { ...raw.envelope.evidence, proof: fromHex(raw.envelope.evidence.proof) } } : null,
  }
}

/** Increment-only public counter: verdict kind only, never bytes, never who. */
async function recordVerdict(kind: string) {
  try {
    await fetch('/api/stats', { method: 'POST', body: JSON.stringify({ kind }), keepalive: true })
  } catch {
    /* counting is best-effort */
  }
}

export async function fetchPreset(file: string): Promise<Uint8Array> {
  const r = await fetchWithin(`/proofs/${file}`, `test vector ${file}`)
  if (!r.ok) throw new Error(`test vector ${file}: HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}
