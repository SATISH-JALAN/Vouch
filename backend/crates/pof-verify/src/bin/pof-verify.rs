//! `pof-verify check proof.pof --audience <id> --anchors anchors.json [--revocations list.json] [--json]`
//!
//! Exit codes: 0 valid · 1 invalid · 2 expired · 3 malformed. Reads local files only; fetch
//! the anchor table and revocation list yourself (they are static JSON).

use std::{path::PathBuf, time::SystemTime};

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use pof_verify::{verify, AnchorRecord, Context, Verdict, ZkVerifier};

#[derive(Parser)]
#[command(name = "pof-verify", version, about = "Check a Vouch proof against the public chain.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Verify one proof file (binary .pof or base64url text).
    Check {
        file: PathBuf,
        /// Your verifier identifier. Only its hash is compared with the proof.
        #[arg(long)]
        audience: String,
        /// Anchor table (JSON array of {network,height,ncRoot,nfRoot}).
        #[arg(long)]
        anchors: PathBuf,
        /// Revocation list (JSON: {"secrets": [hex…]} or a bare array).
        #[arg(long)]
        revocations: Option<PathBuf>,
        /// Evaluate as of this unix time instead of now.
        #[arg(long)]
        now: Option<u64>,
        /// Print the full JSON result.
        #[arg(long)]
        json: bool,
    },
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum RevocationFile {
    Wrapped { secrets: Vec<String> },
    Bare(Vec<String>),
}

fn main() -> anyhow::Result<()> {
    let Cmd::Check { file, audience, anchors, revocations, now, json } = Cli::parse().cmd;
    let input = std::fs::read(&file).with_context(|| format!("reading {}", file.display()))?;
    let anchors: Vec<AnchorRecord> =
        serde_json::from_slice(&std::fs::read(&anchors).with_context(|| format!("reading {}", anchors.display()))?)?;
    let revoked = match revocations {
        Some(p) => match serde_json::from_slice::<RevocationFile>(&std::fs::read(&p)?)? {
            RevocationFile::Wrapped { secrets } | RevocationFile::Bare(secrets) => secrets,
        },
        None => vec![],
    };
    let now = now.unwrap_or_else(|| SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs());
    let zk = ZkVerifier::new().map_err(|e| anyhow::anyhow!(e))?;
    let r = verify(&input, &Context { audience: &audience, anchors: &anchors, revoked_secrets: &revoked, now, zk: &zk });

    if json {
        println!("{}", serde_json::to_string_pretty(&r)?);
    } else {
        let line = match &r.verdict {
            Verdict::Valid { claim, anchor_height } => {
                format!("Valid · {} ZEC at least · anchor {}", zec(claim.zatoshi()), anchor_height)
            }
            Verdict::Expired { at } => format!("Expired · at unix {at}"),
            Verdict::Revoked => "Invalid · revoked by the holder".into(),
            Verdict::WrongAudience => "Invalid · made for a different verifier".into(),
            Verdict::AnchorNotFound => "Invalid · anchor not found".into(),
            Verdict::ProofInvalid { detail } => format!("Invalid · {detail}"),
            Verdict::Malformed { reason } => format!("Malformed · {reason}"),
        };
        println!("{line}");
        for c in &r.checks {
            println!("  {:<10} {:<8} {}", c.id, format!("{:?}", c.status).to_lowercase(), c.detail);
        }
    }
    std::process::exit(r.verdict.exit_code());
}

fn zec(z: u64) -> String {
    format!("{}.{:08}", z / 100_000_000, z % 100_000_000)
}
