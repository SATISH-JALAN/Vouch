// Thin proxy to pof-attest so the browser has one origin. No logic lives here.
// If POF_ATTEST_URL is unset, say so plainly; /demo then runs its SIMULATED path, labelled.
import { clientKey, limited } from '@/lib/server/store'

export async function POST(req: Request) {
  const upstream = process.env.POF_ATTEST_URL
  if (!upstream) return Response.json({ error: 'attestor not configured (POF_ATTEST_URL is unset)' }, { status: 503 })
  if (limited(`attest:${clientKey(req)}`, 30, 60_000)) return Response.json({ error: 'slow down' }, { status: 429 })
  try {
    const res = await fetch(`${upstream.replace(/\/$/, '')}/v1/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: await req.text(),
      signal: AbortSignal.timeout(10_000),
    })
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } })
  } catch (err) {
    return Response.json({ error: `upstream unreachable: ${(err as Error).message}` }, { status: 502 })
  }
}
