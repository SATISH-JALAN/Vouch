//! Byte-exact encoder and decoder. The encoding is postcard's: unsigned integers as LEB128
//! varints, fixed arrays as raw bytes, vectors as a varint length then elements, enums as a
//! varint tag then fields. Written by hand so the TypeScript mirror (frontend
//! `src/lib/pof/codec.ts`) and this crate can be checked against the same golden vectors.

use crate::{
    Anchor, Claim, Envelope, Evidence, FORMAT_VERSION, MAGIC_BYTES, MAX_PROOF_BYTES, MAX_PUBLIC_INPUTS, MAX_ZATOSHI,
};

/// Why a file failed to parse. Each variant is a different message in the UI.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DecodeError {
    #[error("Too short to be a proof. The paste may be truncated.")]
    TooShort,
    #[error("Not a proof file: the POF1 magic bytes are missing.")]
    BadMagic,
    #[error("Unknown format version {0}. This verifier reads version 1.")]
    UnknownVersion(u16),
    #[error("Checksum mismatch. The file was truncated or damaged in transit — this is not the same as a forgery.")]
    Checksum,
    #[error("Envelope does not parse: {0}.")]
    Body(String),
    #[error("Input is not base64url text or a .pof file.")]
    NotBase64,
}

// ── writer ────────────────────────────────────────────────────────────────

struct Writer(Vec<u8>);

impl Writer {
    fn varint(&mut self, mut n: u64) {
        loop {
            let byte = (n & 0x7f) as u8;
            n >>= 7;
            if n == 0 {
                self.0.push(byte);
                return;
            }
            self.0.push(byte | 0x80);
        }
    }
    fn fixed(&mut self, b: &[u8]) {
        self.0.extend_from_slice(b);
    }
    fn bytes(&mut self, b: &[u8]) {
        self.varint(b.len() as u64);
        self.fixed(b);
    }
}

fn write_head(w: &mut Writer, e: &Envelope) {
    w.varint(e.claim.tag() as u64);
    match &e.claim {
        Claim::HoldsAtLeast { zatoshi } | Claim::HoldsExactly { zatoshi } => w.varint(*zatoshi),
        Claim::ReceivedPayment { txid, zatoshi } => {
            w.fixed(txid);
            w.varint(*zatoshi);
        }
        Claim::ReceivedAtLeastSince { zatoshi, from_height } => {
            w.varint(*zatoshi);
            w.varint(*from_height as u64);
        }
    }
    w.fixed(&e.audience);
    w.fixed(&e.binding);
    w.varint(e.anchor.height as u64);
    w.fixed(&e.anchor.nc_root);
    w.fixed(&e.anchor.nf_root);
    w.varint(e.issued_at);
    w.varint(e.expires_at);
    w.fixed(&e.revocation);
}

/// The statement: every body field except the evidence. This is what the proof binds to.
pub(crate) fn encode_head(e: &Envelope) -> Vec<u8> {
    let mut w = Writer(Vec::with_capacity(160));
    write_head(&mut w, e);
    w.0
}

pub fn encode_body(e: &Envelope) -> Vec<u8> {
    let mut w = Writer(Vec::with_capacity(160 + e.evidence.proof.len() + 32 * e.evidence.public_inputs.len()));
    write_head(&mut w, e);
    w.varint(e.evidence.public_inputs.len() as u64);
    for pi in &e.evidence.public_inputs {
        w.fixed(pi);
    }
    w.bytes(&e.evidence.proof);
    w.fixed(&e.evidence.signature);
    w.0
}

pub fn encode(e: &Envelope) -> Vec<u8> {
    let body = encode_body(e);
    let mut out = Vec::with_capacity(4 + 2 + body.len() + 32);
    out.extend_from_slice(&MAGIC_BYTES);
    out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&body);
    out.extend_from_slice(blake2b_simd::Params::new().hash_length(32).hash(&body).as_bytes());
    out
}

