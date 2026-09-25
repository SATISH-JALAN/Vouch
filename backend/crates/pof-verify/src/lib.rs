//! The Vouch verifier. One implementation, compiled natively (CLI, attestor) and to WASM.
//!
//! Six checks, cheapest first; the first failure stops the run, and no cryptography is done
//! on an artifact that failed a cheap check. Chain data (the anchor table) and the
//! revocation list are passed in as data: this crate never touches the network or disk.

use std::collections::HashSet;

use pof_core::{audience_hash, decode, revocation_tag, Claim, DecodeError, Envelope};
pub use pof_zk::Verifier as ZkVerifier;
use serde::{Deserialize, Serialize};

/// One authenticated anchor: the two ledger roots at a finalised height, and where they came from.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorRecord {
    /// "mainnet", "testnet", or "demo" for the committed demonstration tree.
    pub network: String,
    pub height: u32,
    #[serde(default)]
    pub block_hash: Option<String>,
    /// hex, 32 bytes
    pub nc_root: String,
    /// hex, 32 bytes
    pub nf_root: String,
}

/// The typed outcome. This enum is the UI copy and the API surface.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum Verdict {
    Valid {
        claim: Claim,
        #[serde(rename = "anchorHeight")]
        anchor_height: u32,
    },
    Expired {
        at: u64,
    },
    Revoked,
    WrongAudience,
    AnchorNotFound,
    ProofInvalid {
        detail: String,
    },
    Malformed {
        reason: String,
    },
}

