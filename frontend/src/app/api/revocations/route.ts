// The revocation list is a hash lock, not a signed list: a proof's tag is
// blake2b("vouch-revoke-v1", secret)[..16], and the holder revokes by publishing `secret`.
// Only the holder knows it, so this server can lose or delay entries but cannot forge one.
import demo from '@/data/revocations.demo.json'
import { readJson } from '@/lib/server/http'
import { clientKey, durable, rateLimit, setAdd, setMembers, setSize } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

// Anyone may publish, so the list is bounded: every verifier downloads all of it.
const MAX_SECRETS = 50_000

export async function GET() {
  const published = await setMembers('revocations')
  const secrets = [...new Set([...demo.secrets, ...published])]
  return Response.json({ secrets, durable }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: Request) {
  // On serverless the file fallback is one instance's /tmp: a 201 there would be a lie.
  if (process.env.VERCEL && !durable) return Response.json({ error: 'revocation store not configured' }, { status: 503 })
  if (await rateLimit(`revoke:${clientKey(req)}`, 20, 60_000)) return Response.json({ error: 'slow down' }, { status: 429 })
  const body = await readJson<{ secret?: unknown }>(req)
  if (body instanceof Response) return body
  const secret = typeof body?.secret === 'string' ? body.secret.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(secret)) return Response.json({ error: 'secret must be 32 bytes of hex' }, { status: 400 })
  if ((await setSize('revocations')) >= MAX_SECRETS) return Response.json({ error: 'revocation list is full' }, { status: 503 })
  const added = await setAdd('revocations', secret)
  return Response.json({ ok: true, added }, { status: added ? 201 : 200 })
}
