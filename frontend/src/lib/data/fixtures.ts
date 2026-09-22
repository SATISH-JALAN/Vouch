// Committed test vectors and a fixture-backed verifier.
//
// What is real here: the .pof parsing, the blake2b checksum, and checks 1–4 (format,
// expiry, revocation, audience). What is not: check 5 compares against a committed
// anchor table instead of lightwalletd, and check 6 compares evidence bytes against a
// committed vector instead of running Halo2. Every result from this module says so.

import type {
  Attestation, AttestOutcome, Check, CheckId, Claim, CreditLine, DataSource, Envelope,
  GateTransaction, Preset, PresetId, SubmitOutcome, VerificationResult, Verdict,
} from './types.ts'
import { ANCHOR, DEMO_AUDIENCE, DEMO_THRESHOLD_ZAT, ED25519_PROGRAM } from './chain.ts'
import { blake2b } from '../pof/blake2b.ts'
import { concat, equal, fromBase64Url, fromHex, hex, stream, toBase58, toBase64Url, utf8 } from '../pof/bytes.ts'
import { decode, encode, reseal } from '../pof/codec.ts'
import { daysBetween, formatInt, formatStamp, plural } from '../format.ts'

const DAY = 86_400
const h32 = (s: string) => hex(blake2b(utf8(s)))

export const audienceHash = (id: string) => h32(`pof-audience:${id.trim().toLowerCase()}`)

/** Anchor table the fixture verifier trusts in place of lightwalletd. */
export const FIXTURE_ANCHORS: Record<number, string> = {
  [ANCHOR.height]: h32(`ironwood-root:${ANCHOR.height}:${ANCHOR.blockHash}`),
}

/** Revoked tags. Stands in for the signed static list served at /api/revocations. */
export const FIXTURE_REVOKED = new Set<string>([hex(stream('revoked:demo-0', 16))])

const PROOF_BYTES = 2_208
/** Byte of the Halo2 proof flipped in the tampered vector. */
const TAMPER_AT = 777

function envelope(id: PresetId, claim: Claim, issuedAt: number, expiresAt: number): Envelope {
  const revocation = hex(stream(`revocation:${id}`, 16))
  const audience = audienceHash(DEMO_AUDIENCE.id)
  const root = FIXTURE_ANCHORS[ANCHOR.height]!
  const statement = `${JSON.stringify(claim)}|${audience}|${ANCHOR.height}|${root}|${issuedAt}|${expiresAt}|${revocation}`
  return {
    version: 1,
    claim,
    audience,
    anchor: { height: ANCHOR.height, root },
    issuedAt,
    expiresAt,
    revocation,
    evidence: {
      publicInputs: [root, h32(`pi:claim:${statement}`), h32(`pi:audience:${audience}`), h32(`pi:nf:${revocation}`)],
      proof: stream(`halo2:${statement}`, PROOF_BYTES),
    },
  }
}

interface Vectors {
  day: number
  files: Record<PresetId, Uint8Array>
  envelopes: Record<'valid' | 'expired', Envelope>
  tamperOffset: number
}

let cache: Vectors | null = null

/**
 * Vectors are regenerated per UTC day so the valid proof is always inside its 7-day window
 * and the expired one always expired three days ago. Within a day they are byte-stable.
 */
export function vectors(nowSec = Math.floor(Date.now() / 1000)): Vectors {
  const day = Math.floor(nowSec / DAY) * DAY
  if (cache?.day === day) return cache
  const claim: Claim = { kind: 'HoldsAtLeast', zatoshi: DEMO_THRESHOLD_ZAT }
  const valid = envelope('valid', claim, day, day + 7 * DAY)
  const expired = envelope('expired', claim, day - 10 * DAY, day - 3 * DAY)
  const validFile = encode(valid)
  const tampered = validFile.slice()
  const tamperOffset = validFile.length - 32 - PROOF_BYTES + TAMPER_AT
  tampered[tamperOffset] = tampered[tamperOffset]! ^ 0x01
  cache = {
    day,
    files: { valid: validFile, tampered: reseal(tampered), expired: encode(expired) },
    envelopes: { valid, expired },
    tamperOffset,
  }
  return cache
}

export function presets(): Preset[] {
  const v = vectors()
  return [
    { id: 'valid', label: 'A valid proof', encoded: toBase64Url(v.files.valid) },
    { id: 'tampered', label: 'A tampered proof', encoded: toBase64Url(v.files.tampered) },
    { id: 'expired', label: 'An expired proof', encoded: toBase64Url(v.files.expired) },
  ]
}

// ── the fixture verifier ──────────────────────────────────────────────────

const LABELS: Record<CheckId, string> = {
  format: 'Format and version parse',
  expiry: 'Not expired',
  revocation: 'Not revoked',
  audience: 'Audience matches this verifier',
  anchor: 'Anchor is real',
  proof: 'Proof verifies against the claim',
}
const ORDER: CheckId[] = ['format', 'expiry', 'revocation', 'audience', 'anchor', 'proof']

