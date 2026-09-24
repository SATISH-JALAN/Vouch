//! The holder's own wallet: seed → Ironwood spending key → the holder's notes in a snapshot.
//!
//! Notes are found by trial-decrypting every Ironwood compact action in the snapshot with the
//! holder's incoming viewing keys (external and internal scope), exactly as a light wallet
//! does. The viewing key never leaves this process; the snapshot is public data.

use pof_anchor::Snapshot as ChainSnapshot;
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, PreparedIncomingViewingKey, Scope, SpendingKey},
    note::{ExtractedNoteCommitment, Nullifier},
    note_encryption::{CompactAction, IronwoodDomain},
};
use zcash_note_encryption::{try_compact_note_decryption, EphemeralKeyBytes};

use crate::{OwnedNote, Snapshot};

/// ZIP 32 coin types.
pub fn coin_type(network: &str) -> anyhow::Result<u32> {
    match network {
        "mainnet" => Ok(133),
        "testnet" | "regtest" => Ok(1),
        n => anyhow::bail!("unknown network {n}"),
    }
}

/// A seed file holds a BIP 39 mnemonic (any word count) or a hex seed (32–64 bytes).
pub fn seed_from_file(path: &std::path::Path) -> anyhow::Result<Vec<u8>> {
    let text = std::fs::read_to_string(path)?;
    let t = text.trim();
    if t.split_whitespace().count() >= 12 {
        let m = bip39::Mnemonic::parse_normalized(t).map_err(|e| anyhow::anyhow!("mnemonic: {e}"))?;
        return Ok(m.to_seed("").to_vec());
    }
    let seed = hex::decode(t).map_err(|_| anyhow::anyhow!("the seed file is neither a mnemonic nor hex"))?;
    anyhow::ensure!((32..=64).contains(&seed.len()), "a hex seed must be 32–64 bytes");
    Ok(seed)
}

pub fn spending_key(seed: &[u8], network: &str, account: u32) -> anyhow::Result<SpendingKey> {
    let account = zip32::AccountId::try_from(account).map_err(|_| anyhow::anyhow!("account index out of range"))?;
    SpendingKey::from_zip32_seed(seed, coin_type(network)?, account).map_err(|e| anyhow::anyhow!("key derivation: {e:?}"))
}

/// Every note in `snap` addressed to `fvk`, with its tree position. Trial decryption runs
/// across all cores; the result is in chain order.
pub fn find_notes(snap: &ChainSnapshot, fvk: &FullViewingKey) -> Vec<OwnedNote> {
    use rayon::prelude::*;
    let ivks = [Scope::External, Scope::Internal].map(|s| (s, PreparedIncomingViewingKey::new(&fvk.to_ivk(s))));
    snap.actions
        .par_iter()
        .enumerate()
        .filter_map(|(position, a)| {
            let nf = Option::<Nullifier>::from(Nullifier::from_bytes(&a.nullifier))?;
            let cmx = Option::<ExtractedNoteCommitment>::from(ExtractedNoteCommitment::from_bytes(&a.cmx))?;
            let action = CompactAction::from_parts(nf, cmx, EphemeralKeyBytes(a.epk), a.ciphertext);
            let domain = IronwoodDomain::for_compact_action(&action);
            ivks.iter().find_map(|(scope, ivk)| {
                try_compact_note_decryption(&domain, ivk, &action).map(|(note, _)| OwnedNote { note, position: position as u32, scope: *scope })
            })
        })
        .collect()
}

/// The prover's view of a chain snapshot: both trees at its height.
pub fn snapshot(snap: &ChainSnapshot) -> anyhow::Result<Snapshot> {
    Ok(Snapshot { network: snap.network.clone(), height: snap.height, tree: snap.tree()?, imt: snap.imt()? })
}
