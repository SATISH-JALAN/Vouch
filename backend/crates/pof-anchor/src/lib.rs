//! Anchors from public data.
//!
//! A Vouch proof is checked against two roots at one finalised height: the Ironwood
//! note-commitment tree root (`nc_root`) and the root of the indexed Merkle tree of every
//! Ironwood nullifier revealed so far (`nf_root`). lightwalletd serves the first; nobody serves
//! the second. Both are recomputed here from compact blocks, so anyone can rebuild any anchor
//! Vouch publishes, and nobody has to take our word for one.
//!
//! A *snapshot* is every Ironwood compact action from activation to a height, in chain order:
//! the public data a verifier needs for the roots and a holder needs to find their own notes.
//!
//! ```text
//!  magic "VSNP" · u16 version · u8 network len · network · u32 height · 32 block hash ·
//!  u64 count · count × (nullifier 32 · cmx 32 · epk 32 · compact ciphertext 52) · blake2b-256
//! ```

use std::io::{Read, Write};

use pof_zk::{base_from_bytes, base_to_bytes, DenseImtProvider, ImtProvider, NoteTree};
use serde::{Deserialize, Serialize};
use voting_crypto_deps::pasta_curves::pallas;

#[cfg(feature = "client")]
pub mod client;

/// First block of the Ironwood pool on mainnet (NU6.3).
pub const IRONWOOD_ACTIVATION_MAINNET: u32 = 3_428_143;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Action {
    pub nullifier: [u8; 32],
    pub cmx: [u8; 32],
    pub epk: [u8; 32],
    pub ciphertext: [u8; 52],
}

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub network: String,
    pub height: u32,
    pub block_hash: [u8; 32],
    pub actions: Vec<Action>,
}

/// Mirrors `pof_verify::AnchorRecord` (JSON, camelCase).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorRecord {
    pub network: String,
    pub height: u32,
    #[serde(default)]
    pub block_hash: Option<String>,
    pub nc_root: String,
    pub nf_root: String,
}

const MAGIC: &[u8; 4] = b"VSNP";
const VERSION: u16 = 1;
const RECORD: usize = 32 + 32 + 32 + 52;

impl Snapshot {
    pub fn write(&self, w: &mut impl Write) -> anyhow::Result<()> {
        let mut buf = Vec::with_capacity(64 + self.actions.len() * RECORD);
        buf.extend_from_slice(MAGIC);
        buf.extend_from_slice(&VERSION.to_le_bytes());
        buf.push(self.network.len() as u8);
        buf.extend_from_slice(self.network.as_bytes());
        buf.extend_from_slice(&self.height.to_le_bytes());
        buf.extend_from_slice(&self.block_hash);
        buf.extend_from_slice(&(self.actions.len() as u64).to_le_bytes());
        for a in &self.actions {
            buf.extend_from_slice(&a.nullifier);
            buf.extend_from_slice(&a.cmx);
            buf.extend_from_slice(&a.epk);
            buf.extend_from_slice(&a.ciphertext);
        }
        let sum = blake2b_simd::Params::new().hash_length(32).hash(&buf);
        buf.extend_from_slice(sum.as_bytes());
        w.write_all(&buf)?;
        Ok(())
    }

    pub fn read(r: &mut impl Read) -> anyhow::Result<Self> {
        let mut b = Vec::new();
        r.read_to_end(&mut b)?;
        anyhow::ensure!(b.len() > 4 + 2 + 1 + 4 + 32 + 8 + 32, "snapshot too short");
        let (body, sum) = b.split_at(b.len() - 32);
        anyhow::ensure!(blake2b_simd::Params::new().hash_length(32).hash(body).as_bytes() == sum, "snapshot checksum mismatch");
        anyhow::ensure!(&body[..4] == MAGIC, "not a Vouch snapshot");
        anyhow::ensure!(u16::from_le_bytes([body[4], body[5]]) == VERSION, "unknown snapshot version");
        let nlen = body[6] as usize;
        let mut o = 7;
        let network = String::from_utf8(body[o..o + nlen].to_vec())?;
        o += nlen;
        let height = u32::from_le_bytes(body[o..o + 4].try_into()?);
        o += 4;
        let block_hash: [u8; 32] = body[o..o + 32].try_into()?;
        o += 32;
        let count = u64::from_le_bytes(body[o..o + 8].try_into()?) as usize;
        o += 8;
        anyhow::ensure!(body.len() == o + count * RECORD, "snapshot length does not match its count");
        let mut actions = Vec::with_capacity(count);
        for rec in body[o..].as_chunks::<RECORD>().0 {
            actions.push(Action {
                nullifier: rec[0..32].try_into()?,
                cmx: rec[32..64].try_into()?,
                epk: rec[64..96].try_into()?,
                ciphertext: rec[96..148].try_into()?,
            });
        }
        Ok(Snapshot { network, height, block_hash, actions })
    }

    pub fn tree(&self) -> anyhow::Result<NoteTree> {
        let leaves: Vec<[u8; 32]> = self.actions.iter().map(|a| a.cmx).collect();
        NoteTree::from_cmx(&leaves).ok_or_else(|| anyhow::anyhow!("a note commitment is not canonical"))
    }

    pub fn imt(&self) -> anyhow::Result<DenseImtProvider> {
        let nfs = self
            .actions
            .iter()
            .map(|a| base_from_bytes(&a.nullifier).map_err(|e| anyhow::anyhow!(e)))
            .collect::<anyhow::Result<Vec<pallas::Base>>>()?;
        Ok(DenseImtProvider::from_nullifiers(&nfs))
    }

    /// Both roots, and the record verifiers trust.
    pub fn anchor(&self) -> anyhow::Result<(NoteTree, DenseImtProvider, AnchorRecord)> {
        let tree = self.tree()?;
        let imt = self.imt()?;
        let mut hash = self.block_hash;
        hash.reverse(); // display order, as explorers show it
        let record = AnchorRecord {
            network: self.network.clone(),
            height: self.height,
            block_hash: Some(hex::encode(hash)),
            nc_root: hex::encode(tree.root()),
            nf_root: hex::encode(base_to_bytes(&imt.root())),
        };
        Ok((tree, imt, record))
    }
}

/// Merge `record` into an anchor table file, keeping it sorted and free of duplicates.
pub fn publish(path: &std::path::Path, record: AnchorRecord) -> anyhow::Result<Vec<AnchorRecord>> {
    let mut table: Vec<AnchorRecord> = match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b)?,
        Err(_) => vec![],
    };
    table.retain(|r| !(r.network == record.network && r.height == record.height));
    table.push(record);
    table.sort_by_key(|r| (r.network.clone(), r.height));
    std::fs::write(path, serde_json::to_vec_pretty(&table)?)?;
    Ok(table)
}
