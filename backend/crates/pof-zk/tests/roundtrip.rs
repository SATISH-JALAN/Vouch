//! Real proofs over a synthetic tree: honest, tampered, forged, spent, insufficient.
//! Run: cargo test --release -p pof-zk --features prove -- --ignored

#![cfg(feature = "prove")]

use pof_core::{audience_hash, revocation_tag, Anchor, Claim, Envelope, Evidence};
use pof_zk::{base_to_bytes, prove_holding, DenseImtProvider, HeldNote, ImtProvider, NoteTree, ProveError, Verifier, ZkError};
use voting_circuits::ff::Field;
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, Scope, SpendingKey},
    note::{commitment::ExtractedNoteCommitment, Note, NoteVersion, Rho},
    value::NoteValue,
};
use voting_crypto_deps::pasta_curves::pallas;

const ZEC: u64 = 100_000_000;

struct World {
    sk: SpendingKey,
    notes: Vec<(Note, u32)>,
    tree: NoteTree,
    imt: DenseImtProvider,
    spent_note: (Note, u32),
}

fn note(fvk: &FullViewingKey, value: u64, rng: &mut OsRng) -> Note {
    let (_, _, dummy) = Note::dummy(rng, None, NoteVersion::V3);
    Note::new(
        fvk.address_at(0u32, Scope::External),
        NoteValue::from_raw(value),
        Rho::from_nf_old(dummy.nullifier(fvk)),
        NoteVersion::V3,
        rng,
    )
}

fn world() -> World {
    let mut rng = OsRng;
    let sk = SpendingKey::random(&mut rng);
    let fvk = FullViewingKey::from(&sk);
    let stranger = FullViewingKey::from(&SpendingKey::random(&mut rng));
    let mut leaves = Vec::new();
    let mut spent_nfs = Vec::new();
    for i in 0..40u64 {
        leaves.push(ExtractedNoteCommitment::from(note(&stranger, i + 1, &mut rng).commitment()).to_bytes());
        spent_nfs.push(pallas::Base::random(&mut rng));
    }
    let mut notes = Vec::new();
    for v in [2 * ZEC, 3 * ZEC, ZEC + ZEC / 2] {
        let n = note(&fvk, v, &mut rng);
        notes.push((n, leaves.len() as u32));
        leaves.push(ExtractedNoteCommitment::from(n.commitment()).to_bytes());
    }
    let spent = note(&fvk, 10 * ZEC, &mut rng);
    let spent_pos = leaves.len() as u32;
    leaves.push(ExtractedNoteCommitment::from(spent.commitment()).to_bytes());
    spent_nfs.push(spent.nullifier(&fvk).inner());
    World {
        sk,
        notes,
        tree: NoteTree::from_cmx(&leaves).unwrap(),
        imt: DenseImtProvider::from_nullifiers(&spent_nfs),
        spent_note: (spent, spent_pos),
    }
}

fn envelope(w: &World, zatoshi: u64) -> Envelope {
    Envelope {
        claim: Claim::HoldsAtLeast { zatoshi },
        audience: audience_hash("pof-credit:usdc-pool-1"),
        binding: [0; 32],
        anchor: Anchor { height: 3_491_040, nc_root: w.tree.root(), nf_root: base_to_bytes(&w.imt.root()) },
        issued_at: 1_790_035_200,
        expires_at: 1_790_640_000,
        revocation: revocation_tag(&[42; 32]),
        evidence: Evidence { public_inputs: vec![], proof: vec![], signature: [0; 64] },
    }
}

fn held(w: &World, which: &[usize]) -> Vec<HeldNote> {
    which
        .iter()
        .map(|&i| {
            let (n, pos) = w.notes[i];
            HeldNote { note: n, merkle_path: w.tree.path(pos).unwrap(), scope: Scope::External }
        })
        .collect()
}

#[test]
#[ignore = "real proofs"]
fn threshold_roundtrip_and_tampering() {
    let w = world();
    let v = Verifier::new().unwrap();
    let mut env = envelope(&w, 5 * ZEC);
    prove_holding(&w.sk, held(&w, &[0, 1]), &w.imt, &mut env).unwrap();
    v.verify_holding(&env).expect("honest proof verifies");
    let file = pof_core::encode(&env);
    println!("proof file: {} bytes, proof {} bytes", file.len(), env.evidence.proof.len());

    let mut e = env.clone();
    e.expires_at += 86_400;
    assert_eq!(v.verify_holding(&e), Err(ZkError::BadSignature), "extended expiry");
    let mut e = env.clone();
    e.claim = Claim::HoldsAtLeast { zatoshi: 6 * ZEC };
    assert!(v.verify_holding(&e).is_err(), "raised claim");
    let mut e = env.clone();
    e.audience = audience_hash("someone-else");
    assert!(v.verify_holding(&e).is_err(), "swapped audience");
    let mut e = env.clone();
    e.evidence.proof[777] ^= 1;
    assert_eq!(v.verify_holding(&e), Err(ZkError::ProofInvalid), "flipped proof byte");
    let mut e = env.clone();
    e.evidence.signature[3] ^= 1;
    assert!(v.verify_holding(&e).is_err(), "flipped signature");
    let mut e = env.clone();
    e.anchor.nc_root[0] ^= 1;
    assert!(v.verify_holding(&e).is_err(), "wrong anchor root");
}

