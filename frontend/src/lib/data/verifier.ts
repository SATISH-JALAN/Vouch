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
let mod: Promise<PofWasm> | null = null

export function loadVerifier(): Promise<PofWasm> {
  mod ??= import(/* webpackIgnore: true */ WASM_JS).then(async (m: PofWasm) => {
    await m.default()
    m.warm()
    return m
  })
  mod.catch(() => (mod = null))
  return mod
}

let anchors: Promise<AnchorRecord[]> | null = null
export function loadAnchors(): Promise<AnchorRecord[]> {
  anchors ??= fetch('/api/anchors').then((r) => {
    if (!r.ok) throw new Error(`anchor table: HTTP ${r.status}`)
    return r.json() as Promise<AnchorRecord[]>
  })
  anchors.catch(() => (anchors = null))
  return anchors
}

/** Fetched fresh each time: a revocation must take effect on the next check. */
export async function loadRevocations(): Promise<string[]> {
  const r = await fetch('/api/revocations', { cache: 'no-store' })
  if (!r.ok) throw new Error(`revocation list: HTTP ${r.status}`)
  return ((await r.json()) as { secrets: string[] }).secrets
}

type RawEnvelope = Omit<Envelope, 'evidence'> & { evidence: Omit<Envelope['evidence'], 'proof'> & { proof: string } }
type RawResult = Omit<VerificationResult, 'envelope' | 'elapsedMs'> & { envelope: RawEnvelope | null }

export function toBytes(input: string | Uint8Array): Uint8Array {
  if (typeof input !== 'string') return input
  return fromBase64Url(input) ?? new TextEncoder().encode(input)
}

export async function verify(input: string | Uint8Array, audience: string): Promise<VerificationResult> {
  const [wasm, table, revoked] = await Promise.all([loadVerifier(), loadAnchors(), loadRevocations()])
  const bytes = toBytes(input)
  const now = Math.floor(Date.now() / 1000)
  const t0 = performance.now()
  const raw = JSON.parse(wasm.verify(bytes, audience, BigInt(now), JSON.stringify(table), JSON.stringify(revoked))) as RawResult
  const elapsedMs = performance.now() - t0
  void recordVerdict(raw.verdict.kind)
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
  const r = await fetch(`/proofs/${file}`)
  if (!r.ok) throw new Error(`test vector ${file}: HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}
