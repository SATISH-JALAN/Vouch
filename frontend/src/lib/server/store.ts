import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Two tiny shared lists: published revocation secrets and verdict counters. With Upstash
// Redis (or Vercel KV) configured they are durable and shared across instances; without it
// they live in a JSON file in the OS temp dir — fine for one server, and /api/status says so.

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

export const durable = Boolean(URL_ && TOKEN)

async function redis<T>(...cmd: (string | number)[]): Promise<T> {
  const res = await fetch(URL_!, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`kv: HTTP ${res.status}`)
  return ((await res.json()) as { result: T }).result
}

const FILE = path.join(os.tmpdir(), 'vouch-store.json')
type FileState = { sets: Record<string, string[]>; counters: Record<string, Record<string, number>> }

async function readFile(): Promise<FileState> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8')) as FileState
  } catch {
    return { sets: {}, counters: {} }
  }
}
let chain: Promise<unknown> = Promise.resolve()
function mutate(f: (s: FileState) => void) {
  const next = chain.then(async () => {
    const s = await readFile()
    f(s)
    await fs.writeFile(FILE, JSON.stringify(s))
  })
  chain = next.catch(() => {})
  return next
}

export async function setAdd(key: string, member: string): Promise<boolean> {
  if (durable) return (await redis<number>('SADD', `vouch:${key}`, member)) === 1
  let added = false
  await mutate((s) => {
    const set = (s.sets[key] ??= [])
    if (!set.includes(member)) {
      set.push(member)
      added = true
    }
  })
  return added
}

export async function setMembers(key: string): Promise<string[]> {
  if (durable) return redis<string[]>('SMEMBERS', `vouch:${key}`)
  return (await readFile()).sets[key] ?? []
}

export async function incr(hash: string, field: string): Promise<void> {
  if (durable) {
    await redis('HINCRBY', `vouch:${hash}`, field, 1)
    return
  }
  await mutate((s) => {
    const h = (s.counters[hash] ??= {})
    h[field] = (h[field] ?? 0) + 1
  })
}

export async function counters(hash: string): Promise<Record<string, number>> {
  if (durable) {
    const flat = await redis<string[]>('HGETALL', `vouch:${hash}`)
    const out: Record<string, number> = {}
    for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]!] = Number(flat[i + 1])
    return out
  }
  return (await readFile()).counters[hash] ?? {}
}

/** Fixed-window rate limit per key, in memory (per instance). */
const hits = new Map<string, { n: number; reset: number }>()
export function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const h = hits.get(key)
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs })
    return false
  }
  h.n++
  return h.n > max
}

export function clientKey(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
}
