//! The demo world: a committed, synthetic Ironwood-shaped ledger with one demo holder.
//!
//! It exists so anyone can produce and check *real* Halo2 proofs without owning ZEC. Its
//! anchor is published with `network: "demo"` and every surface labels it as such: the notes
//! are real Ironwood V3 notes under a real key, but the tree is ours, not mainnet's.

use serde::{Deserialize, Serialize};
use voting_circuits::ff::{Field, PrimeField};
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::{
    keys::{FullViewingKey, Scope, SpendingKey},
    note::{commitment::ExtractedNoteCommitment, Note, NoteVersion, RandomSeed, Rho},
    value::NoteValue,
    Address,
};
use voting_crypto_deps::pasta_curves::pallas;

use crate::{OwnedNote, Snapshot};
use pof_zk::{DenseImtProvider, NoteTree};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredNote {
    pub address: String,
    pub value: u64,
    pub rho: String,
    pub rseed: String,
    pub position: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoWorld {
    pub network: String,
    pub height: u32,
    /// Demo only. This key controls synthetic notes in a synthetic tree and nothing else.
    pub spending_key: String,
    pub holder: Vec<StoredNote>,
    pub leaves: Vec<String>,
    pub spent: Vec<String>,
}

const ZEC: u64 = 100_000_000;

/// The demo holder's notes: 4,018.2 ZEC across five notes, the figure the landing page uses.
pub const DEMO_NOTES_ZAT: [u64; 5] = [1_500 * ZEC, 1_200 * ZEC, 800 * ZEC, 318 * ZEC + 20_000_000, 200 * ZEC];

impl DemoWorld {
    pub fn generate(height: u32, strangers: usize) -> Self {
        let mut rng = OsRng;
        let sk = SpendingKey::random(&mut rng);
        let fvk = FullViewingKey::from(&sk);
        let random_base = |rng: &mut OsRng| hex::encode(pallas::Base::random(rng).to_repr());
        let mut leaves: Vec<String> = (0..strangers).map(|_| random_base(&mut rng)).collect();
        let spent: Vec<String> = (0..strangers / 2).map(|_| random_base(&mut rng)).collect();
        let mut holder = Vec::new();
        for (i, value) in DEMO_NOTES_ZAT.iter().enumerate() {
            let (_, _, dummy) = Note::dummy(&mut rng, None, NoteVersion::V3);
            let note = Note::new(
                fvk.address_at(i as u32, Scope::External),
                NoteValue::from_raw(*value),
                Rho::from_nf_old(dummy.nullifier(&fvk)),
                NoteVersion::V3,
                &mut rng,
            );
            // spread the holder's notes through the tree
            let position = ((i + 1) * strangers / 6) as u32;
            leaves.insert(position as usize, hex::encode(ExtractedNoteCommitment::from(note.commitment()).to_bytes()));
            holder.push(StoredNote {
                address: hex::encode(note.recipient().to_raw_address_bytes()),
                value: *value,
                rho: hex::encode(note.rho().to_bytes()),
                rseed: hex::encode(note.rseed().as_bytes()),
                position,
            });
        }
        DemoWorld { network: "demo".into(), height, spending_key: hex::encode(sk.to_bytes()), holder, leaves, spent }
    }

    pub fn spending_key(&self) -> anyhow::Result<SpendingKey> {
        let b: [u8; 32] = hex::decode(&self.spending_key)?.try_into().map_err(|_| anyhow::anyhow!("key length"))?;
        Option::from(SpendingKey::from_bytes(b)).ok_or_else(|| anyhow::anyhow!("invalid demo key"))
    }

    pub fn notes(&self) -> anyhow::Result<Vec<OwnedNote>> {
        self.holder
            .iter()
            .map(|s| {
                let addr: [u8; 43] = hex::decode(&s.address)?.try_into().map_err(|_| anyhow::anyhow!("address length"))?;
                let rho: [u8; 32] = hex::decode(&s.rho)?.try_into().map_err(|_| anyhow::anyhow!("rho length"))?;
                let rseed: [u8; 32] = hex::decode(&s.rseed)?.try_into().map_err(|_| anyhow::anyhow!("rseed length"))?;
                let recipient = Option::<Address>::from(Address::from_raw_address_bytes(&addr)).ok_or_else(|| anyhow::anyhow!("bad address"))?;
                let rho = Option::<Rho>::from(Rho::from_bytes(&rho)).ok_or_else(|| anyhow::anyhow!("bad rho"))?;
                let rseed = Option::<RandomSeed>::from(RandomSeed::from_bytes(rseed, &rho)).ok_or_else(|| anyhow::anyhow!("bad rseed"))?;
                let note = Option::<Note>::from(Note::from_parts(recipient, NoteValue::from_raw(s.value), rho, rseed, NoteVersion::V3))
                    .ok_or_else(|| anyhow::anyhow!("note does not commit"))?;
                Ok(OwnedNote { note, position: s.position, scope: Scope::External })
            })
            .collect()
    }

    pub fn snapshot(&self) -> anyhow::Result<Snapshot> {
        let leaves = self
            .leaves
            .iter()
            .map(|h| hex::decode(h).ok().and_then(|v| v.try_into().ok()).ok_or_else(|| anyhow::anyhow!("bad leaf")))
            .collect::<anyhow::Result<Vec<[u8; 32]>>>()?;
        let spent = self
            .spent
            .iter()
            .map(|h| {
                let b: [u8; 32] = hex::decode(h).ok().and_then(|v| v.try_into().ok()).ok_or_else(|| anyhow::anyhow!("bad nullifier"))?;
                pof_zk::base_from_bytes(&b).map_err(|e| anyhow::anyhow!(e))
            })
            .collect::<anyhow::Result<Vec<pallas::Base>>>()?;
        Ok(Snapshot {
            network: self.network.clone(),
            height: self.height,
            tree: NoteTree::from_cmx(&leaves).ok_or_else(|| anyhow::anyhow!("non-canonical leaf"))?,
            imt: DenseImtProvider::from_nullifiers(&spent),
        })
    }
}
