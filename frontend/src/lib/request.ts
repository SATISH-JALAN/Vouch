import type { ClaimKind, ProofRequest } from './data/types.ts'
import { fromBase64Url, hex, toBase64Url, utf8 } from './pof/bytes.ts'

// A proof request lives entirely in the URL. Nothing is stored anywhere.
// Mirrors backend/crates/pof-prove/src/request.rs.

const KINDS: ClaimKind[] = ['HoldsAtLeast', 'HoldsExactly', 'ReceivedPayment', 'ReceivedAtLeastSince']
/** The claim kinds a v1 prover can answer. The others are on the roadmap. */
export const PROVABLE: ClaimKind[] = ['HoldsAtLeast']
export const ZAT_PER_UNIT = 12_500_000n

export function newRequestId(): string {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return hex(b)
}

export function encodeRequest(r: ProofRequest): string {
  return toBase64Url(utf8(JSON.stringify(r)))
}

export type DecodedRequest = { ok: true; request: ProofRequest } | { ok: false; reason: string }

export function decodeRequestDetailed(s: string): DecodedRequest {
  const bytes = fromBase64Url(s)
  if (!bytes) return { ok: false, reason: 'The link is not valid base64url. It may have been cut off when it was copied.' }
  try {
    const r = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ProofRequest>
    if (r.v !== 1) return { ok: false, reason: 'Unknown request version.' }
    if (!r.claim || !KINDS.includes(r.claim)) return { ok: false, reason: 'Unknown claim kind.' }
    if (!PROVABLE.includes(r.claim)) return { ok: false, reason: `This prover cannot answer ${r.claim} requests yet.` }
    if (typeof r.zatoshi !== 'string' || !/^\d+$/.test(r.zatoshi) || BigInt(r.zatoshi) === 0n) return { ok: false, reason: 'The amount is missing or malformed.' }
    if (BigInt(r.zatoshi) % ZAT_PER_UNIT !== 0n) return { ok: false, reason: 'Thresholds are proven in 0.125 ZEC steps; this one is not a multiple of 0.125.' }
    if (typeof r.audience !== 'string' || !r.audience.trim()) return { ok: false, reason: 'The request does not name who it is for.' }
    if (typeof r.expiryDays !== 'number' || !Number.isInteger(r.expiryDays) || r.expiryDays < 1 || r.expiryDays > 365) return { ok: false, reason: 'Expiry must be 1–365 days.' }
    if (r.id !== undefined && (typeof r.id !== 'string' || !/^[0-9a-f]{16}$/.test(r.id))) return { ok: false, reason: 'Malformed request id.' }
    if (r.respondBy !== undefined && (typeof r.respondBy !== 'number' || !Number.isInteger(r.respondBy))) return { ok: false, reason: 'Malformed response deadline.' }
    if (r.bind !== undefined && r.bind !== 'solana') return { ok: false, reason: 'Unknown binding.' }
    return { ok: true, request: r as ProofRequest }
  } catch {
    return { ok: false, reason: 'The request does not parse.' }
  }
}

export function decodeRequest(s: string): ProofRequest | null {
  const d = decodeRequestDetailed(s)
  return d.ok ? d.request : null
}

/** For holders with their own wallet. Keys never leave their machine. */
export function cliCommand(encoded: string, bind?: 'solana') {
  return `pof-prove prove --request ${encoded} --seed-file ~/.vouch/seed.txt --network mainnet${bind === 'solana' ? ' --bind-solana <your-solana-pubkey>' : ''} --out proof.pof`
}

/** The same request answered by the demo holder on the demo ledger. */
export function demoCliCommand(encoded: string, bind?: 'solana') {
  return `pof-prove demo prove --world fixtures/demo-world.json --request ${encoded}${bind === 'solana' ? ' --bind-solana <your-solana-pubkey>' : ''} --out proof.pof`
}
