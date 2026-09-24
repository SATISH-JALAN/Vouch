//! The prover's local record of what it has proven, to whom, and how to revoke it.
//! Lives on the holder's machine only. The revocation secret never leaves it until the holder
//! chooses to revoke.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// First 8 bytes of the revocation tag, hex. Short enough to type.
    pub id: String,
    pub claim: String,
    pub audience: String,
    pub network: String,
    pub anchor_height: u32,
    pub issued_at: u64,
    pub expires_at: u64,
    pub revocation_tag: String,
    /// Publishing this revokes the proof.
    pub revocation_secret: String,
    #[serde(default)]
    pub revoked_at: Option<u64>,
    pub file: String,
}

#[derive(Default, Serialize, Deserialize)]
pub struct History {
    pub entries: Vec<Entry>,
}

impl History {
    pub fn load(path: &std::path::Path) -> anyhow::Result<Self> {
        match std::fs::read(path) {
            Ok(b) => Ok(serde_json::from_slice(&b)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(History::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, path: &std::path::Path) -> anyhow::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }

    pub fn find(&mut self, id: &str) -> Option<&mut Entry> {
        let id = id.trim().to_lowercase();
        self.entries.iter_mut().find(|e| e.id.starts_with(&id) || e.revocation_tag.starts_with(&id))
    }
}
