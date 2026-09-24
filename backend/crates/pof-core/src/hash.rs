//! Every hash in the format, domain-separated with a blake2b personalisation so no value
//! computed for one purpose can be replayed as another.

use crate::{codec::encode_head, Envelope};

fn h(personal: &[u8; 16], parts: &[&[u8]]) -> [u8; 32] {
    let mut st = blake2b_simd::Params::new().hash_length(32).personal(personal).to_state();
    for p in parts {
        st.update(p);
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(st.finalize().as_bytes());
    out
}

/// blake2b-256 of `"pof-audience:" ‖ lowercase(trim(id))`, unkeyed and unpersonalised so a
/// verifier can compute it in any language with one call.
pub fn audience_hash(id: &str) -> [u8; 32] {
    let s = format!("pof-audience:{}", id.trim().to_lowercase());
    let mut out = [0u8; 32];
    out.copy_from_slice(blake2b_simd::Params::new().hash_length(32).hash(s.as_bytes()).as_bytes());
    out
}

/// The revocation tag for a holder-held secret. Revoking = publishing `secret`.
pub fn revocation_tag(secret: &[u8; 32]) -> [u8; 16] {
    let full = h(b"vouch-revoke-v1\0", &[secret]);
    let mut out = [0u8; 16];
    out.copy_from_slice(&full[..16]);
    out
}

/// The statement: claim, audience, binding, anchor, issue and expiry, revocation tag.
/// The proof's round id is derived from this, so changing any of them breaks the proof.
pub fn statement_hash(e: &Envelope) -> [u8; 32] {
    h(b"vouch-stmt-v1\0\0\0", &[&encode_head(e)])
}

/// What the spend-authorisation key signs: the statement and the carried public inputs.
pub fn signing_message(e: &Envelope) -> [u8; 32] {
    let st = statement_hash(e);
    let mut parts: Vec<&[u8]> = vec![&st];
    for pi in &e.evidence.public_inputs {
        parts.push(pi);
    }
    h(b"vouch-sig-v1\0\0\0\0", &parts)
}

/// A stable id for one proof, used as the on-chain receipt seed. Independent of when or by
/// whom it was attested, so one proof yields at most one receipt.
pub fn subject_hash(e: &Envelope) -> [u8; 32] {
    h(b"vouch-subject-v1", &[&statement_hash(e)])
}