impl Verdict {
    /// CLI exit code: 0 valid · 1 invalid · 2 expired · 3 malformed. The CLI keeps 4 for "could not run".
    pub fn exit_code(&self) -> i32 {
        match self {
            Verdict::Valid { .. } => 0,
            Verdict::Expired { .. } => 2,
            Verdict::Malformed { .. } => 3,
            _ => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CheckStatus {
    Pass,
    Fail,
    NotRun,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Check {
    pub id: &'static str,
    pub label: &'static str,
    pub status: CheckStatus,
    pub detail: String,
}

/// Human-readable projection of an envelope, for display. Mirrors the TypeScript `Envelope`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeView {
    pub version: u16,
    #[serde(flatten)]
    pub envelope: Envelope,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
    pub verdict: Verdict,
    pub checks: Vec<Check>,
    pub envelope: Option<EnvelopeView>,
    pub size_bytes: usize,
    pub checksum: Option<String>,
    /// The anchor record the proof was checked against, when one matched.
    pub anchor: Option<AnchorRecord>,
    /// Unix seconds the verification was evaluated at.
    pub now: u64,
    pub verifier: &'static str,
}

pub const VERIFIER_VERSION: &str = concat!("pof-verify ", env!("CARGO_PKG_VERSION"));

/// Everything a verification depends on besides the file itself.
pub struct Context<'a> {
    /// The verifier's own identifier; only its hash is compared.
    pub audience: &'a str,
    pub anchors: &'a [AnchorRecord],
    /// Published revocation secrets (hex, 32 bytes). Tags are derived from them.
    pub revoked_secrets: &'a [String],
    pub now: u64,
    pub zk: &'a ZkVerifier,
}

const ORDER: [(&str, &str); 6] = [
    ("format", "Format and version parse"),
    ("expiry", "Not expired"),
    ("revocation", "Not revoked"),
    ("audience", "Audience matches this verifier"),
    ("anchor", "Anchor is real"),
    ("proof", "Proof verifies against the claim"),
];

fn stamp(sec: u64) -> String {
    // yyyy-mm-dd hh:mm UTC without a date library (civil-from-days, Howard Hinnant).
    let days = (sec / 86_400) as i64;
    let secs = sec % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02} UTC", secs / 3_600, (secs % 3_600) / 60)
}

fn thousands(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Parse a file given as raw bytes or as base64url text.
pub fn to_bytes(input: &[u8]) -> Result<Vec<u8>, DecodeError> {
    if input.starts_with(b"POF1") {
        return Ok(input.to_vec());
    }
    let text = std::str::from_utf8(input).map_err(|_| DecodeError::NotBase64)?;
    pof_core::from_base64url(text)
}

pub fn verify(input: &[u8], ctx: &Context) -> VerificationResult {
    let mut checks: Vec<Check> = ORDER
        .iter()
        .map(|(id, label)| Check { id, label, status: CheckStatus::NotRun, detail: "Not run — an earlier check failed.".into() })
        .collect();
    let mut set = |i: usize, status: CheckStatus, detail: String| {
        checks[i].status = status;
        checks[i].detail = detail;
    };
    let result = |verdict: Verdict, env: Option<&Envelope>, checksum: Option<[u8; 32]>, size: usize, anchor: Option<AnchorRecord>, checks: Vec<Check>| {
        VerificationResult {
            verdict,
            checks,
            envelope: env.map(|e| EnvelopeView { version: pof_core::FORMAT_VERSION, envelope: e.clone() }),
            size_bytes: size,
            checksum: checksum.map(hex::encode),
            anchor,
            now: ctx.now,
            verifier: VERIFIER_VERSION,
        }
    };

    // 1 · format
    let file = match to_bytes(input) {
        Ok(f) if !f.is_empty() => f,
        _ => {
            let reason = DecodeError::NotBase64.to_string();
            set(0, CheckStatus::Fail, reason.clone());
            return result(Verdict::Malformed { reason }, None, None, 0, None, checks);
        }
    };
    let size = file.len();
    let (env, checksum) = match decode(&file) {
        Ok(v) => v,
        Err(e) => {
            set(0, CheckStatus::Fail, e.to_string());
            return result(Verdict::Malformed { reason: e.to_string() }, None, None, size, None, checks);
        }
    };
    if !matches!(env.claim, Claim::HoldsAtLeast { .. }) {
        let reason = "This verifier version checks HoldsAtLeast proofs only.".to_string();
        set(0, CheckStatus::Fail, reason.clone());
        return result(Verdict::Malformed { reason }, Some(&env), Some(checksum), size, None, checks);
    }
    if env.claim.min_units().is_none() {
        let reason = "The threshold is not a whole number of 0.125 ZEC units.".to_string();
        set(0, CheckStatus::Fail, reason.clone());
        return result(Verdict::Malformed { reason }, Some(&env), Some(checksum), size, None, checks);
    }
    set(0, CheckStatus::Pass, format!("POF1 · version 1 · {} bytes · checksum ok", thousands(size as u64)));

    // 2 · expiry
    if ctx.now >= env.expires_at {
        set(1, CheckStatus::Fail, format!("Expired {}.", stamp(env.expires_at)));
        return result(Verdict::Expired { at: env.expires_at }, Some(&env), Some(checksum), size, None, checks);
    }
    let days = (env.expires_at - ctx.now) / 86_400;
    set(1, CheckStatus::Pass, format!("Valid until {} — {} day{} left.", stamp(env.expires_at), days, if days == 1 { "" } else { "s" }));

    // 3 · revocation
    let revoked: HashSet<[u8; 16]> = ctx
        .revoked_secrets
        .iter()
        .filter_map(|s| hex::decode(s.trim()).ok()?.try_into().ok())
        .map(|secret: [u8; 32]| revocation_tag(&secret))
        .collect();
    if revoked.contains(&env.revocation) {
        set(2, CheckStatus::Fail, "The holder revoked this proof: its revocation secret is published.".into());
        return result(Verdict::Revoked, Some(&env), Some(checksum), size, None, checks);
    }
    set(2, CheckStatus::Pass, format!("Tag {}… is not on the revocation list ({} revoked).", &hex::encode(env.revocation)[..8], revoked.len()));

    // 4 · audience
    if audience_hash(ctx.audience) != env.audience {
        set(3, CheckStatus::Fail, format!("This proof was made for someone else. Your identifier \"{}\" does not match.", ctx.audience.trim()));
        return result(Verdict::WrongAudience, Some(&env), Some(checksum), size, None, checks);
    }
    set(3, CheckStatus::Pass, format!("blake2b(\"{}\") matches the audience field.", ctx.audience.trim()));

    // 5 · anchor — both roots must equal an authenticated record at that height
    let nc = hex::encode(env.anchor.nc_root);
    let nf = hex::encode(env.anchor.nf_root);
    let record = ctx
        .anchors
        .iter()
        .find(|a| a.height == env.anchor.height && a.nc_root.eq_ignore_ascii_case(&nc) && a.nf_root.eq_ignore_ascii_case(&nf))
        .cloned();
    let Some(record) = record else {
        set(4, CheckStatus::Fail, format!("No authenticated anchor with these roots at block {}.", thousands(env.anchor.height as u64)));
        return result(Verdict::AnchorNotFound, Some(&env), Some(checksum), size, None, checks);
    };
    set(
        4,
        CheckStatus::Pass,
        format!("Block {} ({}): note-commitment root and nullifier-set root both match.", thousands(record.height as u64), record.network),
    );

    // 6 · proof
    match ctx.zk.verify_holding(&env) {
        Ok(()) => {
            set(5, CheckStatus::Pass, "Halo2 proof and spend-authorisation signature verify for this exact statement.".into());
            let verdict = Verdict::Valid { claim: env.claim.clone(), anchor_height: env.anchor.height };
            result(verdict, Some(&env), Some(checksum), size, Some(record), checks)
        }
        Err(e) => {
            // Say that it failed, never which constraint: detail is for debugging an attack.
            let detail = match e {
                pof_zk::ZkError::BadSignature | pof_zk::ZkError::BadKey => "the statement was altered after proving, or the signature is not the holder's.",
                pof_zk::ZkError::DuplicateNote => "the same note is counted more than once.",
                _ => "the evidence does not prove this statement.",
            };
            set(5, CheckStatus::Fail, format!("Proof does not verify: {detail}"));
            result(Verdict::ProofInvalid { detail: detail.into() }, Some(&env), Some(checksum), size, Some(record), checks)
        }
    }
}
