//! pof-attest — the one irreducible service.
//!
//! Solana cannot verify a Halo2 proof over Pallas or read Zcash state, so this service runs
//! `pof-verify` (the same code as the CLI and the browser) and signs the verdict with Ed25519
//! for `pof-gate` to check through instruction introspection. It is deliberately boring,
//! stateless apart from its key, and replaceable: anyone can run one, and anyone can re-derive
//! any verdict it signed from the proof and public chain data.
//!
//!   POST /v1/attest       {proof, audience?}   → 200 {attestation} | 422 {verdict}
//!   POST /v1/verify       {proof, audience?}   → 200 VerificationResult (no signature)
//!   GET  /v1/pubkey                            → {pubkey, verifier, demoProver}
//!   GET  /v1/anchor/:h                         → anchor records at height h
//!   POST /v1/demo/prove   {request, bindSolana?} → {proof, revocationSecret, …}   (feature demo-prover)
//!   GET  /health
//!
//! Environment: POF_ATTEST_KEY (hex Ed25519 seed; generated and printed if unset),
//! POF_ANCHORS (anchor table JSON), POF_REVOCATIONS_URL (the site's /api/revocations),
//! POF_REVOCATIONS_FILE (static list), POF_AUDIENCE (default pof-credit:usdc-pool-1),
//! SOLANA_RPC_URL (for the freshness slot), POF_DEMO_WORLD (enables the demo holder), PORT.

use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime},
};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use ed25519_dalek::{Signer, SigningKey};
use pof_core::{decode, subject_hash, Claim, Envelope};
use pof_verify::{verify, AnchorRecord, Context, Verdict, ZkVerifier};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{Mutex, Semaphore};

pub const DOMAIN: &[u8; 13] = b"POF-ATTEST-v1";
pub const MESSAGE_LEN: usize = 139;

struct App {
    key: SigningKey,
    zk: ZkVerifier,
    anchors: Vec<AnchorRecord>,
    audience: String,
    revocations_url: Option<String>,
    static_revocations: Vec<String>,
    revocation_cache: Mutex<(Instant, Vec<String>)>,
    rpc: Option<String>,
    http: reqwest::Client,
    #[cfg(feature = "demo-prover")]
    demo: Option<demo::Demo>,
    provers: Semaphore,
}

fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs()
}

/// The domain-separated message pof-gate checks. Layout (little-endian integers):
/// domain 13 · subject 32 · beneficiary 32 · audience 32 · claim_kind 1 · claim_value 8 ·
/// anchor_height 4 · expires_at 8 · verdict 1 · slot 8 = 139 bytes.
pub fn attestation_message(env: &Envelope, slot: u64) -> [u8; MESSAGE_LEN] {
    let mut m = [0u8; MESSAGE_LEN];
    m[0..13].copy_from_slice(DOMAIN);
    m[13..45].copy_from_slice(&subject_hash(env));
    m[45..77].copy_from_slice(&env.binding);
    m[77..109].copy_from_slice(&env.audience);
    m[109] = env.claim.tag();
    m[110..118].copy_from_slice(&env.claim.zatoshi().to_le_bytes());
    m[118..122].copy_from_slice(&env.anchor.height.to_le_bytes());
    m[122..130].copy_from_slice(&env.expires_at.to_le_bytes());
    m[130] = 0; // Valid: nothing else is ever signed
    m[131..139].copy_from_slice(&slot.to_le_bytes());
    m
}

impl App {
    async fn revoked(&self) -> Vec<String> {
        let mut out = self.static_revocations.clone();
        let Some(url) = &self.revocations_url else { return out };
        let mut cache = self.revocation_cache.lock().await;
        if cache.0.elapsed() > Duration::from_secs(10) || cache.1.is_empty() {
            #[derive(Deserialize)]
            struct List {
                secrets: Vec<String>,
            }
            match self.http.get(url).timeout(Duration::from_secs(4)).send().await {
                Ok(r) => match r.json::<List>().await {
                    Ok(l) => *cache = (Instant::now(), l.secrets),
                    Err(e) => tracing::warn!("revocation list unreadable: {e}"),
                },
                // Fail closed would stop the demo on a network blip; fail open is logged. The
                // on-chain consumer can re-check revocation before acting.
                Err(e) => tracing::warn!("revocation list unreachable: {e}"),
            }
        }
        out.extend(cache.1.iter().cloned());
        out
    }

    async fn slot(&self) -> anyhow::Result<u64> {
        let Some(rpc) = &self.rpc else { return Ok(0) };
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "getSlot", "params": [{ "commitment": "confirmed" }] });
        let r: serde_json::Value = self.http.post(rpc).json(&body).timeout(Duration::from_secs(5)).send().await?.json().await?;
        r["result"].as_u64().ok_or_else(|| anyhow::anyhow!("getSlot: {r}"))
    }

    async fn check(&self, proof: &str, audience: Option<&str>) -> pof_verify::VerificationResult {
        let revoked = self.revoked().await;
        let aud = audience.unwrap_or(&self.audience).to_string();
        verify(proof.as_bytes(), &Context { audience: &aud, anchors: &self.anchors, revoked_secrets: &revoked, now: now(), zk: &self.zk })
    }
}

