//! Holder-side proving. Never compiled into the verifier or the WASM build.

use pof_core::{signing_message, Claim, Envelope, ZAT_PER_UNIT};
use voting_circuits::delegation::{build_delegation_bundle, create_delegation_proof, ImtProvider, RealNoteInput};
use voting_circuits::ff::{Field, PrimeField};
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, Scope, SpendAuthorizingKey, SpendValidatingKey, SpendingKey},
    tree::MerklePath,
    Note,
};
use voting_crypto_deps::pasta_curves::pallas;

use crate::{base_from_bytes, base_to_bytes, round_id};

/// One of the holder's unspent Ironwood notes, with its path to the anchor's `nc_root`.
#[derive(Debug)]
pub struct HeldNote {
    pub note: Note,
    pub merkle_path: MerklePath,
    pub scope: Scope,
}

#[derive(Debug, thiserror::Error)]
pub enum ProveError {
    #[error("a holding proof can only assert HoldsAtLeast")]
    UnsupportedClaim,
    #[error("the threshold must be a whole number of 0.125 ZEC units")]
    NotWholeUnits,
    #[error("between 1 and 5 notes are required, got {0}")]
    NoteCount(usize),
    #[error("the selected notes total {have} zatoshi, below the {need} zatoshi threshold")]
    Insufficient { have: u64, need: u64 },
    #[error("the envelope's anchor roots do not match the tree and IMT used for proving")]
    AnchorMismatch,
    #[error("a note's nullifier is already spent at this anchor")]
    Spent,
    #[error("building the circuit failed: {0}")]
    Build(String),
    #[error("proving failed: {0}")]
    Prove(String),
}

/// Fill `env.evidence` with a real proof that `notes` (owned by `sk`, unspent at the anchor)
/// total at least the claimed threshold. Every other envelope field must already be final:
/// the proof binds to them.
pub fn prove_holding(
    sk: &SpendingKey,
    notes: Vec<HeldNote>,
    imt: &impl ImtProvider,
    env: &mut Envelope,
) -> Result<(), ProveError> {
    let min = match env.claim {
        Claim::HoldsAtLeast { .. } => env.claim.min_units().ok_or(ProveError::NotWholeUnits)?,
        _ => return Err(ProveError::UnsupportedClaim),
    };
    if notes.is_empty() || notes.len() > 5 {
        return Err(ProveError::NoteCount(notes.len()));
    }
    let have: u64 = notes.iter().map(|n| n.note.value().inner()).sum();
    if have / ZAT_PER_UNIT < min {
        return Err(ProveError::Insufficient { have, need: min * ZAT_PER_UNIT });
    }
    let nc_root = base_from_bytes(&env.anchor.nc_root).map_err(|_| ProveError::AnchorMismatch)?;
    if base_to_bytes(&imt.root()) != env.anchor.nf_root {
        return Err(ProveError::AnchorMismatch);
    }

    let fvk = FullViewingKey::from(sk);
    let mut rng = OsRng;
    let mut real = Vec::with_capacity(notes.len());
    for held in notes {
        let nf = held.note.nullifier(&fvk);
        let imt_proof = imt.non_membership_proof(nf.inner()).map_err(|_| ProveError::Spent)?;
        real.push(RealNoteInput { note: held.note, fvk: fvk.clone(), merkle_path: held.merkle_path, imt_proof, scope: held.scope });
    }

    let alpha = pallas::Scalar::random(&mut rng);
    let bundle = build_delegation_bundle(
        real,
        &fvk,
        alpha,
        fvk.address_at(0u32, Scope::Internal),
        round_id(env),
        nc_root,
        pallas::Base::random(&mut rng),
        imt,
        &mut rng,
        None,
    )
    .map_err(|e| ProveError::Build(e.to_string()))?;
    let instance = bundle.instance.with_min_ballots(min);
    let proof = create_delegation_proof(bundle.circuit, &instance).map_err(|e| ProveError::Prove(e.to_string()))?;

    let rk = SpendValidatingKey::from(fvk.clone()).randomize(&alpha);
    let mut inputs = vec![instance.nf_signed.inner().to_repr(), <[u8; 32]>::from(&rk)];
    inputs.push(base_to_bytes(&instance.cmx_new));
    inputs.push(base_to_bytes(&instance.van_comm));
    inputs.extend(instance.gov_null.iter().map(base_to_bytes));
    env.evidence.public_inputs = inputs;
    env.evidence.proof = proof;

    let rsk = SpendAuthorizingKey::from(sk).randomize(&alpha);
    let sig = rsk.sign(rng, &signing_message(env));
    env.evidence.signature = <[u8; 64]>::from(&sig);
    Ok(())
}