#[test]
#[ignore = "real proofs"]
fn refuses_what_it_cannot_prove() {
    let w = world();
    let mut env = envelope(&w, 7 * ZEC);
    assert!(matches!(
        prove_holding(&w.sk, held(&w, &[0, 1, 2]), &w.imt, &mut env),
        Err(ProveError::Insufficient { .. })
    ));
    let mut env = envelope(&w, ZEC);
    let (n, pos) = w.spent_note;
    let spent = vec![HeldNote { note: n, merkle_path: w.tree.path(pos).unwrap(), scope: Scope::External }];
    assert!(matches!(prove_holding(&w.sk, spent, &w.imt, &mut env), Err(ProveError::Spent)));
    let mut env = envelope(&w, ZEC + 1);
    assert!(matches!(prove_holding(&w.sk, held(&w, &[0]), &w.imt, &mut env), Err(ProveError::NotWholeUnits)));
}

/// The circuit checks each note slot on its own, so a proof that repeats one note in all five
/// slots is a valid Halo2 proof of five times the holding. The verifier must refuse it.
#[test]
#[ignore = "real proofs"]
fn one_note_cannot_be_counted_twice() {
    use pof_core::signing_message;
    use pof_zk::round_id;
    use voting_circuits::delegation::{build_delegation_bundle, create_delegation_proof, verify_delegation_proof, RealNoteInput};
    use voting_crypto_deps::orchard::keys::{SpendAuthorizingKey, SpendValidatingKey};

    let w = world();
    let v = Verifier::new().unwrap();

    // The prover refuses outright.
    let mut env = envelope(&w, 5 * ZEC);
    assert!(matches!(prove_holding(&w.sk, held(&w, &[1, 1]), &w.imt, &mut env), Err(ProveError::DuplicateNote)));

    // A hand-built proof: the 3 ZEC note five times, claiming 15 ZEC.
    let mut rng = OsRng;
    let mut env = envelope(&w, 15 * ZEC);
    let fvk = FullViewingKey::from(&w.sk);
    let real = held(&w, &[1, 1, 1, 1, 1])
        .into_iter()
        .map(|h| RealNoteInput {
            imt_proof: w.imt.non_membership_proof(h.note.nullifier(&fvk).inner()).unwrap(),
            note: h.note,
            fvk: fvk.clone(),
            merkle_path: h.merkle_path,
            scope: h.scope,
        })
        .collect();
    let alpha = pallas::Scalar::random(&mut rng);
    let nc_root = pof_zk::base_from_bytes(&env.anchor.nc_root).unwrap();
    let bundle = build_delegation_bundle(
        real,
        &fvk,
        alpha,
        fvk.address_at(0u32, Scope::Internal),
        round_id(&env),
        nc_root,
        pallas::Base::random(&mut rng),
        &w.imt,
        &mut rng,
        None,
    )
    .unwrap();
    let instance = bundle.instance.with_min_ballots(15 * 8);
    let proof = create_delegation_proof(bundle.circuit, &instance).unwrap();
    assert!(verify_delegation_proof(&proof, &instance).is_ok(), "the circuit alone accepts the repeated note");

    let rk = SpendValidatingKey::from(fvk.clone()).randomize(&alpha);
    let mut inputs = vec![base_to_bytes(&instance.nf_signed.inner()), <[u8; 32]>::from(&rk)];
    inputs.push(base_to_bytes(&instance.cmx_new));
    inputs.push(base_to_bytes(&instance.van_comm));
    inputs.extend(instance.gov_null.iter().map(base_to_bytes));
    env.evidence.public_inputs = inputs;
    env.evidence.proof = proof;
    let sig = SpendAuthorizingKey::from(&w.sk).randomize(&alpha).sign(rng, &signing_message(&env));
    env.evidence.signature = <[u8; 64]>::from(&sig);
    assert_eq!(v.verify_holding(&env), Err(ZkError::DuplicateNote));
}
