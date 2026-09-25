//! pof-prove — the holder's CLI. Keys stay in this process; nothing is broadcast.
//!
//!   pof-prove prove          --request <encoded> --snapshot target/snapshots/mainnet-3500000.vsnp --seed-file ~/.vouch/seed.txt --out proof.pof
//!   pof-prove demo init      --out fixtures/
//!   pof-prove demo prove     --world fixtures/demo-world.json --request <encoded> --out proof.pof
//!   pof-prove demo fixtures  --world fixtures/demo-world.json --out fixtures/
//!   pof-prove history
//!   pof-prove revoke <id>    --endpoint https://…/api/revocations

use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use anyhow::{bail, Context};
use clap::{Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use pof_core::{audience_hash, encode, to_base64url, Claim, Envelope};
use pof_prove::{envelope_for, history::Entry, history::History, prove, request::zec, select_notes, wallet, world::DemoWorld, ProofRequest};
use voting_circuits::ff::{Field, PrimeField};
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::keys::FullViewingKey;
use voting_crypto_deps::pasta_curves::pallas;

#[derive(Parser)]
#[command(name = "pof-prove", version, about = "Prove one fact about your shielded ZEC. Keys never leave this machine.")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// The demo ledger: synthetic notes in a published demo tree, real proofs.
    #[command(subcommand)]
    Demo(Demo),
    /// Answer a proof request with your own wallet, against a published chain snapshot.
    Prove {
        /// The encoded request from a /prove link (the `r=` value, or the whole link).
        #[arg(long)]
        request: String,
        /// A snapshot written by `pof-anchor scan` (public data; its anchor must be published).
        #[arg(long)]
        snapshot: PathBuf,
        /// A BIP 39 mnemonic or a hex seed. Read locally; never leaves this process.
        #[arg(long)]
        seed_file: PathBuf,
        #[arg(long, default_value_t = 0)]
        account: u32,
        #[arg(long, default_value = "mainnet")]
        network: String,
        #[arg(long)]
        bind_solana: Option<String>,
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        yes: bool,
    },
    /// Proofs you have made: claim, audience, expiry, status.
    History {
        /// Also print revocation secrets (to revoke from another machine or the web page).
        #[arg(long)]
        secrets: bool,
    },
    /// Revoke a proof by publishing its revocation secret.
    Revoke {
        /// The proof id from `history`: at least its first 8 hex characters.
        id: String,
        /// The revocation list your verifiers check, e.g. https://<site>/api/revocations.
        #[arg(long, value_name = "URL")]
        endpoint: String,
    },
}

#[derive(Subcommand)]
enum Demo {
    /// Generate a new demo world and its anchor record.
    Init {
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value_t = 3_491_040)]
        height: u32,
        #[arg(long, default_value_t = 2_048)]
        strangers: usize,
    },
    /// Answer a proof request as the demo holder.
    Prove {
        #[arg(long)]
        world: PathBuf,
        /// The encoded request from a /request link (the `r=` value, or the whole link).
        #[arg(long)]
        request: String,
        /// Bind the proof to this Solana account (base58). Required by on-chain audiences.
        #[arg(long)]
        bind_solana: Option<String>,
        #[arg(long)]
        out: PathBuf,
        /// Skip the confirmation prompt.
        #[arg(long)]
        yes: bool,
    },
    /// Regenerate every committed test vector from real proofs.
    Fixtures {
        #[arg(long)]
        world: PathBuf,
        #[arg(long)]
        out: PathBuf,
        /// The demo borrower's Solana pubkey for the on-chain vector.
        #[arg(long)]
        borrower: Option<String>,
    },
}

fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs()
}

fn history_path() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".vouch").join("history.json")
}

fn secret() -> [u8; 32] {
    pallas::Base::random(&mut OsRng).to_repr()
}

fn stage(msg: &str) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(ProgressStyle::with_template("  {spinner} {msg} {elapsed:.dim}").unwrap());
    pb.enable_steady_tick(Duration::from_millis(80));
    pb.set_message(msg.to_string());
    pb
}

