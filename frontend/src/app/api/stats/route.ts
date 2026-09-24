// An increment-only count of verifications by verdict kind. Never proof bytes, never who.
import { clientKey, counters, incr, limited } from '@/lib/server/store'

export const dynamic = 'force-dynamic'
const KINDS = new Set(['Valid', 'Expired', 'Revoked', 'WrongAudience', 'AnchorNotFound', 'ProofInvalid', 'Malformed'])

export async function GET() {
  const c = await counters('verdicts')
  const total = Object.values(c).reduce((a, b) => a + b, 0)
  return Response.json({ total, byVerdict: c }, { headers: { 'cache-control': 'public, max-age=30' } })
}

export async function POST(req: Request) {
  if (limited(`stats:${clientKey(req)}`, 60, 60_000)) return new Response(null, { status: 204 })
  const body = (await req.json().catch(() => null)) as { kind?: string } | null
  if (body?.kind && KINDS.has(body.kind)) await incr('verdicts', body.kind)
  return new Response(null, { status: 204 })
}
