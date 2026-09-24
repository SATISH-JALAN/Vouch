//! A proof request lives entirely in a URL: base64url(JSON). Mirrors `frontend/src/lib/request.ts`.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProofRequest {
    pub v: u8,
    /// Random request id, hex. Lets a verifier match a response to its request.
    #[serde(default)]
    pub id: Option<String>,
    pub claim: String,
    /// Zatoshi as a decimal string, so large values survive JSON.
    #[serde(with = "dec")]
    pub zatoshi: u64,
    pub audience: String,
    pub expiry_days: u32,
    /// Unix seconds the verifier wants an answer by.
    #[serde(default)]
    pub respond_by: Option<u64>,
    /// "solana" when the proof must be bound to the holder's Solana account (on-chain audiences).
    #[serde(default)]
    pub bind: Option<String>,
}

mod dec {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        String::deserialize(d)?.parse().map_err(D::Error::custom)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    #[error("the request is not valid base64url")]
    Encoding,
    #[error("the request does not parse: {0}")]
    Json(String),
    #[error("{0}")]
    Invalid(&'static str),
}

impl ProofRequest {
    pub fn decode(encoded: &str) -> Result<Self, RequestError> {
        let bytes = pof_core::from_base64url(encoded).map_err(|_| RequestError::Encoding)?;
        let r: ProofRequest = serde_json::from_slice(&bytes).map_err(|e| RequestError::Json(e.to_string()))?;
        r.validate()?;
        Ok(r)
    }

    pub fn encode(&self) -> String {
        pof_core::to_base64url(serde_json::to_string(self).expect("serialisable").as_bytes())
    }

    pub fn validate(&self) -> Result<(), RequestError> {
        if self.v != 1 {
            return Err(RequestError::Invalid("unknown request version"));
        }
        if self.claim != "HoldsAtLeast" {
            return Err(RequestError::Invalid("this prover answers HoldsAtLeast requests"));
        }
        if self.zatoshi == 0 || self.zatoshi > pof_core::MAX_ZATOSHI {
            return Err(RequestError::Invalid("the threshold is out of range"));
        }
        if !self.zatoshi.is_multiple_of(pof_core::ZAT_PER_UNIT) {
            return Err(RequestError::Invalid("the threshold must be a multiple of 0.125 ZEC"));
        }
        if self.audience.trim().is_empty() {
            return Err(RequestError::Invalid("the request names no audience"));
        }
        if !(1..=365).contains(&self.expiry_days) {
            return Err(RequestError::Invalid("expiry must be 1–365 days"));
        }
        Ok(())
    }

    /// The claim as an English sentence, identical to the web review screen.
    pub fn sentence(&self) -> String {
        format!(
            "{} asks you to prove you hold at least {} ZEC. Valid {} day{} after you generate it.",
            self.audience.trim(),
            zec(self.zatoshi),
            self.expiry_days,
            if self.expiry_days == 1 { "" } else { "s" }
        )
    }
}

pub fn zec(z: u64) -> String {
    let whole = z / 100_000_000;
    let frac = format!("{:08}", z % 100_000_000);
    let frac = frac.trim_end_matches('0');
    let mut w = String::new();
    let s = whole.to_string();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            w.push(',');
        }
        w.push(c);
    }
    if frac.is_empty() {
        w
    } else {
        format!("{w}.{frac}")
    }
}
