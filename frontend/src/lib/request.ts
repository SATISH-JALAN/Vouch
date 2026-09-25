import type { ClaimKind, ProofRequest } from './data/types.ts'
import { fromBase64Url, hex, toBase64Url, utf8 } from './pof/bytes.ts'

// A proof request lives entirely in the URL. Nothing is stored anywhere.
// Mirrors backend/crates/pof-prove/src/request.rs rule for rule; fixtures/requests.json holds
// the links both sides must agree on.

const KINDS: ClaimKind[] = ['HoldsAtLeast', 'HoldsExactly', 'ReceivedPayment', 'ReceivedAtLeastSince']
/** The claim kinds a v1 prover can answer. The others are on the roadmap. */
export const PROVABLE: ClaimKind[] = ['HoldsAtLeast']
export const ZAT_PER_UNIT = 12_500_000n
export const MAX_ZATOSHI = 21_000_000n * 100_000_000n
const FIELDS = new Set(['v', 'id', 'claim', 'zatoshi', 'audience', 'expiryDays', 'respondBy', 'bind'])

export function newRequestId(): string {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return hex(b)
}

/**
 * The problem with an audience identifier, or null. Printable ASCII only, so trimming and
 * lower-casing (inside the audience hash) mean exactly the same thing here and in Rust.
 */
export function audienceProblem(id: string): string | null {
  if (!/^[\x20-\x7e]*$/.test(id)) return 'The audience may use only printable ASCII: letters, digits, spaces and punctuation.'
  if (!id.trim()) return 'Name the one party this proof is for.'
  return null
}

export function encodeRequest(r: ProofRequest): string {
  return toBase64Url(utf8(JSON.stringify(r)))
}

export type DecodedRequest = { ok: true; request: ProofRequest } | { ok: false; reason: string }

const fail = (reason: string): DecodedRequest => ({ ok: false, reason })

export function decodeRequestDetailed(s: string): DecodedRequest {
  // Links wrapped by mail clients pick up whitespace; anything else outside base64url is damage.
  const clean = s.replace(/[\t\n\f\r ]/g, '')
  const bytes = /^[A-Za-z0-9_-]*$/.test(clean) ? fromBase64Url(clean) : null
  if (!bytes) return fail('The link is not valid base64url. It may have been cut off when it was copied.')
  let raw: unknown
  try {
    // fatal + ignoreBOM: invalid UTF-8 and a leading BOM are refused, as serde_json refuses them
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    return fail('The request does not parse.')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('The request does not parse.')
  const unknown = Object.keys(raw).find((k) => !FIELDS.has(k))
  if (unknown !== undefined) return fail(`Unknown request field "${unknown}".`)
  // An explicit null is the same as leaving the field out.
  const r = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null)) as Record<string, unknown>
  if (r.v !== 1) return fail('Unknown request version.')
  if (typeof r.claim !== 'string' || !KINDS.includes(r.claim as ClaimKind)) return fail('Unknown claim kind.')
  if (!PROVABLE.includes(r.claim as ClaimKind)) return fail(`This prover cannot answer ${r.claim} requests yet.`)
  if (typeof r.zatoshi !== 'string' || !/^[0-9]+$/.test(r.zatoshi)) return fail('The amount is missing or malformed.')
  const zat = BigInt(r.zatoshi)
  if (zat === 0n || zat > MAX_ZATOSHI) return fail('The amount is out of range.')
  if (zat % ZAT_PER_UNIT !== 0n) return fail('Thresholds are proven in 0.125 ZEC steps; this one is not a multiple of 0.125.')
  if (typeof r.audience !== 'string') return fail('The request does not name who it is for.')
  const audience = audienceProblem(r.audience)
  if (audience) return fail(audience)
  if (typeof r.expiryDays !== 'number' || !Number.isInteger(r.expiryDays) || r.expiryDays < 1 || r.expiryDays > 365) return fail('Expiry must be 1–365 days.')
  if (r.id !== undefined && (typeof r.id !== 'string' || !/^[0-9a-f]{16}$/.test(r.id))) return fail('Malformed request id.')
  if (r.respondBy !== undefined && (typeof r.respondBy !== 'number' || !Number.isSafeInteger(r.respondBy) || r.respondBy < 1)) return fail('Malformed response deadline.')
  if (r.bind !== undefined && r.bind !== 'solana') return fail('Unknown binding.')
  return { ok: true, request: r as unknown as ProofRequest }
}

// Both commands assume the working directory the READMEs use: backend/.

/** For holders with their own wallet. Keys never leave their machine. The snapshot path is where `pof-anchor scan` writes by default. */
export function cliCommand(encoded: string, bind?: 'solana') {
  return `pof-prove prove --request ${encoded} --snapshot target/snapshots/mainnet-<height>.vsnp --seed-file ~/.vouch/seed.txt${bind === 'solana' ? ' --bind-solana <your-solana-pubkey>' : ''} --out proof.pof`
}

/** The same request answered by the demo holder on the demo ledger. */
export function demoCliCommand(encoded: string, bind?: 'solana') {
  return `pof-prove demo prove --world ../fixtures/demo-world.json --request ${encoded}${bind === 'solana' ? ' --bind-solana <your-solana-pubkey>' : ''} --out proof.pof`
}
