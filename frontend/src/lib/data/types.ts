// The one place for shared shapes. Mirrors the JSON projection of pof-core / pof-verify.
// If the Rust enum changes, this file changes in the same commit.

export type ClaimKind = 'HoldsAtLeast' | 'HoldsExactly' | 'ReceivedPayment' | 'ReceivedAtLeastSince'

export type Claim =
  | { kind: 'HoldsAtLeast'; zatoshi: number }
  | { kind: 'HoldsExactly'; zatoshi: number }
  | { kind: 'ReceivedPayment'; txid: string; zatoshi: number }
  | { kind: 'ReceivedAtLeastSince'; zatoshi: number; fromHeight: number }

export interface Anchor {
  /** Finalised block height the proof is "as of". */
  height: number
  /** Note commitment tree root at that height, hex. */
  root: string
}

export interface Evidence {
  /** Public inputs, 32 bytes each, hex. */
  publicInputs: string[]
  /** Halo2 proof bytes. */
  proof: Uint8Array
}

export interface Envelope {
  version: number
  claim: Claim
  /** blake2b-256 of the verifier identifier, hex. Never the plaintext name. */
  audience: string
  anchor: Anchor
  /** Unix seconds. */
  issuedAt: number
  /** Unix seconds, absolute. */
  expiresAt: number
  /** Opaque 16-byte tag, hex. */
  revocation: string
  evidence: Evidence
}

/** pof-verify's Verdict, plus one web-only state for inputs the current source cannot check. */
export type Verdict =
  | { kind: 'Valid'; claim: Claim; anchorHeight: number }
  | { kind: 'Expired'; at: number }
  | { kind: 'Revoked' }
  | { kind: 'WrongAudience' }
  | { kind: 'AnchorNotFound' }
  | { kind: 'ProofInvalid'; detail: string }
  | { kind: 'Malformed'; reason: string }
  | { kind: 'Unchecked'; reason: string }

export type CheckId = 'format' | 'expiry' | 'revocation' | 'audience' | 'anchor' | 'proof'

export type CheckStatus = 'pass' | 'fail' | 'not-run'

export interface Check {
  id: CheckId
  label: string
  status: CheckStatus
  detail: string
  /** True when the check compared against a committed test vector instead of doing the real work. */
  fixture?: boolean
}

export type SourceKind = 'fixture' | 'wasm'

export interface VerificationResult {
  verdict: Verdict
  checks: Check[]
  envelope: Envelope | null
  source: SourceKind
  sizeBytes: number
  checksum: string | null
  elapsedMs: number
  /** Unix seconds the verification was evaluated at. */
  now: number
}

export type PresetId = 'valid' | 'tampered' | 'expired'

export interface Preset {
  id: PresetId
  label: string
  /** base64url-encoded .pof */
  encoded: string
}

export interface ProofRequest {
  v: 1
  claim: ClaimKind
  /** zatoshi as a decimal string, so large values survive JSON. */
  zatoshi: string
  audience: string
  expiryDays: number
  txid?: string
  fromHeight?: number
}

/** The domain-separated message pof-attest signs. */
export interface Attestation {
  domain: 'POF-ATTEST-v1'
  subject: string
  claimKind: number
  claimValue: number
  anchorHeight: number
  verdict: number
  slot: number
  /** Serialised message bytes, hex. */
  message: string
  signature: string
  attestor: string
}

export interface GateTransaction {
  signature: string
  slot: number
  instructions: { index: number; program: string; programId: string; summary: string }[]
  receipt: string
}

export interface CreditLine {
  account: string
  pool: string
  limit: string
  drawn: string
  openedAgainst: string
  requiredZatoshi: number
}

export type AttestOutcome =
  | { ok: true; attestation: Attestation }
  | { ok: false; reason: 'unreachable' | 'refused'; message: string; verdict?: Verdict }

export type SubmitOutcome =
  | { ok: true; tx: GateTransaction }
  | { ok: false; message: string; failedAt: string }

export interface DataSource {
  kind: SourceKind
  presets(): Preset[]
  defaultAudience: string
  verify(input: string | Uint8Array, opts: { audience: string }): Promise<VerificationResult>
  attest(encoded: string, opts: { simulateDown?: boolean }): Promise<AttestOutcome>
  submit(att: Attestation, opts: { tamperAttestation?: boolean }): Promise<SubmitOutcome>
  openLine(tx: GateTransaction): Promise<CreditLine>
}
