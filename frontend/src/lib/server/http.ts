import { clientKey, rateLimit } from './store.ts'

/** The same cap pof-attest puts on its bodies; nothing this site accepts comes close. */
export const MAX_BODY = 64 * 1024

const tooLarge = () => Response.json({ error: `request body over ${MAX_BODY / 1024} KiB` }, { status: 413 })

/** The body as text, or a 413. Counts the bytes actually read: content-length can be absent or lie. */
export async function readBody(req: Request): Promise<string | Response> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return tooLarge()
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.byteLength
    if (n > MAX_BODY) {
      await reader.cancel()
      return tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The body as JSON (null when it does not parse), or a 413. */
export async function readJson<T>(req: Request): Promise<T | null | Response> {
  const text = await readBody(req)
  if (text instanceof Response) return text
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export const attestorUrl = () => process.env.POF_ATTEST_URL?.replace(/\/$/, '')

/** Forward a JSON POST to pof-attest, so the browser has one origin. No logic lives here. */
export async function proxyToAttestor(
  req: Request,
  o: { path: string; limit: [bucket: string, max: number]; timeoutMs: number; unconfigured: string; slowDown: string; unreachable: string },
) {
  const upstream = attestorUrl()
  if (!upstream) return Response.json({ error: o.unconfigured }, { status: 503 })
  if (await rateLimit(`${o.limit[0]}:${clientKey(req)}`, o.limit[1], 60_000)) return Response.json({ error: o.slowDown }, { status: 429 })
  const body = await readBody(req)
  if (body instanceof Response) return body
  try {
    const res = await fetch(`${upstream}${o.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(o.timeoutMs),
    })
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } })
  } catch (err) {
    return Response.json({ error: `${o.unreachable}: ${(err as Error).message}` }, { status: 502 })
  }
}