#[derive(Deserialize)]
struct ProofBody {
    proof: String,
    audience: Option<String>,
}

fn err(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

async fn attest(State(app): State<Arc<App>>, Json(b): Json<ProofBody>) -> Response {
    let started = Instant::now();
    let r = app.check(&b.proof, b.audience.as_deref()).await;
    if !matches!(r.verdict, Verdict::Valid { .. }) {
        tracing::info!(verdict = ?r.verdict, ms = started.elapsed().as_millis() as u64, "refused");
        return (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({ "verdict": r.verdict }))).into_response();
    }
    let bytes = match pof_verify::to_bytes(b.proof.as_bytes()) {
        Ok(b) => b,
        Err(e) => return err(StatusCode::BAD_REQUEST, e.to_string()),
    };
    let Ok((env, _)) = decode(&bytes) else { return err(StatusCode::BAD_REQUEST, "proof does not decode") };
    if env.binding == [0; 32] {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "verdict": { "kind": "Malformed", "reason": "An on-chain attestation needs a proof bound to a Solana account; this one is unbound." } })),
        )
            .into_response();
    }
    let slot = match app.slot().await {
        Ok(s) => s,
        Err(e) => return err(StatusCode::BAD_GATEWAY, format!("could not read the Solana slot: {e}")),
    };
    let msg = attestation_message(&env, slot);
    let sig = app.key.sign(&msg);
    tracing::info!(slot, ms = started.elapsed().as_millis() as u64, "signed");
    let Claim::HoldsAtLeast { zatoshi } = env.claim else { return err(StatusCode::UNPROCESSABLE_ENTITY, "unsupported claim") };
    Json(json!({
        "attestation": {
            "domain": "POF-ATTEST-v1",
            "subject": hex::encode(subject_hash(&env)),
            "beneficiary": bs58::encode(env.binding).into_string(),
            "claimKind": 0,
            "claimValue": zatoshi,
            "anchorHeight": env.anchor.height,
            "expiresAt": env.expires_at,
            "verdict": 0,
            "slot": slot,
            "message": hex::encode(msg),
            "signature": hex::encode(sig.to_bytes()),
            "attestor": bs58::encode(app.key.verifying_key().to_bytes()).into_string(),
        }
    }))
    .into_response()
}

async fn verify_only(State(app): State<Arc<App>>, Json(b): Json<ProofBody>) -> Response {
    Json(app.check(&b.proof, b.audience.as_deref()).await).into_response()
}

async fn pubkey(State(app): State<Arc<App>>) -> Response {
    #[cfg(feature = "demo-prover")]
    let demo = app.demo.is_some();
    #[cfg(not(feature = "demo-prover"))]
    let demo = false;
    Json(json!({
        "pubkey": bs58::encode(app.key.verifying_key().to_bytes()).into_string(),
        "verifier": pof_verify::VERIFIER_VERSION,
        "vkFingerprint": app.zk.fingerprint(),
        "audience": app.audience,
        "demoProver": demo,
    }))
    .into_response()
}

async fn anchor(State(app): State<Arc<App>>, Path(h): Path<u32>) -> Response {
    let rs: Vec<_> = app.anchors.iter().filter(|a| a.height == h).cloned().collect();
    if rs.is_empty() {
        return err(StatusCode::NOT_FOUND, format!("no anchor at height {h}"));
    }
    Json(rs).into_response()
}

#[cfg(feature = "demo-prover")]
mod demo {
    use super::*;
    use pof_prove::{envelope_for, world::DemoWorld, ProofRequest, Snapshot};

    pub struct Demo {
        pub world: DemoWorld,
        pub snap: Snapshot,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ProveBody {
        request: ProofRequest,
        bind_solana: Option<String>,
    }

