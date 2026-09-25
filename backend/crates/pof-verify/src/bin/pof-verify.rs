//! `pof-verify check proof.pof --audience <id> --anchors anchors.json [--revocations list.json] [--json]`
//!
//! Exit codes: 0 valid · 1 invalid · 2 expired · 3 malformed · 4 could not run. Reads local
//! files only; fetch the anchor table and revocation list yourself (they are static JSON).

use std::{
    path::{Path, PathBuf},
    process::exit,
    time::SystemTime,
};

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use pof_verify::{verify, AnchorRecord, Context, Verdict, ZkVerifier};

/// Usage errors, unreadable files, bad JSON: kept apart from every verdict code.
const EXIT_OPERATIONAL: i32 = 4;

#[derive(Parser)]
#[command(
    name = "pof-verify",
    version,
    about = "Check a Vouch proof against the public chain.",
    after_help = "Exit codes: 0 valid · 1 invalid · 2 expired · 3 malformed · 4 could not run (usage, unreadable file, bad JSON)."
)]
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

fn main() {
    // clap exits 2 on a usage error, which would read as "expired".
    let cli = Cli::try_parse().unwrap_or_else(|e| {
        let _ = e.print();
        exit(if e.use_stderr() { EXIT_OPERATIONAL } else { 0 })
    });
    match run(cli.cmd) {
        Ok(code) => exit(code),
        Err(e) => {
            eprintln!("pof-verify: {e:#}");
            exit(EXIT_OPERATIONAL)
        }
    }
}

fn read(p: &Path) -> anyhow::Result<Vec<u8>> {
    std::fs::read(p).with_context(|| format!("reading {}", p.display()))
}

fn run(cmd: Cmd) -> anyhow::Result<i32> {
    let Cmd::Check { file, audience, anchors, revocations, now, json } = cmd;
    let input = read(&file)?;
    let anchors: Vec<AnchorRecord> = serde_json::from_slice(&read(&anchors)?).with_context(|| format!("parsing {}", anchors.display()))?;
    let revoked = match revocations {
        Some(p) => match serde_json::from_slice::<RevocationFile>(&read(&p)?).with_context(|| format!("parsing {}", p.display()))? {
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
                let network = r.anchor.as_ref().map_or("?", |a| a.network.as_str());
                format!("Valid · {} ZEC at least · anchor {anchor_height} ({network})", zec(claim.zatoshi()))
            }
            Verdict::Expired { at } => format!("Expired · at unix {at}"),
            Verdict::Revoked => "Invalid · revoked by the holder".into(),
            Verdict::WrongAudience => "Invalid · made for a different verifier".into(),
            Verdict::AnchorNotFound => "Invalid · anchor not found".into(),
            Verdict::ProofInvalid { detail } => format!("Invalid · {detail}"),
            Verdict::Malformed { reason } => format!("Malformed · {reason}"),
        };
        println!("{line}");
        if matches!(r.verdict, Verdict::Valid { .. }) && r.anchor.as_ref().is_some_and(|a| a.network == "demo") {
            println!("WARNING: demo ledger. This anchor is the synthetic demonstration tree, not Zcash mainnet: it says nothing about real funds.");
        }
        for c in &r.checks {
            println!("  {:<10} {:<8} {}", c.id, format!("{:?}", c.status).to_lowercase(), c.detail);
        }
    }
    Ok(r.verdict.exit_code())
}

fn zec(z: u64) -> String {
    format!("{}.{:08}", z / 100_000_000, z % 100_000_000)
}
