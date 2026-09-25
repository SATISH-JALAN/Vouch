// What this deployment has configured. /demo and /prove label themselves LIVE or SIMULATED
// from this answer. Nothing secret is returned.
import type { ServiceStatus } from '@/lib/data/types'
import { attestorUrl } from '@/lib/server/http'
import { CREDIT_ID, GATE_ID } from '@/lib/server/solana'
import { durable } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const upstream = attestorUrl()
  let attestor: ServiceStatus['attestor'] = { ok: false, message: 'attestor not configured (POF_ATTEST_URL is unset)' }
  let demoProver = false
  if (upstream) {
    try {
      const res = await fetch(`${upstream}/v1/pubkey`, { signal: AbortSignal.timeout(4_000), cache: 'no-store' })
      if (res.ok) {
        const body = (await res.json()) as { pubkey?: string; demoProver?: boolean }
        attestor = { ok: true, pubkey: body.pubkey }
        demoProver = Boolean(body.demoProver)
      } else {
        attestor = { ok: false, message: `attestor answered HTTP ${res.status}` }
      }
    } catch (err) {
      attestor = { ok: false, message: `attestor unreachable: ${(err as Error).message}` }
    }
  }
  const { SOLANA_RPC_URL, POF_POOL, RELAYER_SECRET_KEY, BORROWER_SECRET_KEY } = process.env
  const solana =
    SOLANA_RPC_URL && POF_POOL && RELAYER_SECRET_KEY && BORROWER_SECRET_KEY
      ? { cluster: process.env.SOLANA_CLUSTER ?? 'devnet', gate: GATE_ID.toBase58(), credit: CREDIT_ID.toBase58(), pool: POF_POOL }
      : null
  const status: ServiceStatus = { attestor, demoProver, solana, durable }
  return Response.json(status, { headers: { 'cache-control': 'no-store' } })
}
