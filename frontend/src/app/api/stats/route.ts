// An increment-only count of verifications by verdict kind. Never proof bytes, never who.
import { readJson } from '@/lib/server/http'
import { clientKey, counters, incr, rateLimit } from '@/lib/server/store'

export const dynamic = 'force-dynamic'
const KINDS = new Set(['Valid', 'Expired', 'Revoked', 'WrongAudience', 'AnchorNotFound', 'ProofInvalid', 'Malformed'])

export async function GET() {
  const c = await counters('verdicts')
  const total = Object.values(c).reduce((a, b) => a + b, 0)
  return Response.json({ total, byVerdict: c }, { headers: { 'cache-control': 'public, max-age=30' } })
}

export async function POST(req: Request) {
  if (await rateLimit(`stats:${clientKey(req)}`, 60, 60_000)) return new Response(null, { status: 204 })
  const body = await readJson<{ kind?: string }>(req)
  if (body instanceof Response) return body
  if (body?.kind && KINDS.has(body.kind)) await incr('verdicts', body.kind)
  return new Response(null, { status: 204 })
}
