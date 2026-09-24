//! Every committed vector produces its recorded verdict. The WASM build runs the same list
//! (frontend `scripts/verify-fixtures.ts`), so the two verifiers cannot drift apart.

use pof_verify::{verify, AnchorRecord, Context, ZkVerifier};
use serde_json::Value;
use std::path::PathBuf;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures")
}

#[test]
fn every_vector_matches_expected() {
    let dir = fixtures();
    let anchors: Vec<AnchorRecord> = serde_json::from_slice(&std::fs::read(dir.join("anchors.demo.json")).unwrap()).unwrap();
    let revoked: Value = serde_json::from_slice(&std::fs::read(dir.join("revocations.demo.json")).unwrap()).unwrap();
    let revoked: Vec<String> = revoked["secrets"].as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect();
    let meta: Value = serde_json::from_slice(&std::fs::read(dir.join("expected.json")).unwrap()).unwrap();
    let now = meta["evaluatedAt"].as_u64().unwrap();
    let zk = ZkVerifier::new().unwrap();
    let mut failures = vec![];
    for (name, want) in meta["expected"].as_object().unwrap() {
        let file = std::fs::read(dir.join("proofs").join(format!("{name}.pof"))).unwrap();
        let audience = want["audience"].as_str().unwrap();
        let r = verify(&file, &Context { audience, anchors: &anchors, revoked_secrets: &revoked, now, zk: &zk });
        let got = serde_json::to_value(&r.verdict).unwrap()["kind"].as_str().unwrap().to_string();
        let want = want["verdict"].as_str().unwrap();
        println!("{name:<18} {got}");
        if got != want {
            failures.push(format!("{name}: got {got}, want {want}"));
        }
    }
    // base64url text input and garbage
    let valid = std::fs::read(dir.join("proofs/valid.pof")).unwrap();
    let text = pof_core::to_base64url(&valid);
    let r = verify(text.as_bytes(), &Context { audience: "pof-credit:usdc-pool-1", anchors: &anchors, revoked_secrets: &revoked, now, zk: &zk });
    assert_eq!(serde_json::to_value(&r.verdict).unwrap()["kind"], "Valid");
    let r = verify(&text.as_bytes()[..900], &Context { audience: "x", anchors: &anchors, revoked_secrets: &revoked, now, zk: &zk });
    assert_eq!(serde_json::to_value(&r.verdict).unwrap()["kind"], "Malformed");
    assert!(failures.is_empty(), "{failures:#?}");
}