fn done(pb: ProgressBar, msg: String) {
    pb.finish_with_message(format!("✓ {msg}"));
}

fn plural(n: usize, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

/// The `r` parameter of a request link, or the input itself when it is the bare encoded request.
fn request_param(s: &str) -> &str {
    let s = s.trim();
    let query = s.split_once('?').map_or(s, |(_, q)| q);
    let query = query.split('#').next().unwrap_or(query);
    query.split('&').find_map(|kv| kv.strip_prefix("r=")).unwrap_or(s)
}

fn parse_request(s: &str) -> anyhow::Result<ProofRequest> {
    Ok(ProofRequest::decode(request_param(s))?)
}

fn solana_key(b58: &str) -> anyhow::Result<[u8; 32]> {
    let v = bs58::decode(b58.trim()).into_vec().context("binding is not base58")?;
    v.try_into().map_err(|_| anyhow::anyhow!("a Solana pubkey is 32 bytes"))
}

/// Returns the file as written.
fn write_proof(path: &Path, env: &Envelope) -> anyhow::Result<Vec<u8>> {
    let file = encode(env);
    std::fs::write(path, &file)?;
    Ok(file)
}

/// The review screen, as on the web, then confirmation. Returns the binding.
fn review(req: &ProofRequest, bind_solana: Option<&str>, yes: bool) -> anyhow::Result<[u8; 32]> {
    println!("\n  {}\n", req.sentence());
    println!("  They will learn: the claim, the block it is as of, that it was made for them, the expiry.");
    println!("  They will never learn: your balance, which notes, how many, any address, any payment.\n");
    let t = now();
    if let Some(by) = req.respond_by.filter(|&by| by < t) {
        println!("  They asked for an answer by unix time {by}; that has passed ({} ago). You can still answer.\n", plural(((t - by) / 86_400) as usize, "day"));
    }
    if req.bind.as_deref() == Some("solana") && bind_solana.is_none() {
        bail!("this request must be bound to your Solana account: pass --bind-solana <pubkey>");
    }
    let binding = bind_solana.map(solana_key).transpose()?.unwrap_or([0; 32]);
    if !yes {
        eprint!("  Generate this proof? [y/N] ");
        let mut line = String::new();
        std::io::stdin().read_line(&mut line)?;
        if !line.trim().eq_ignore_ascii_case("y") {
            bail!("cancelled; nothing was generated");
        }
    }
    Ok(binding)
}

/// Write the proof and record it. `history` is loaded before proving, so a broken history file
/// fails before the work; if saving still fails, the secret goes to stderr, because a proof
/// whose secret is lost can never be revoked.
fn record(mut history: History, out: &Path, env: &Envelope, rs: &[u8; 32], req: &ProofRequest, network: &str, note: Option<String>) -> anyhow::Result<()> {
    let file = write_proof(out, env)?;
    let tag = hex::encode(env.revocation);
    history.entries.push(Entry {
        id: tag[..16].to_string(),
        claim: format!("Holds at least {} ZEC", zec(req.zatoshi)),
        audience: req.audience.clone(),
        network: network.to_string(),
        anchor_height: env.anchor.height,
        issued_at: env.issued_at,
        expires_at: env.expires_at,
        revocation_tag: tag.clone(),
        revocation_secret: hex::encode(rs),
        revoked_at: None,
        file: out.display().to_string(),
    });
    let path = history_path();
    if let Err(e) = history.save(&path) {
        eprintln!("\n  wrote {}, but could not record it in {}.", out.display(), path.display());
        eprintln!("  Keep this revocation secret; it is the only way to revoke the proof:\n  {}\n", hex::encode(rs));
        return Err(e);
    }
    println!("\n  wrote {} ({} bytes). Nothing was broadcast.", out.display(), file.len());
    if let Some(note) = note {
        println!("  {note}");
    }
    println!("  proof id {} · revoke with: pof-prove revoke {} --endpoint https://<site>/api/revocations", &tag[..16], &tag[..16]);
    println!("\n  base64url (paste into /verify):\n{}", to_base64url(&file));
    Ok(())
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Demo(Demo::Init { out, height, strangers }) => {
            std::fs::create_dir_all(&out)?;
            let pb = stage("generating the demo ledger");
            let world = DemoWorld::generate(height, strangers);
            let snap = world.snapshot()?;
            let anchor = snap.anchor();
            std::fs::write(out.join("demo-world.json"), serde_json::to_vec(&world)?)?;
            done(pb, format!("{} leaves, {} spent nullifiers", snap.tree.size(), world.spent.len()));
            let record = serde_json::json!([{
                "network": "demo", "height": height, "blockHash": null,
                "ncRoot": hex::encode(anchor.nc_root), "nfRoot": hex::encode(anchor.nf_root),
            }]);
            std::fs::write(out.join("anchors.demo.json"), serde_json::to_vec_pretty(&record)?)?;
            println!("wrote {}/demo-world.json and anchors.demo.json", out.display());
        }

        Cmd::Demo(Demo::Prove { world, request, bind_solana, out, yes }) => {
            let req = parse_request(&request)?;
            let binding = review(&req, bind_solana.as_deref(), yes)?;
            let history = History::load(&history_path())?;
            let world: DemoWorld = serde_json::from_slice(&std::fs::read(&world)?)?;
            let pb = stage("pinning the anchor and rebuilding both roots");
            let snap = world.snapshot()?;
            done(pb, format!("demo anchor at block {}", snap.height));
            let rs = secret();
            let mut env = envelope_for(&req, snap.anchor(), now(), binding, &rs);
            let pb = stage("selecting notes, building witnesses, proving, signing");
            let n = prove(&world.spending_key()?, &world.notes()?, &snap, &mut env)?;
            done(pb, format!("{} used; balance not revealed", plural(n, "note")));
            record(history, &out, &env, &rs, &req, &snap.network, None)?;
        }

        Cmd::Demo(Demo::Fixtures { world, out, borrower }) => fixtures(&world, &out, borrower.as_deref())?,

        Cmd::Prove { request, snapshot, seed_file, account, network, bind_solana, out, yes } => {
            let req = parse_request(&request)?;
            let binding = review(&req, bind_solana.as_deref(), yes)?;
            let history = History::load(&history_path())?;
            let pb = stage("reading your seed and deriving the Ironwood key (it stays in this process)");
            let sk = wallet::spending_key(&wallet::seed_from_file(&seed_file)?, &network, account)?;
            done(pb, format!("account {account} on {network}"));
            let pb = stage("loading the snapshot");
            let chain = pof_anchor::Snapshot::read(&mut std::fs::File::open(&snapshot)?)?;
            anyhow::ensure!(chain.network == network, "the snapshot is for {}, not {network}", chain.network);
            done(pb, format!("{} Ironwood actions to block {}", chain.actions.len(), chain.height));
            let pb = stage("finding your notes (trial decryption with your viewing key, all cores)");
            let fvk = FullViewingKey::from(&sk);
            let found = wallet::find_notes(&chain, &fvk);
            let total = found.len();
            let notes = wallet::unspent(&chain, &fvk, found);
            done(pb, format!("{} found, {} unspent", plural(total, "note"), notes.len()));
            anyhow::ensure!(total > 0, "no Ironwood notes for this key in the snapshot: check the account index, and that your funds are in the Ironwood pool");
            // Fail before the tree work when the unspent notes cannot clear the threshold.
            select_notes(&notes, req.zatoshi, |_| true)?;
            let pb = stage("rebuilding both roots: the note-commitment tree and the spent-nullifier tree");
            let snap = wallet::snapshot(&chain)?;
            done(pb, format!("anchor at block {}", snap.height));
            let rs = secret();
            let mut env = envelope_for(&req, snap.anchor(), now(), binding, &rs);
            let pb = stage("selecting notes, building witnesses, proving, signing");
            let n = prove(&sk, &notes, &snap, &mut env)?;
            done(pb, format!("{} used; balance not revealed", plural(n, "note")));
            let note = format!("anchor: {network} block {}. Verifiers accept it once this anchor is in their table.", snap.height);
            record(history, &out, &env, &rs, &req, &network, Some(note))?;
        }

        Cmd::History { secrets } => {
            let h = History::load(&history_path())?;
            if h.entries.is_empty() {
                println!("No proofs yet.");
            }
            let t = now();
            for e in &h.entries {
                // as the verifier judges it: expired from the expiry second on
                let status = if e.revoked_at.is_some() {
                    "revoked"
                } else if t >= e.expires_at {
                    "expired"
                } else {
                    "live"
                };
                println!("{}  {:<8} {}  for {}  ({} · block {})", e.id, status, e.claim, e.audience, e.network, e.anchor_height);
                if secrets {
                    println!("    revocation secret {}", e.revocation_secret);
                }
            }
        }

        Cmd::Revoke { id, endpoint } => {
            let path = history_path();
            let mut h = History::load(&path)?;
            let e = h.find(&id).with_context(|| format!("looking in {}", path.display()))?;
            let body = serde_json::json!({ "secret": e.revocation_secret });
            // ureq 3 turns every non-2xx status into an error and follows redirects itself.
            match ureq::post(&endpoint).send_json(&body) {
                Ok(_) => {}
                Err(ureq::Error::StatusCode(code)) => bail!("the revocation list refused it: HTTP {code}"),
                Err(err) => return Err(err).context("posting the revocation"),
            }
            e.revoked_at = Some(now());
            let tag = e.revocation_tag.clone();
            h.save(&path)?;
            println!("Revoked. Tag {tag} is now on the list; verifiers that fetch it will refuse the proof.");
        }
    }
    Ok(())
}

