import anchors from '@/data/anchors.json'

export async function GET(_req: Request, { params }: { params: Promise<{ height: string }> }) {
  const { height } = await params
  const h = Number(height)
  const records = anchors.filter((a) => a.height === h)
  if (!Number.isInteger(h) || !records.length) return Response.json({ error: `no anchor at height ${height}` }, { status: 404 })
  return Response.json(records, { headers: { 'cache-control': 'public, max-age=31536000, immutable' } })
}
