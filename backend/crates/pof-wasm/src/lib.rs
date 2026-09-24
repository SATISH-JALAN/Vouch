//! `pof-verify`, compiled to WebAssembly for the browser verifier.
//!
//! Bytes in, verdict out. Chain data (the anchor table) and the revocation list are passed in
//! from JavaScript as JSON; nothing here fetches. The verifying key is derived once, on the
//! first call, and kept for the life of the page.

use std::cell::OnceCell;

use pof_verify::{verify as run, AnchorRecord, Context, ZkVerifier};
use wasm_bindgen::prelude::*;

thread_local! {
    static ZK: OnceCell<Result<ZkVerifier, String>> = const { OnceCell::new() };
}

fn with_zk<T>(f: impl FnOnce(&ZkVerifier) -> T) -> Result<T, String> {
    ZK.with(|cell| match cell.get_or_init(|| ZkVerifier::new().map_err(|e| e.to_string())) {
        Ok(zk) => Ok(f(zk)),
        Err(e) => Err(e.clone()),
    })
}

/// Derive the verifying key now (a few hundred ms) so the first verification is instant.
#[wasm_bindgen]
pub fn warm() -> Result<(), JsError> {
    with_zk(|_| ()).map_err(|e| JsError::new(&e))
}

/// Verify a proof. `bytes` is the binary `.pof` or its base64url text.
/// `anchors_json`: `[{network,height,ncRoot,nfRoot}]`; `revoked_json`: `["hex secret", …]`.
/// Returns the JSON projection of `VerificationResult`.
#[wasm_bindgen]
pub fn verify(bytes: &[u8], audience: &str, now_sec: u64, anchors_json: &str, revoked_json: &str) -> Result<String, JsError> {
    let anchors: Vec<AnchorRecord> = serde_json::from_str(anchors_json).map_err(|e| JsError::new(&format!("anchor table: {e}")))?;
    let revoked: Vec<String> = serde_json::from_str(revoked_json).map_err(|e| JsError::new(&format!("revocation list: {e}")))?;
    let result = with_zk(|zk| run(bytes, &Context { audience, anchors: &anchors, revoked_secrets: &revoked, now: now_sec, zk })).map_err(|e| JsError::new(&e))?;
    serde_json::to_string(&result).map_err(|e| JsError::new(&e.to_string()))
}

/// blake2b audience hash, so the request builder shows exactly what the verifier compares.
#[wasm_bindgen(js_name = audienceHash)]
pub fn audience_hash(id: &str) -> String {
    pof_core::to_base64url(&pof_core::audience_hash(id))
}

#[wasm_bindgen]
pub fn version() -> String {
    pof_verify::VERIFIER_VERSION.to_string()
}
