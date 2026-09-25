//! pof-anchor — rebuild and publish Vouch anchors from public chain data.
//!
//!   pof-anchor scan   --server https://zec.rocks:443 --network mainnet [--to tip-100] --out target/snapshots/
//!   pof-anchor check  --snapshot target/snapshots/mainnet-3500000.vsnp --server …   (re-derive and compare)
//!
//! Defaults assume the working directory the READMEs use: backend/.
//!
//! `scan` streams every Ironwood compact action since activation, rebuilds the note-commitment
//! tree and checks its root, size and block hash against lightwalletd's own tree state, builds the
//! spent-nullifier IMT, writes the snapshot, and merges the anchor into the published table.

use std::{path::PathBuf, time::Instant};

use clap::{Parser, Subcommand};
use pof_anchor::{client::Lightwalletd, publish, Snapshot, IRONWOOD_ACTIVATION_MAINNET};

#[derive(Parser)]
#[command(name = "pof-anchor", version, about = "Rebuild Vouch anchors from public Zcash data.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Scan {
        #[arg(long, default_value = "https://zec.rocks:443")]
        server: String,
        #[arg(long, default_value = "mainnet")]
        network: String,
        /// Activation height of the Ironwood pool on this network.
        #[arg(long, default_value_t = IRONWOOD_ACTIVATION_MAINNET)]
        from: u32,
        /// Anchor height. Default: tip − 100, rounded down to a multiple of 1,000 (finalised).
        #[arg(long)]
        to: Option<u32>,
        #[arg(long, default_value = "target/snapshots")]
        out: PathBuf,
        /// Anchor table to merge into.
        #[arg(long, default_value = "../fixtures/anchors.mainnet.json")]
        table: PathBuf,
    },
    Check {
        #[arg(long)]
        snapshot: PathBuf,
        #[arg(long, default_value = "https://zec.rocks:443")]
        server: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Scan { server, network, from, to, out, table } => {
            let mut lwd = Lightwalletd::connect(&server).await?;
            let tip = lwd.tip().await?;
            let to = to.unwrap_or((tip.saturating_sub(100) / 1_000) * 1_000);
            anyhow::ensure!(to >= from, "anchor height {to} is before activation {from}");
            eprintln!("tip {tip} · scanning Ironwood actions {from}..={to} from {server}");
            let t = Instant::now();
            let snap = lwd
                .scan(&network, from, to, |h, n| eprintln!("  block {h} · {n} actions · {:.0}s", t.elapsed().as_secs_f32()))
                .await?;
            eprintln!("scanned {} actions in {:.1}s", snap.actions.len(), t.elapsed().as_secs_f32());
            finish(&mut lwd, snap, Some((&out, &table))).await
        }
        Cmd::Check { snapshot, server } => {
            let snap = Snapshot::read(&mut std::fs::File::open(&snapshot)?)?;
            let mut lwd = Lightwalletd::connect(&server).await?;
            finish(&mut lwd, snap, None).await
        }
    }
}

async fn finish(lwd: &mut Lightwalletd, snap: Snapshot, write: Option<(&PathBuf, &PathBuf)>) -> anyhow::Result<()> {
    let t = Instant::now();
    let (tree, imt, record) = snap.anchor()?;
    eprintln!("rebuilt both roots in {:.1}s ({} leaves, {} IMT leaves)", t.elapsed().as_secs_f32(), tree.size(), imt.leaf_count());
    let (root, size, hash) = lwd.ironwood_root(snap.height).await?;
    anyhow::ensure!(size as usize == tree.size(), "tree size {} disagrees with lightwalletd's {size}", tree.size());
    anyhow::ensure!(root == tree.root(), "note-commitment root disagrees with lightwalletd's tree state");
    // the record holds the compact block's hash reversed into display order, as the tree state does
    let ours = record.block_hash.as_deref().unwrap_or_default();
    anyhow::ensure!(ours.eq_ignore_ascii_case(&hash), "block hash {ours} disagrees with lightwalletd's {hash} at {}", snap.height);
    eprintln!("✓ nc_root and block hash match lightwalletd's Ironwood tree state at {} (block {hash})", snap.height);
    if let Some((out, table)) = write {
        std::fs::create_dir_all(out)?;
        let path = out.join(format!("{}-{}.vsnp", snap.network, snap.height));
        snap.write(&mut std::fs::File::create(&path)?)?;
        eprintln!("wrote {}", path.display());
        publish(table, record.clone())?;
        eprintln!("published to {}", table.display());
    }
    println!("{}", serde_json::to_string_pretty(&record)?);
    Ok(())
}
