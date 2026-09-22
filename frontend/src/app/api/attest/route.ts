// Thin proxy to pof-attest so the browser has one origin. No logic lives here.
// If POF_ATTEST_URL is unset, say so plainly; the demo renders it as "attestor unreachable".

export async function POST(req: Request) {
  const upstream = process.env.POF_ATTEST_URL
  if (!upstream) return Response.json({ error: 'attestor not configured (POF_ATTEST_URL is unset)' }, { status: 503 })
  try {
    const res = await fetch(`${upstream.replace(/\/$/, '')}/v1/attest`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: await req.text(),
      signal: AbortSignal.timeout(5_000),
    })
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } })
  } catch (err) {
    return Response.json({ error: `upstream unreachable: ${(err as Error).message}` }, { status: 502 })
  }
}
