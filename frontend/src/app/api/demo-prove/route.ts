// Forwards a proof request to the demo holder inside pof-attest, which proves it against the
// demo ledger with the demo key. For visitors without ZEC; real holders run pof-prove locally.
import { clientKey, limited } from '@/lib/server/store'

export async function POST(req: Request) {
  const upstream = process.env.POF_ATTEST_URL
  if (!upstream) return Response.json({ error: 'the demo holder is not configured on this deployment (POF_ATTEST_URL is unset)' }, { status: 503 })
  if (limited(`prove:${clientKey(req)}`, 10, 60_000)) return Response.json({ error: 'too many proofs in a minute; try again shortly' }, { status: 429 })
  try {
    const res = await fetch(`${upstream.replace(/\/$/, '')}/v1/demo/prove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: await req.text(),
      signal: AbortSignal.timeout(55_000),
    })
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } })
  } catch (err) {
    return Response.json({ error: `demo holder unreachable: ${(err as Error).message}` }, { status: 502 })
  }
}