// ── reader ────────────────────────────────────────────────────────────────

struct Reader<'a> {
    b: &'a [u8],
    o: usize,
}

impl<'a> Reader<'a> {
    fn u8(&mut self) -> Result<u8, String> {
        let x = *self.b.get(self.o).ok_or("unexpected end of body")?;
        self.o += 1;
        Ok(x)
    }
    fn varint(&mut self) -> Result<u64, String> {
        let mut n: u64 = 0;
        for i in 0..10 {
            let byte = self.u8()?;
            let chunk = (byte & 0x7f) as u64;
            if i == 9 && chunk > 1 {
                return Err("varint overflows u64".into());
            }
            n |= chunk << (7 * i);
            if byte & 0x80 == 0 {
                return Ok(n);
            }
        }
        Err("varint too long".into())
    }
    fn u32(&mut self) -> Result<u32, String> {
        u32::try_from(self.varint()?).map_err(|_| "value overflows u32".into())
    }
    fn fixed<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let end = self.o.checked_add(N).filter(|&e| e <= self.b.len()).ok_or("unexpected end of body")?;
        let mut out = [0u8; N];
        out.copy_from_slice(&self.b[self.o..end]);
        self.o = end;
        Ok(out)
    }
    fn bytes(&mut self, max: usize) -> Result<Vec<u8>, String> {
        let n = self.varint()? as usize;
        if n > max {
            return Err(format!("field of {n} bytes exceeds the {max}-byte limit"));
        }
        let end = self.o.checked_add(n).filter(|&e| e <= self.b.len()).ok_or("unexpected end of body")?;
        let out = self.b[self.o..end].to_vec();
        self.o = end;
        Ok(out)
    }
}

fn amount(z: u64) -> Result<u64, String> {
    if z > MAX_ZATOSHI {
        Err("amount exceeds the 21M ZEC supply".into())
    } else {
        Ok(z)
    }
}

fn read_body(body: &[u8]) -> Result<Envelope, String> {
    let mut r = Reader { b: body, o: 0 };
    let claim = match r.varint()? {
        0 => Claim::HoldsAtLeast { zatoshi: amount(r.varint()?)? },
        1 => Claim::HoldsExactly { zatoshi: amount(r.varint()?)? },
        2 => {
            let txid = r.fixed::<32>()?;
            Claim::ReceivedPayment { txid, zatoshi: amount(r.varint()?)? }
        }
        3 => {
            let zatoshi = amount(r.varint()?)?;
            Claim::ReceivedAtLeastSince { zatoshi, from_height: r.u32()? }
        }
        t => return Err(format!("unknown claim tag {t}")),
    };
    let audience = r.fixed::<32>()?;
    let binding = r.fixed::<32>()?;
    let anchor = Anchor { height: r.u32()?, nc_root: r.fixed::<32>()?, nf_root: r.fixed::<32>()? };
    let issued_at = r.varint()?;
    let expires_at = r.varint()?;
    let revocation = r.fixed::<16>()?;
    let n = r.varint()? as usize;
    if n > MAX_PUBLIC_INPUTS {
        return Err("too many public inputs".into());
    }
    let mut public_inputs = Vec::with_capacity(n);
    for _ in 0..n {
        public_inputs.push(r.fixed::<32>()?);
    }
    let proof = r.bytes(MAX_PROOF_BYTES)?;
    let signature = r.fixed::<64>()?;
    if r.o != body.len() {
        return Err("trailing bytes after the envelope".into());
    }
    Ok(Envelope {
        claim,
        audience,
        binding,
        anchor,
        issued_at,
        expires_at,
        revocation,
        evidence: Evidence { public_inputs, proof, signature },
    })
}