    pub async fn prove(State(app): State<Arc<App>>, Json(b): Json<ProveBody>) -> Response {
        let Some(demo) = &app.demo else { return err(StatusCode::SERVICE_UNAVAILABLE, "the demo holder is not enabled (POF_DEMO_WORLD is unset)") };
        if let Err(e) = b.request.validate() {
            return err(StatusCode::BAD_REQUEST, e.to_string());
        }
        let binding = match (&b.request.bind, &b.bind_solana) {
            (_, Some(k)) => match bs58::decode(k.trim()).into_vec().ok().and_then(|v| <[u8; 32]>::try_from(v).ok()) {
                Some(k) => k,
                None => return err(StatusCode::BAD_REQUEST, "bindSolana is not a base58 Solana public key"),
            },
            (Some(_), None) => return err(StatusCode::BAD_REQUEST, "this request must be bound to a Solana account: send bindSolana"),
            (None, None) => [0u8; 32],
        };
        let Ok(_permit) = app.provers.try_acquire() else { return err(StatusCode::TOO_MANY_REQUESTS, "the demo holder is busy; try again in a few seconds") };
        let mut secret = [0u8; 32];
        getrandom::getrandom(&mut secret).expect("OS randomness");
        let mut env = envelope_for(&b.request, demo.snap.anchor(), now(), binding, &secret);
        let started = Instant::now();
        let notes = match demo.world.notes() {
            Ok(n) => n,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };
        let sk = match demo.world.spending_key() {
            Ok(k) => k,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };
        // Proving is CPU-bound: keep it off the async workers.
        let snap = &demo.snap;
        let result = tokio::task::block_in_place(|| pof_prove::prove(&sk, &notes, snap, &mut env));
        match result {
            Ok(n) => {
                let ms = started.elapsed().as_millis() as u64;
                tracing::info!(ms, notes = n, "demo proof");
                Json(json!({
                    "proof": pof_core::to_base64url(&pof_core::encode(&env)),
                    "revocationSecret": hex::encode(secret),
                    "notesUsed": n,
                    "provingMs": ms,
                }))
                .into_response()
            }
            Err(e) => err(StatusCode::UNPROCESSABLE_ENTITY, e.to_string()),
        }
    }
}

fn load_key() -> SigningKey {
    match std::env::var("POF_ATTEST_KEY") {
        Ok(h) => {
            let b: [u8; 32] = hex::decode(h.trim()).ok().and_then(|v| v.try_into().ok()).expect("POF_ATTEST_KEY must be 32 bytes of hex");
            SigningKey::from_bytes(&b)
        }
        Err(_) => {
            let mut seed = [0u8; 32];
            getrandom::getrandom(&mut seed).expect("OS randomness");
            let k = SigningKey::from_bytes(&seed);
            eprintln!("POF_ATTEST_KEY unset: generated an ephemeral key. Set POF_ATTEST_KEY={} to keep it.", hex::encode(seed));
            k
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let anchors_path = std::env::var("POF_ANCHORS").unwrap_or_else(|_| "fixtures/anchors.json".into());
    let anchors: Vec<AnchorRecord> = serde_json::from_slice(&std::fs::read(&anchors_path).map_err(|e| anyhow::anyhow!("{anchors_path}: {e}"))?)?;
    let static_revocations = match std::env::var("POF_REVOCATIONS_FILE") {
        Ok(p) => {
            let v: serde_json::Value = serde_json::from_slice(&std::fs::read(p)?)?;
            v["secrets"].as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect()).unwrap_or_default()
        }
        Err(_) => vec![],
    };
    #[cfg(feature = "demo-prover")]
    let demo = match std::env::var("POF_DEMO_WORLD") {
        Ok(p) => {
            let world: pof_prove::world::DemoWorld = serde_json::from_slice(&std::fs::read(&p)?)?;
            let snap = world.snapshot()?;
            tracing::info!(leaves = snap.tree.size(), "demo holder enabled");
            Some(demo::Demo { world, snap })
        }
        Err(_) => None,
    };
    let app = Arc::new(App {
        key: load_key(),
        zk: ZkVerifier::new().map_err(|e| anyhow::anyhow!(e))?,
        anchors,
        audience: std::env::var("POF_AUDIENCE").unwrap_or_else(|_| "pof-credit:usdc-pool-1".into()),
        revocations_url: std::env::var("POF_REVOCATIONS_URL").ok(),
        static_revocations,
        revocation_cache: Mutex::new((Instant::now(), vec![])),
        rpc: std::env::var("SOLANA_RPC_URL").ok(),
        http: reqwest::Client::new(),
        #[cfg(feature = "demo-prover")]
        demo,
        provers: Semaphore::new(2),
    });
    tracing::info!(pubkey = %bs58::encode(app.key.verifying_key().to_bytes()).into_string(), anchors = app.anchors.len(), "pof-attest ready");

    let router = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/v1/pubkey", get(pubkey))
        .route("/v1/anchor/{h}", get(anchor))
        .route("/v1/attest", post(attest))
        .route("/v1/verify", post(verify_only));
    #[cfg(feature = "demo-prover")]
    let router = router.route("/v1/demo/prove", post(demo::prove));
    let router = router.with_state(app);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8787".into());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    tracing::info!("listening on :{port}");
    axum::serve(listener, router).with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; }).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_layout_is_139_bytes_and_domain_separated() {
        let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../fixtures/proofs/valid.pof")).unwrap();
        let (env, _) = decode(&bytes).unwrap();
        let m = attestation_message(&env, 42);
        assert_eq!(m.len(), 139);
        assert_eq!(&m[..13], b"POF-ATTEST-v1");
        assert_eq!(u64::from_le_bytes(m[110..118].try_into().unwrap()), 50_000_000_000);
        assert_eq!(u64::from_le_bytes(m[131..139].try_into().unwrap()), 42);
        assert_eq!(&m[77..109], &env.audience);
    }
}
