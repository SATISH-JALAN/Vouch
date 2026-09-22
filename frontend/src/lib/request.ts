import type { ClaimKind, ProofRequest } from './data/types'
import { fromBase64Url, toBase64Url, utf8 } from './pof/bytes'

// A proof request lives entirely in the URL. Nothing is stored anywhere.

const KINDS: ClaimKind[] = ['HoldsAtLeast', 'HoldsExactly', 'ReceivedPayment', 'ReceivedAtLeastSince']

export function encodeRequest(r: ProofRequest): string {
  return toBase64Url(utf8(JSON.stringify(r)))
}

export function decodeRequest(s: string): ProofRequest | null {
  const bytes = fromBase64Url(s)
  if (!bytes) return null
  try {
    const r = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ProofRequest>
    if (r.v !== 1 || !r.claim || !KINDS.includes(r.claim)) return null
    if (typeof r.zatoshi !== 'string' || !/^\d+$/.test(r.zatoshi)) return null
    if (typeof r.audience !== 'string' || !r.audience.trim()) return null
    if (typeof r.expiryDays !== 'number' || r.expiryDays < 1 || r.expiryDays > 365) return null
    return r as ProofRequest
  } catch {
    return null
  }
}

export function cliCommand(encoded: string) {
  return `pof-prove --request ${encoded} --wallet ~/.zallet/wallet.db --out proof.pof`
}