/// Parse a `.pof` file. On success also returns the hex checksum.
pub fn decode(file: &[u8]) -> Result<(Envelope, [u8; 32]), DecodeError> {
    if file.len() < 4 + 2 + 32 + 1 {
        return Err(DecodeError::TooShort);
    }
    if file[..4] != MAGIC_BYTES {
        return Err(DecodeError::BadMagic);
    }
    let version = u16::from_le_bytes([file[4], file[5]]);
    if version != FORMAT_VERSION {
        return Err(DecodeError::UnknownVersion(version));
    }
    let body = &file[6..file.len() - 32];
    let mut checksum = [0u8; 32];
    checksum.copy_from_slice(&file[file.len() - 32..]);
    if blake2b_simd::Params::new().hash_length(32).hash(body).as_bytes() != checksum {
        return Err(DecodeError::Checksum);
    }
    let env = read_body(body).map_err(DecodeError::Body)?;
    Ok((env, checksum))
}

// ── base64url (RFC 4648 §5, no padding; standard base64 is accepted on input) ──

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn to_base64url(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len().div_ceil(3) * 4);
    for chunk in b.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        s.push(B64[(n >> 18) as usize & 63] as char);
        s.push(B64[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            s.push(B64[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            s.push(B64[n as usize & 63] as char);
        }
    }
    s
}

pub fn from_base64url(s: &str) -> Result<Vec<u8>, DecodeError> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut buf, mut bits) = (0u32, 0u32);
    for ch in s.trim().trim_end_matches('=').bytes() {
        if ch.is_ascii_whitespace() {
            continue;
        }
        let ch = match ch {
            b'+' => b'-',
            b'/' => b'_',
            c => c,
        };
        let v = B64.iter().position(|&c| c == ch).ok_or(DecodeError::NotBase64)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;

    pub(crate) fn sample(claim: Claim) -> Envelope {
        Envelope {
            claim,
            audience: audience_hash("pof-credit:usdc-pool-1"),
            binding: [7u8; 32],
            anchor: Anchor { height: 3_491_040, nc_root: [1; 32], nf_root: [2; 32] },
            issued_at: 1_790_035_200,
            expires_at: 1_790_640_000,
            revocation: [9; 16],
            evidence: Evidence { public_inputs: vec![[3; 32]; 9], proof: vec![0xab; 2_208], signature: [5; 64] },
        }
    }

    #[test]
    fn round_trip_every_claim() {
        for claim in [
            Claim::HoldsAtLeast { zatoshi: 50_000_000_000 },
            Claim::HoldsExactly { zatoshi: 1 },
            Claim::ReceivedPayment { txid: [0xcd; 32], zatoshi: 1_200_000_000 },
            Claim::ReceivedAtLeastSince { zatoshi: 5, from_height: 3_000_000 },
        ] {
            let e = sample(claim);
            let f = encode(&e);
            let (d, _) = decode(&f).unwrap();
            assert_eq!(d, e);
            assert_eq!(from_base64url(&to_base64url(&f)).unwrap(), f);
        }
    }

    #[test]
    fn distinct_errors() {
        let f = encode(&sample(Claim::HoldsAtLeast { zatoshi: 12_500_000 }));
        assert_eq!(decode(&f[..20]).unwrap_err(), DecodeError::TooShort);
        let mut bad = f.clone();
        bad[0] = b'X';
        assert_eq!(decode(&bad).unwrap_err(), DecodeError::BadMagic);
        let mut bad = f.clone();
        bad[4] = 2;
        assert_eq!(decode(&bad).unwrap_err(), DecodeError::UnknownVersion(2));
        let mut bad = f.clone();
        bad[100] ^= 1;
        assert_eq!(decode(&bad).unwrap_err(), DecodeError::Checksum);
    }

    #[test]
    fn statement_excludes_evidence() {
        let a = sample(Claim::HoldsAtLeast { zatoshi: 12_500_000 });
        let mut b = a.clone();
        b.evidence.proof[0] ^= 1;
        assert_eq!(statement_hash(&a), statement_hash(&b));
        b.expires_at += 1;
        assert_ne!(statement_hash(&a), statement_hash(&b));
    }
}