function headerEqual(a: Envelope, b: Envelope) {
  return (
    JSON.stringify(a.claim) === JSON.stringify(b.claim) &&
    a.audience === b.audience &&
    a.anchor.height === b.anchor.height &&
    a.anchor.root === b.anchor.root &&
    a.issuedAt === b.issuedAt &&
    a.expiresAt === b.expiresAt &&
    a.revocation === b.revocation
  )
}

function changedFields(a: Envelope, b: Envelope): string[] {
  const out: string[] = []
  if (JSON.stringify(a.claim) !== JSON.stringify(b.claim)) out.push('claim')
  if (a.audience !== b.audience) out.push('audience')
  if (a.anchor.height !== b.anchor.height || a.anchor.root !== b.anchor.root) out.push('anchor')
  if (a.issuedAt !== b.issuedAt || a.expiresAt !== b.expiresAt) out.push('expiry')
  if (a.revocation !== b.revocation) out.push('revocation tag')
  return out
}

const evidenceBytes = (e: Envelope) => concat(...e.evidence.publicInputs.map(fromHex), e.evidence.proof)

export function verifyBytes(file: Uint8Array | null, audienceId: string, nowSec: number): VerificationResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0
  const checks: Check[] = ORDER.map((id) => ({ id, label: LABELS[id], status: 'not-run', detail: 'Not run — an earlier check failed.' }))
  const set = (id: CheckId, status: Check['status'], detail: string, fixture = false) => {
    const c = checks.find((x) => x.id === id)!
    Object.assign(c, { status, detail, fixture })
  }
  const done = (verdict: Verdict, envelope: Envelope | null, checksum: string | null): VerificationResult => ({
    verdict, checks, envelope, checksum,
    source: 'fixture',
    sizeBytes: file?.length ?? 0,
    elapsedMs: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
    now: nowSec,
  })

  // 1 · format
  if (!file || file.length === 0) {
    set('format', 'fail', 'Input is not base64url text or a .pof file.')
    return done({ kind: 'Malformed', reason: 'Input is not base64url text or a .pof file.' }, null, null)
  }
  const parsed = decode(file)
  if (!parsed.ok) {
    set('format', 'fail', parsed.reason)
    return done({ kind: 'Malformed', reason: parsed.reason }, null, null)
  }
  const env = parsed.envelope
  set('format', 'pass', `POF1 · version ${env.version} · ${formatInt(file.length)} bytes · checksum ok`)

  // 2 · expiry
  if (nowSec > env.expiresAt) {
    set('expiry', 'fail', `Expired ${formatStamp(env.expiresAt)}.`)
    return done({ kind: 'Expired', at: env.expiresAt }, env, parsed.checksum)
  }
  set('expiry', 'pass', `Valid until ${formatStamp(env.expiresAt)} — ${plural(daysBetween(nowSec, env.expiresAt), 'day')} left.`)

  // 3 · revocation
  if (FIXTURE_REVOKED.has(env.revocation)) {
    set('revocation', 'fail', 'The holder revoked this proof.', true)
    return done({ kind: 'Revoked' }, env, parsed.checksum)
  }
  set('revocation', 'pass', `Tag ${env.revocation.slice(0, 8)}… is not on the revocation list.`, true)

  // 4 · audience
  if (env.audience !== audienceHash(audienceId)) {
    set('audience', 'fail', `This proof was made for someone else. Your identifier "${audienceId}" does not match.`)
    return done({ kind: 'WrongAudience' }, env, parsed.checksum)
  }
  set('audience', 'pass', `blake2b("${audienceId}") matches the audience field.`)

  // 5 · anchor — committed table, not lightwalletd
  if (FIXTURE_ANCHORS[env.anchor.height] !== env.anchor.root) {
    set('anchor', 'fail', `No tree root ${env.anchor.root.slice(0, 10)}… at block ${formatInt(env.anchor.height)}.`, true)
    return done({ kind: 'AnchorNotFound' }, env, parsed.checksum)
  }
  set('anchor', 'pass', `Block ${formatInt(env.anchor.height)} root matches the committed anchor table.`, true)

  // 6 · proof — committed vectors, not Halo2
  const v = vectors(nowSec)
  const known = [v.envelopes.valid, v.envelopes.expired]
  const ev = evidenceBytes(env)
  const sameEvidence = known.find((k) => equal(evidenceBytes(k), ev))
  if (sameEvidence) {
    if (headerEqual(sameEvidence, env)) {
      set('proof', 'pass', 'Evidence is byte-identical to the committed test vector for this claim.', true)
      return done({ kind: 'Valid', claim: env.claim, anchorHeight: env.anchor.height }, env, parsed.checksum)
    }
    const fields = changedFields(sameEvidence, env).join(', ')
    set('proof', 'fail', `The evidence was produced for a different statement. Altered: ${fields}.`, true)
    return done({ kind: 'ProofInvalid', detail: `the ${fields} was altered after proving.` }, env, parsed.checksum)
  }
  const sameHeader = known.find((k) => headerEqual(k, env))
  if (sameHeader) {
    const a = evidenceBytes(sameHeader)
    let diff = 0
    let first = -1
    for (let i = 0; i < Math.max(a.length, ev.length); i++) {
      if (a[i] !== ev[i]) {
        diff++
        if (first < 0) first = i
      }
    }
    const offset = file.length - 32 - ev.length + first
    const what = diff === 1 ? 'one byte was changed' : `${diff} bytes were changed`
    set('proof', 'fail', `Evidence differs from the committed vector: ${what}, first at file offset 0x${offset.toString(16)}.`, true)
    return done({ kind: 'ProofInvalid', detail: `${what}.` }, env, parsed.checksum)
  }
  set('proof', 'not-run', 'Not a committed test vector. The fixture verifier cannot run Halo2.', true)
  return done(
    { kind: 'Unchecked', reason: 'This proof parses, but it is not one of the committed test vectors, and the WASM verifier is not loaded. Nothing about its evidence has been checked.' },
    env,
    parsed.checksum,
  )
}

