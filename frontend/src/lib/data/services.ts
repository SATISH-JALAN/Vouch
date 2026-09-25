// Client for the few things that need a server: the attestor (signs verdicts for Solana), the
// demo holder (proves on request, for visitors without ZEC), and the devnet relayer (pays for
// and sends demo transactions). /api/status says which are configured; every surface that
// uses them labels itself LIVE or SIMULATED from that answer, never from a guess.

import type { AttestOutcome, CreditLine, GateTransaction, ProofRequest, ServiceStatus, SubmitOutcome, Verdict } from './types.ts'

const TIMEOUT_MS = 12_000

async function post<T>(path: string, body: unknown, timeout = TIMEOUT_MS): Promise<{ status: number; body: T | null; error?: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    return { status: res.status, body: (await res.json().catch(() => null)) as T | null }
  } catch (err) {
    const e = err as Error
    return { status: 0, body: null, error: e.name === 'TimeoutError' ? `no answer in ${timeout / 1000}s` : e.message }
  }
}

let statusCache: Promise<ServiceStatus> | null = null
export function serviceStatus(): Promise<ServiceStatus> {
  // A failed answer is not cached: the next caller asks again instead of staying SIMULATED.
  statusCache ??= fetch('/api/status', { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<ServiceStatus>
    })
    .catch(() => {
      statusCache = null
      return { attestor: { ok: false, message: 'status route unreachable' }, demoProver: false, solana: null, durable: false }
    })
  return statusCache
}

export async function attest(proofB64: string): Promise<AttestOutcome> {
  const r = await post<{ attestation?: AttestOutcome extends { ok: true; attestation: infer A } ? A : never; verdict?: Verdict; error?: string }>('/api/attest', { proof: proofB64 })
  if (r.status === 422 && r.body?.verdict) {
    return { ok: false, reason: 'refused', verdict: r.body.verdict, message: `The attestor ran pof-verify, got ${r.body.verdict.kind}, and refused to sign.` }
  }
  if (r.status !== 200 || !r.body?.attestation) {
    return { ok: false, reason: 'unreachable', message: `Attestor unreachable: ${r.error ?? `HTTP ${r.status}`}${r.body?.error ? ` — ${r.body.error}` : ''}.` }
  }
  return { ok: true, attestation: r.body.attestation }
}

export interface DemoProof {
  /** base64url .pof */
  proof: string
  /** The demo holder's revocation secret for this proof. Returned because the demo holder is us. */
  revocationSecret: string
  notesUsed: number
  provingMs: number
}

export async function demoProve(request: ProofRequest, bindSolana?: string): Promise<{ ok: true; proof: DemoProof } | { ok: false; message: string }> {
  const r = await post<DemoProof & { error?: string }>('/api/demo-prove', { request, bindSolana }, 60_000)
  if (r.status !== 200 || !r.body?.proof) return { ok: false, message: r.body?.error ?? r.error ?? `HTTP ${r.status}` }
  return { ok: true, proof: r.body }
}

export type RelayAction =
  | { action: 'submit'; attestation: { message: string; signature: string; attestor: string }; tamper?: boolean; wallet?: 'borrower' | 'stranger' }
  | { action: 'open-line'; receipt: string; wallet?: 'borrower' | 'stranger' }
  | { action: 'borrower' }

export async function relaySubmit(a: Extract<RelayAction, { action: 'submit' }>): Promise<SubmitOutcome> {
  const r = await post<{ tx?: GateTransaction; error?: string; failedAt?: string }>('/api/relay', a, 45_000)
  if (r.status === 200 && r.body?.tx) return { ok: true, tx: r.body.tx }
  return { ok: false, failedAt: r.body?.failedAt ?? 'relayer', message: r.body?.error ?? r.error ?? `HTTP ${r.status}` }
}

export async function relayOpenLine(a: Extract<RelayAction, { action: 'open-line' }>): Promise<{ ok: true; line: CreditLine } | { ok: false; message: string; failedAt: string }> {
  const r = await post<{ line?: CreditLine; error?: string; failedAt?: string }>('/api/relay', a, 45_000)
  if (r.status === 200 && r.body?.line) return { ok: true, line: r.body.line }
  return { ok: false, failedAt: r.body?.failedAt ?? 'relayer', message: r.body?.error ?? r.error ?? `HTTP ${r.status}` }
}

export async function relayBorrower(): Promise<string | null> {
  const r = await post<{ borrower?: string }>('/api/relay', { action: 'borrower' })
  return r.body?.borrower ?? null
}
