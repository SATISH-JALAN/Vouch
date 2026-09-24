//! The holder's side: requests in, `proof.pof` out.
//!
//! Stages: open the holder's notes → pin an anchor (both roots) → select the fewest, largest
//! notes that clear the threshold → Merkle and IMT witnesses → prove and sign → envelope.
//! Nothing here broadcasts anything: there is no transaction type in this crate's graph that
//! could be sent, and `tests/no_broadcast.rs` keeps it that way.

pub mod history;
pub mod request;
pub mod wallet;
pub mod world;

use pof_core::{audience_hash, revocation_tag, Anchor, Claim, Envelope, Evidence, ZAT_PER_UNIT};
use pof_zk::{base_to_bytes, prove_holding, DenseImtProvider, HeldNote, ImtProvider, NoteTree};
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, Scope, SpendingKey},
    Note,
};

pub use request::ProofRequest;

/// A note the holder owns, and where it sits in the commitment tree.
#[derive(Clone, Debug)]
pub struct OwnedNote {
    pub note: Note,
    pub position: u32,
    pub scope: Scope,
}

/// Everything needed to prove against one anchor.
pub struct Snapshot {
    pub network: String,
    pub height: u32,
    pub tree: NoteTree,
    pub imt: DenseImtProvider,
}

impl Snapshot {
    pub fn anchor(&self) -> Anchor {
        Anchor { height: self.height, nc_root: self.tree.root(), nf_root: base_to_bytes(&self.imt.root()) }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SelectError {
    #[error("no combination of up to 5 unspent notes reaches {need} zatoshi (largest 5 total {best})")]
    Insufficient { need: u64, best: u64 },
}

/// Fewest, largest notes first. Fewer notes means a smaller statement about how the holder's
/// money is arranged; never include a note that is not needed.
pub fn select_notes(notes: &[OwnedNote], need_zat: u64, is_unspent: impl Fn(&OwnedNote) -> bool) -> Result<Vec<OwnedNote>, SelectError> {
    let mut pool: Vec<&OwnedNote> = notes.iter().filter(|n| is_unspent(n)).collect();
    pool.sort_by_key(|n| std::cmp::Reverse(n.note.value().inner()));
    // Proven in whole 0.125 ZEC units, so compare in units.
    let need_units = need_zat.div_ceil(ZAT_PER_UNIT);
    let units = |v: &[&OwnedNote]| v.iter().map(|n| n.note.value().inner()).sum::<u64>() / ZAT_PER_UNIT;
    // Smallest single note that clears it on its own reveals the least structure.
    if let Some(single) = pool.iter().rev().find(|n| n.note.value().inner() / ZAT_PER_UNIT >= need_units) {
        return Ok(vec![(*single).clone()]);
    }
    let mut chosen: Vec<&OwnedNote> = Vec::new();
    for n in &pool {
        if chosen.len() == 5 {
            break;
        }
        chosen.push(n);
        if units(&chosen) >= need_units {
            return Ok(chosen.into_iter().cloned().collect());
        }
    }
    Err(SelectError::Insufficient { need: need_zat, best: pool.iter().take(5).map(|n| n.note.value().inner()).sum() })
}

/// Build the envelope a request asks for, with empty evidence. Every field here is bound
/// into the proof.
pub fn envelope_for(req: &ProofRequest, anchor: Anchor, now: u64, binding: [u8; 32], revocation_secret: &[u8; 32]) -> Envelope {
    Envelope {
        claim: Claim::HoldsAtLeast { zatoshi: req.zatoshi },
        audience: audience_hash(&req.audience),
        binding,
        anchor,
        issued_at: now,
        expires_at: now + req.expiry_days as u64 * 86_400,
        revocation: revocation_tag(revocation_secret),
        evidence: Evidence { public_inputs: vec![], proof: vec![], signature: [0; 64] },
    }
}

/// Stages 3–7: select, witness, prove, sign. `env` must be otherwise final.
pub fn prove(sk: &SpendingKey, notes: &[OwnedNote], snap: &Snapshot, env: &mut Envelope) -> anyhow::Result<usize> {
    let fvk = FullViewingKey::from(sk);
    let need = env.claim.zatoshi();
    let picked = select_notes(notes, need, |n| snap.imt.non_membership_proof(n.note.nullifier(&fvk).inner()).is_ok())?;
    let count = picked.len();
    let held = picked
        .into_iter()
        .map(|n| {
            let merkle_path = snap.tree.path(n.position).ok_or_else(|| anyhow::anyhow!("note position {} is past the anchor", n.position))?;
            Ok(HeldNote { note: n.note, merkle_path, scope: n.scope })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    prove_holding(sk, held, &snap.imt, env)?;
    Ok(count)
}
