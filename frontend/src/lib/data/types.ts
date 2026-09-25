// The one place for shared shapes. Mirrors the JSON projection of pof-core / pof-verify
// (backend/crates). If the Rust types change, this file changes in the same commit.

export type ClaimKind = 'HoldsAtLeast' | 'HoldsExactly' | 'ReceivedPayment' | 'ReceivedAtLeastSince'

export type Claim =
  | { kind: 'HoldsAtLeast'; zatoshi: number }
  | { kind: 'HoldsExactly'; zatoshi: number }
  | { kind: 'ReceivedPayment'; txid: string; zatoshi: number }
  | { kind: 'ReceivedAtLeastSince'; zatoshi: number; fromHeight: number }

export interface Anchor {
  /** Finalised block height the proof is "as of". */
  height: number
  /** Ironwood note-commitment tree root at that height, hex. */
  ncRoot: string
  /** Spent-nullifier indexed Merkle tree root at that height, hex. */
  nfRoot: string
}

export interface Evidence {
  /** Public inputs the verifier cannot derive, 32 bytes each, hex. */
  publicInputs: string[]
  /** Halo2 proof bytes. */
  proof: Uint8Array
  /** RedPallas spend-authorisation signature over the statement, hex. */
  signature: string
}

export interface Envelope {
  version: number
  claim: Claim
  /** blake2b-256 of the verifier identifier, hex. Never the plaintext name. */
  audience: string
  /** 32 bytes the proof is bound to (e.g. a Solana pubkey), hex. All zero when unbound. */
  binding: string
  anchor: Anchor
  /** Unix seconds. */
  issuedAt: number
  /** Unix seconds, absolute. */
  expiresAt: number
  /** Opaque 16-byte tag, hex. */
  revocation: string
  evidence: Evidence
}

/** An authenticated anchor: both roots at a finalised height, and which ledger they belong to. */
export interface AnchorRecord {
  network: 'mainnet' | 'testnet' | 'demo' | string
  height: number
  blockHash?: string | null
  ncRoot: string
  nfRoot: string
}

/** pof-verify's Verdict. */
export type Verdict =
  | { kind: 'Valid'; claim: Claim; anchorHeight: number }
  | { kind: 'Expired'; at: number }
  | { kind: 'Revoked' }
  | { kind: 'WrongAudience' }
  | { kind: 'AnchorNotFound' }
  | { kind: 'ProofInvalid'; detail: string }
  | { kind: 'Malformed'; reason: string }

export type CheckId = 'format' | 'expiry' | 'revocation' | 'audience' | 'anchor' | 'proof'

export type CheckStatus = 'pass' | 'fail' | 'not-run'

export interface Check {
  id: CheckId
  label: string
  status: CheckStatus
  detail: string
}

export interface VerificationResult {
  verdict: Verdict
  checks: Check[]
  envelope: Envelope | null
  sizeBytes: number
  checksum: string | null
  /** The authenticated anchor the proof was checked against, when one matched. */
  anchor: AnchorRecord | null
  elapsedMs: number
  /** Unix seconds the verification was evaluated at. */
  now: number
  /** e.g. "pof-verify 0.1.0" */
  verifier: string
}

export type PresetId = 'valid' | 'tampered' | 'expired' | 'revoked' | 'wrong-audience' | 'forged-claim' | 'extended-expiry' | 'anchor-mismatch' | 'readdressed' | 'threshold-4000' | 'onchain'

export interface Preset {
  id: PresetId
  label: string
  note: string
  /** Identifier to verify as. */
  audience: string
  /** Path under /proofs. */
  file: string
}

export interface ProofRequest {
  v: 1
  /** Random request id, hex. */
  id?: string
  claim: ClaimKind
  /** zatoshi as a decimal string, so large values survive JSON. */
  zatoshi: string
  audience: string
  expiryDays: number
  /** Unix seconds the verifier wants an answer by. */
  respondBy?: number
  /** "solana" when the proof must be bound to the holder's Solana account. */
  bind?: 'solana'
}

/** The domain-separated message pof-attest signs. */
export interface Attestation {
  domain: 'POF-ATTEST-v1'
  /** Stable proof id: blake2b(statement). One proof, one receipt. */
  subject: string
  /** Solana account the proof is bound to, base58. */
  beneficiary: string
  claimKind: number
  claimValue: number
  anchorHeight: number
  expiresAt: number
  verdict: number
  slot: number
  /** Serialised message bytes, hex. */
  message: string
  signature: string
  /** Attestor Ed25519 pubkey, base58. */
  attestor: string
}

export interface GateTransaction {
  signature: string
  slot: number
  instructions: { index: number; program: string; programId: string; summary: string }[]
  receipt: string
  explorer?: string
}

export interface CreditLine {
  account: string
  pool: string
  limit: string
  drawn: string
  openedAgainst: string
  requiredZatoshi: number
  explorer?: string
}

export type AttestOutcome =
  | { ok: true; attestation: Attestation }
  | { ok: false; reason: 'unreachable' | 'refused'; message: string; verdict?: Verdict }

export type SubmitOutcome =
  | { ok: true; tx: GateTransaction }
  | { ok: false; message: string; failedAt: string }

/** What the deployment has configured: drives LIVE vs SIMULATED on /demo and /prove. */
export interface ServiceStatus {
  attestor: { ok: boolean; pubkey?: string; message?: string }
  demoProver: boolean
  solana: { cluster: string; gate: string; credit: string; pool: string } | null
  /** Revocations, counters and rate limits are in a shared store, not one instance's temp file. */
  durable: boolean
}
