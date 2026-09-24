// The revocation list is a hash lock, not a signed list: a proof's tag is
// blake2b("vouch-revoke-v1", secret)[..16], and the holder revokes by publishing `secret`.
// Only the holder knows it, so this server can lose or delay entries but cannot forge one.
import demo from '@/data/revocations.demo.json'
import { clientKey, durable, limited, setAdd, setMembers } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const published = await setMembers('revocations')
  const secrets = [...new Set([...demo.secrets, ...published])]
  return Response.json({ secrets, durable }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(req: Request) {
  if (limited(`revoke:${clientKey(req)}`, 20, 60_000)) return Response.json({ error: 'slow down' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as { secret?: unknown } | null
  const secret = typeof body?.secret === 'string' ? body.secret.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(secret)) return Response.json({ error: 'secret must be 32 bytes of hex' }, { status: 400 })
  const added = await setAdd('revocations', secret)
  return Response.json({ ok: true, added }, { status: added ? 201 : 200 })
}