export function toBytes(input: string | Uint8Array): Uint8Array | null {
  return typeof input === 'string' ? fromBase64Url(input) : input
}

// ── attestation, transaction, credit line ─────────────────────────────────

export const FIXTURE_ATTESTOR = toBase58(stream('attestor:ed25519:pub', 32))
export const POF_GATE_ID = toBase58(stream('program:pof-gate', 32))
export const POF_CREDIT_ID = toBase58(stream('program:pof-credit', 32))
const FIXTURE_SLOT = 441_208_337

function attestationFor(env: Envelope): Attestation {
  const subject = hex(blake2b(utf8(`subject:${env.revocation}:${env.audience}`)))
  const value = env.claim.zatoshi
  const msg = new Uint8Array(13 + 32 + 1 + 8 + 4 + 1 + 8)
  const dv = new DataView(msg.buffer)
  msg.set(utf8('POF-ATTEST-v1'), 0)
  msg.set(fromHex(subject), 13)
  dv.setUint8(45, 0)
  dv.setBigUint64(46, BigInt(value), true)
  dv.setUint32(54, env.anchor.height, true)
  dv.setUint8(58, 0)
  dv.setBigUint64(59, BigInt(FIXTURE_SLOT), true)
  return {
    domain: 'POF-ATTEST-v1',
    subject,
    claimKind: 0,
    claimValue: value,
    anchorHeight: env.anchor.height,
    verdict: 0,
    slot: FIXTURE_SLOT,
    message: hex(msg),
    signature: hex(stream(`attestor:sig:${hex(msg)}`, 64)),
    attestor: FIXTURE_ATTESTOR,
  }
}

export async function attest(encoded: string, opts: { simulateDown?: boolean }): Promise<AttestOutcome> {
  if (opts.simulateDown) {
    return { ok: false, reason: 'unreachable', message: 'Attestor unreachable (simulated): connection refused. Nothing was signed and nothing reached Solana.' }
  }
  const now = Math.floor(Date.now() / 1000)
  const r = verifyBytes(toBytes(encoded), DEMO_AUDIENCE.id, now)
  if (r.verdict.kind !== 'Valid' || !r.envelope) {
    return { ok: false, reason: 'refused', verdict: r.verdict, message: `The attestor ran the verifier, got ${r.verdict.kind}, and refused to sign.` }
  }
  return { ok: true, attestation: attestationFor(r.envelope) }
}

export async function submit(att: Attestation, opts: { tamperAttestation?: boolean }): Promise<SubmitOutcome> {
  if (opts.tamperAttestation) {
    return {
      ok: false,
      failedAt: 'Instruction 0 · Ed25519SigVerify',
      message: 'The Ed25519 native program rejected the signature: one byte of the attestation message was changed after signing. The transaction failed before pof-gate ran. No receipt exists.',
    }
  }
  const receipt = toBase58(blake2b(utf8(`receipt:${att.message}`)))
  return {
    ok: true,
    tx: {
      signature: toBase58(stream(`tx:${att.message}`, 64)),
      slot: att.slot + 3,
      receipt,
      instructions: [
        { index: 0, program: 'Ed25519 native program', programId: ED25519_PROGRAM, summary: `verify sig by ${att.attestor.slice(0, 6)}… over ${att.message.length / 2} bytes` },
        { index: 1, program: 'pof-gate', programId: POF_GATE_ID, summary: 'submit_attestation → ClaimReceipt created' },
      ],
    },
  }
}

export async function openLine(tx: GateTransaction): Promise<CreditLine> {
  return {
    account: toBase58(blake2b(utf8(`line:${tx.receipt}`))),
    pool: toBase58(blake2b(utf8('pool:usdc-1'))),
    limit: '25,000.00 USDC',
    drawn: '0.00 USDC',
    openedAgainst: tx.receipt,
    requiredZatoshi: DEMO_THRESHOLD_ZAT,
  }
}

export const fixtures: DataSource = {
  kind: 'fixture',
  defaultAudience: DEMO_AUDIENCE.id,
  presets,
  async verify(input, { audience }) {
    return verifyBytes(toBytes(input), audience, Math.floor(Date.now() / 1000))
  },
  attest,
  submit,
  openLine,
}
