// The .pof wire format, as specified in /docs/format:
//
//   magic     "POF1"                 4 bytes
//   version   u16 little-endian      2 bytes
//   body      postcard(Envelope)     variable
//   checksum  blake2b-256(body)      32 bytes
//
// Travels as base64url wherever it is text. This is a TypeScript mirror used for
// fixtures and for parsing; pof-verify (Rust, compiled to WASM) is the reference.

import type { Claim, Envelope } from '../data/types.ts'
import { blake2b } from './blake2b.ts'
import { concat, equal, fromHex, hex } from './bytes.ts'

export const MAGIC = new Uint8Array([0x50, 0x4f, 0x46, 0x31]) // "POF1"
export const FORMAT_VERSION = 1

const CLAIM_TAG: Record<Claim['kind'], number> = {
  HoldsAtLeast: 0,
  HoldsExactly: 1,
  ReceivedPayment: 2,
  ReceivedAtLeastSince: 3,
}

// ── writer ────────────────────────────────────────────────────────────────

class Writer {
  parts: number[] = []
  varint(n: number) {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`varint out of range: ${n}`)
    do {
      let byte = n % 128
      n = Math.floor(n / 128)
      if (n > 0) byte |= 0x80
      this.parts.push(byte)
    } while (n > 0)
  }
  fixed(b: Uint8Array) {
    for (const x of b) this.parts.push(x)
  }
  bytes(b: Uint8Array) {
    this.varint(b.length)
    this.fixed(b)
  }
  done() {
    return new Uint8Array(this.parts)
  }
}

export function encodeBody(e: Envelope): Uint8Array {
  const w = new Writer()
  const c = e.claim
  w.varint(CLAIM_TAG[c.kind])
  switch (c.kind) {
    case 'HoldsAtLeast':
    case 'HoldsExactly':
      w.varint(c.zatoshi)
      break
    case 'ReceivedPayment':
      w.fixed(fromHex(c.txid))
      w.varint(c.zatoshi)
      break
    case 'ReceivedAtLeastSince':
      w.varint(c.zatoshi)
      w.varint(c.fromHeight)
      break
  }
  w.fixed(fromHex(e.audience))
  w.varint(e.anchor.height)
  w.fixed(fromHex(e.anchor.root))
  w.varint(e.issuedAt)
  w.varint(e.expiresAt)
  w.fixed(fromHex(e.revocation))
  w.varint(e.evidence.publicInputs.length)
  for (const pi of e.evidence.publicInputs) w.fixed(fromHex(pi))
  w.bytes(e.evidence.proof)
  return w.done()
}

export function encode(e: Envelope): Uint8Array {
  const body = encodeBody(e)
  const version = new Uint8Array([e.version & 0xff, e.version >> 8])
  return concat(MAGIC, version, body, blake2b(body))
}

/** Re-seal a body with a fresh checksum — what a forger would do after editing it. */
export function reseal(file: Uint8Array): Uint8Array {
  const body = file.subarray(6, file.length - 32)
  return concat(file.subarray(0, 6), body, blake2b(body))
}

// ── reader ────────────────────────────────────────────────────────────────

class Reader {
  o = 0
  private b: Uint8Array
  constructor(b: Uint8Array) {
    this.b = b
  }
  varint(): number {
    let n = 0
    let mul = 1
    for (let i = 0; i < 8; i++) {
      const byte = this.u8()
      n += (byte & 0x7f) * mul
      if (!(byte & 0x80)) return n
      mul *= 128
    }
    throw new Error('varint too long')
  }
  u8(): number {
    if (this.o >= this.b.length) throw new Error('unexpected end of body')
    return this.b[this.o++]!
  }
  fixed(n: number): Uint8Array {
    if (this.o + n > this.b.length) throw new Error('unexpected end of body')
    const out = this.b.slice(this.o, this.o + n)
    this.o += n
    return out
  }
  bytes(): Uint8Array {
    return this.fixed(this.varint())
  }
  get rest() {
    return this.b.length - this.o
  }
}

export type DecodeResult =
  | { ok: true; envelope: Envelope; checksum: string; bodyOffset: number }
  | { ok: false; reason: string }

export function decode(file: Uint8Array): DecodeResult {
  if (file.length < 4 + 2 + 32 + 1) return { ok: false, reason: 'Too short to be a proof. The paste may be truncated.' }
  if (!equal(file.subarray(0, 4), MAGIC)) return { ok: false, reason: 'Not a proof file: the POF1 magic bytes are missing.' }
  const version = file[4]! | (file[5]! << 8)
  if (version !== FORMAT_VERSION) return { ok: false, reason: `Unknown format version ${version}. This verifier reads version ${FORMAT_VERSION}.` }

  const body = file.subarray(6, file.length - 32)
  const checksum = file.subarray(file.length - 32)
  if (!equal(blake2b(body), checksum)) {
    return { ok: false, reason: 'Checksum mismatch. The file was truncated or damaged in transit — this is not the same as a forgery.' }
  }

  try {
    const r = new Reader(body)
    const tag = r.varint()
    let claim: Claim
    switch (tag) {
      case 0: claim = { kind: 'HoldsAtLeast', zatoshi: r.varint() }; break
      case 1: claim = { kind: 'HoldsExactly', zatoshi: r.varint() }; break
      case 2: { const txid = hex(r.fixed(32)); claim = { kind: 'ReceivedPayment', txid, zatoshi: r.varint() }; break }
      case 3: { const zatoshi = r.varint(); claim = { kind: 'ReceivedAtLeastSince', zatoshi, fromHeight: r.varint() }; break }
      default: return { ok: false, reason: `Unknown claim tag ${tag}.` }
    }
    const audience = hex(r.fixed(32))
    const height = r.varint()
    const root = hex(r.fixed(32))
    const issuedAt = r.varint()
    const expiresAt = r.varint()
    const revocation = hex(r.fixed(16))
    const n = r.varint()
    if (n > 16) return { ok: false, reason: 'Too many public inputs.' }
    const publicInputs: string[] = []
    for (let i = 0; i < n; i++) publicInputs.push(hex(r.fixed(32)))
    const proof = r.bytes()
    if (r.rest !== 0) return { ok: false, reason: 'Trailing bytes after the envelope.' }
    return {
      ok: true,
      envelope: { version, claim, audience, anchor: { height, root }, issuedAt, expiresAt, revocation, evidence: { publicInputs, proof } },
      checksum: hex(checksum),
      bodyOffset: 6,
    }
  } catch (err) {
    return { ok: false, reason: `Envelope does not parse: ${(err as Error).message}.` }
  }
}
