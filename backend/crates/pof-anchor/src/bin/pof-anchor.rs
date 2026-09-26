//! pof-anchor — rebuild and publish Vouch anchors from public chain data.
//!
//!   pof-anchor scan   [--network mainnet|testnet] [--to tip-100]      (server, activation height and
//!                     table default per network; override with --server / --from / --table)
//!   pof-anchor check  --snapshot target/snapshots/testnet-4390000.vsnp [--server …]   (re-derive and compare)
//!
//! Defaults assume the working directory the READMEs use: backend/. The server must report the same
//! chain as --network, so a testnet anchor can never be published as mainnet.
//!
//! `scan` streams every Ironwood compact action since activation, rebuilds the note-commitment
//! tree and checks its root, size and block hash against lightwalletd's own tree state, builds the
//! spent-nullifier IMT, writes the snapshot, and merges the anchor into the published table.

use std::{path::PathBuf, time::Instant};

use clap::{Parser, Subcommand};
use pof_anchor::{client::Lightwalletd, publish, Network, Snapshot};

#[derive(Parser)]
#[command(name = "pof-anchor", version, about = "Rebuild Vouch anchors from public Zcash data.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Scan {
        /// lightwalletd. Default: https://zec.rocks:443 (mainnet), https://testnet.zec.rocks:443 (testnet).
        #[arg(long)]
        server: Option<String>,
        #[arg(long, default_value = "mainnet", value_parser = ["mainnet", "testnet"])]
        network: String,
        /// First block to scan. Default: Ironwood activation on this network (3,428,143 / 4,134,000).
        #[arg(long)]
        from: Option<u32>,
        /// Anchor height. Default: tip − 100, rounded down to a multiple of 1,000 (finalised).
        #[arg(long)]
        to: Option<u32>,
        #[arg(long, default_value = "target/snapshots")]
        out: PathBuf,
        /// Anchor table to merge into. Default: ../fixtures/anchors.<network>.json.
        #[arg(long)]
        table: Option<PathBuf>,
    },
    Check {
        #[arg(long)]
        snapshot: PathBuf,
        /// lightwalletd. Default: the public server for the snapshot's network.
        #[arg(long)]
        server: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Scan { server, network, from, to, out, table } => {
            let net = Network::parse(&network).expect("clap restricts --network");
            let server = server.unwrap_or_else(|| net.default_server().into());
            let from = from.unwrap_or(net.ironwood_activation());
            let table = table.unwrap_or_else(|| PathBuf::from(format!("../fixtures/anchors.{network}.json")));
            let mut lwd = Lightwalletd::connect(&server).await?;
            lwd.ensure_chain(net).await?;
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
            let net = Network::parse(&snap.network).ok_or_else(|| anyhow::anyhow!("snapshot is for unknown network {:?}", snap.network))?;
            let server = server.unwrap_or_else(|| net.default_server().into());
            let mut lwd = Lightwalletd::connect(&server).await?;
            lwd.ensure_chain(net).await?;
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