/// Every committed test vector, from real proofs. `expected.json` records the verdict each
/// one must produce, so the native and WASM verifiers can be checked against it.
fn fixtures(world_path: &Path, out: &Path, borrower: Option<&str>) -> anyhow::Result<()> {
    let world: DemoWorld = serde_json::from_slice(&std::fs::read(world_path)?)?;
    let snap = world.snapshot()?;
    let sk = world.spending_key()?;
    let notes = world.notes()?;
    let dir = out.join("proofs");
    std::fs::create_dir_all(&dir)?;
    let audience = "pof-credit:usdc-pool-1";
    let req = |zec_units: u64, days: u32| ProofRequest {
        v: 1,
        id: None,
        claim: "HoldsAtLeast".into(),
        zatoshi: zec_units * 100_000_000,
        audience: audience.into(),
        expiry_days: days,
        respond_by: None,
        bind: None,
    };
    // Long-lived on purpose: the committed "valid" vector must stay valid through judging.
    let issued = 1_790_121_600; // 2026-09-23 00:00 UTC
    let until_2027 = 1_798_761_600; // 2027-01-01 00:00 UTC
    let mut expected = serde_json::Map::new();
    let mut revoked = Vec::new();
    let mut make = |name: &str, r: ProofRequest, issued_at: u64, expires_at: u64, binding: [u8; 32], rs: [u8; 32], want: &str| -> anyhow::Result<Envelope> {
        let pb = stage(&format!("proving {name}"));
        let mut env = envelope_for(&r, snap.anchor(), issued_at, binding, &rs);
        env.expires_at = expires_at;
        prove(&sk, &notes, &snap, &mut env)?;
        write_proof(&dir.join(format!("{name}.pof")), &env)?;
        expected.insert(name.into(), serde_json::json!({ "verdict": want, "audience": audience }));
        done(pb, format!("{name}.pof → {want}"));
        Ok(env)
    };

    let valid = make("valid", req(500, 7), issued, until_2027, [0; 32], secret(), "Valid")?;
    make("expired", req(500, 7), 1_789_516_800, 1_790_035_200, [0; 32], secret(), "Expired")?; // 16 → 22 Sep 2026
    let rs = secret();
    make("revoked", req(500, 7), issued, until_2027, [0; 32], rs, "Revoked")?;
    revoked.push(hex::encode(rs));
    let mut other = req(500, 7);
    other.audience = "otc-desk:someone-else".into();
    make("wrong-audience", other, issued, until_2027, [0; 32], secret(), "WrongAudience")?;
    make("threshold-4000", req(4_000, 7), issued, until_2027, [0; 32], secret(), "Valid")?;
    if let Some(b) = borrower {
        make("onchain", req(500, 7), issued, until_2027, solana_key(b)?, secret(), "Valid")?;
    }

    // Tampered: one byte of Halo2 evidence flipped, then re-sealed like a forger would.
    let mut t = valid.clone();
    t.evidence.proof[777] ^= 1;
    write_proof(&dir.join("tampered.pof"), &t)?;
    expected.insert("tampered".into(), serde_json::json!({ "verdict": "ProofInvalid", "audience": audience }));
    // Forged claim: 500 → 5,000 ZEC, re-sealed.
    let mut f = valid.clone();
    f.claim = Claim::HoldsAtLeast { zatoshi: 5_000 * 100_000_000 };
    write_proof(&dir.join("forged-claim.pof"), &f)?;
    expected.insert("forged-claim".into(), serde_json::json!({ "verdict": "ProofInvalid", "audience": audience }));
    // Extended expiry on the expired proof, re-sealed.
    let mut x = valid.clone();
    x.expires_at += 365 * 86_400;
    write_proof(&dir.join("extended-expiry.pof"), &x)?;
    expected.insert("extended-expiry".into(), serde_json::json!({ "verdict": "ProofInvalid", "audience": audience }));
    // Anchor that no authenticated record has.
    let mut a = valid.clone();
    a.anchor.nc_root = pof_zk::base_to_bytes(&pallas::Base::from(7u64));
    write_proof(&dir.join("anchor-mismatch.pof"), &a)?;
    expected.insert("anchor-mismatch".into(), serde_json::json!({ "verdict": "AnchorNotFound", "audience": audience }));
    // Swapped audience field (someone re-addressing a proof they were handed).
    let mut s = valid.clone();
    s.audience = audience_hash("otc-desk:someone-else");
    write_proof(&dir.join("readdressed.pof"), &s)?;
    expected.insert("readdressed".into(), serde_json::json!({ "verdict": "ProofInvalid", "audience": "otc-desk:someone-else" }));

    std::fs::write(out.join("revocations.demo.json"), serde_json::to_vec_pretty(&serde_json::json!({ "secrets": revoked }))?)?;
    let meta = serde_json::json!({ "audience": audience, "evaluatedAt": issued + 86_400, "expected": expected });
    std::fs::write(out.join("expected.json"), serde_json::to_vec_pretty(&meta)?)?;
    println!("wrote {} vectors to {}", meta["expected"].as_object().map_or(0, |m| m.len()), dir.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::request_param;

    #[test]
    fn request_param_reads_the_r_parameter() {
        assert_eq!(request_param("eyJ2"), "eyJ2");
        assert_eq!(request_param("  r=eyJ2 "), "eyJ2");
        assert_eq!(request_param("https://vouch.example/prove?r=eyJ2"), "eyJ2");
        assert_eq!(request_param("https://vouch.example/prove?r=eyJ2&referrer=x"), "eyJ2");
        assert_eq!(request_param("https://vouch.example/prove?referrer=x&r=eyJ2#top"), "eyJ2");
        // no r parameter: the whole input, which then fails to decode
        assert_eq!(request_param("https://vouch.example/prove?ref=x"), "https://vouch.example/prove?ref=x");
    }
}
