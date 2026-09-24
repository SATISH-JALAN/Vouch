//! pof-prove — the holder's CLI. Keys stay in this process; nothing is broadcast.
//!
//!   pof-prove prove          --request <encoded> --snapshot mainnet-3500000.vsnp --seed-file ~/.vouch/seed.txt --out proof.pof
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
use pof_core::{audience_hash, encode, revocation_tag, to_base64url, Claim, Envelope};
use pof_prove::{envelope_for, history::Entry, history::History, prove, request::zec, world::DemoWorld, ProofRequest, Snapshot};
use voting_circuits::ff::{Field, PrimeField};
use voting_circuits::rand::rngs::OsRng;
use voting_crypto_deps::orchard::keys::SpendingKey;
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
        id: String,
        #[arg(long, default_value = "http://localhost:3000/api/revocations")]
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

fn parse_request(s: &str) -> anyhow::Result<ProofRequest> {
    let enc = s.split("r=").last().unwrap_or(s).split('&').next().unwrap_or(s).trim();
    Ok(ProofRequest::decode(enc)?)
}

fn solana_key(b58: &str) -> anyhow::Result<[u8; 32]> {
    let v = bs58::decode(b58.trim()).into_vec().context("binding is not base58")?;
    v.try_into().map_err(|_| anyhow::anyhow!("a Solana pubkey is 32 bytes"))
}

fn write_proof(path: &Path, env: &Envelope) -> anyhow::Result<String> {
    let file = encode(env);
    std::fs::write(path, &file)?;
    Ok(to_base64url(&file))
}

fn prove_demo(world: &DemoWorld, snap: &Snapshot, sk: &SpendingKey, env: &mut Envelope) -> anyhow::Result<usize> {
    prove(sk, &world.notes()?, snap, env)
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
            println!("\n  {}\n", req.sentence());
            println!("  They will learn: the claim, the block it is as of, that it was made for them, the expiry.");
            println!("  They will never learn: your balance, which notes, how many, any address, any payment.\n");
            if req.bind.as_deref() == Some("solana") && bind_solana.is_none() {
                bail!("this request must be bound to your Solana account: pass --bind-solana <pubkey>");
            }
            if !yes {
                eprint!("  Generate this proof? [y/N] ");
                let mut line = String::new();
                std::io::stdin().read_line(&mut line)?;
                if !line.trim().eq_ignore_ascii_case("y") {
                    bail!("cancelled; nothing was generated");
                }
            }
            let world: DemoWorld = serde_json::from_slice(&std::fs::read(&world)?)?;
            let pb = stage("pinning the anchor and rebuilding both roots");
            let snap = world.snapshot()?;
            done(pb, format!("demo anchor at block {}", snap.height));
            let binding = bind_solana.as_deref().map(solana_key).transpose()?.unwrap_or([0; 32]);
            let rs = secret();
            let mut env = envelope_for(&req, snap.anchor(), now(), binding, &rs);
            let pb = stage("selecting notes, building witnesses, proving, signing");
            let n = prove_demo(&world, &snap, &world.spending_key()?, &mut env)?;
            done(pb, format!("{} note{} used; balance not revealed", n, if n == 1 { "" } else { "s" }));
            let b64 = write_proof(&out, &env)?;
            let tag = hex::encode(env.revocation);
            let mut h = History::load(&history_path())?;
            h.entries.push(Entry {
                id: tag[..16].to_string(),
                claim: format!("Holds at least {} ZEC", zec(req.zatoshi)),
                audience: req.audience.clone(),
                network: snap.network.clone(),
                anchor_height: snap.height,
                issued_at: env.issued_at,
                expires_at: env.expires_at,
                revocation_tag: tag.clone(),
                revocation_secret: hex::encode(rs),
                revoked_at: None,
                file: out.display().to_string(),
            });
            h.save(&history_path())?;
            println!("\n  wrote {} ({} bytes). Nothing was broadcast.", out.display(), encode(&env).len());
            println!("  proof id {} · revoke with: pof-prove revoke {}", &tag[..16], &tag[..16]);
            println!("\n  base64url (paste into /verify):\n{b64}");
        }

        Cmd::Demo(Demo::Fixtures { world, out, borrower }) => fixtures(&world, &out, borrower.as_deref())?,

        Cmd::Prove { request, snapshot, seed_file, account, network, bind_solana, out, yes } => {
            let req = parse_request(&request)?;
            println!("\n  {}\n", req.sentence());
            println!("  They will learn: the claim, the block it is as of, that it was made for them, the expiry.");
            println!("  They will never learn: your balance, which notes, how many, any address, any payment.\n");
            if req.bind.as_deref() == Some("solana") && bind_solana.is_none() {
                bail!("this request must be bound to your Solana account: pass --bind-solana <pubkey>");
            }
            if !yes {
                eprint!("  Generate this proof? [y/N] ");
                let mut line = String::new();
                std::io::stdin().read_line(&mut line)?;
                if !line.trim().eq_ignore_ascii_case("y") {
                    bail!("cancelled; nothing was generated");
                }
            }
            let pb = stage("reading your seed and deriving the Ironwood key (it stays in this process)");
            let sk = pof_prove::wallet::spending_key(&pof_prove::wallet::seed_from_file(&seed_file)?, &network, account)?;
            done(pb, format!("account {account} on {network}"));
            let pb = stage("loading the snapshot");
            let chain = pof_anchor::Snapshot::read(&mut std::fs::File::open(&snapshot)?)?;
            anyhow::ensure!(chain.network == network, "the snapshot is for {}, not {network}", chain.network);
            done(pb, format!("{} Ironwood actions to block {}", chain.actions.len(), chain.height));
            let pb = stage("finding your notes (trial decryption with your viewing key, all cores)");
            let fvk = voting_crypto_deps::orchard::keys::FullViewingKey::from(&sk);
            let notes = pof_prove::wallet::find_notes(&chain, &fvk);
            done(pb, format!("{} note{} found", notes.len(), if notes.len() == 1 { "" } else { "s" }));
            anyhow::ensure!(!notes.is_empty(), "no Ironwood notes for this key in the snapshot: check the account index, and that your funds are in the Ironwood pool");
            let pb = stage("rebuilding both roots: the note-commitment tree and the spent-nullifier tree");
            let snap = pof_prove::wallet::snapshot(&chain)?;
            done(pb, format!("anchor at block {}", snap.height));
            let binding = bind_solana.as_deref().map(solana_key).transpose()?.unwrap_or([0; 32]);
            let rs = secret();
            let mut env = envelope_for(&req, snap.anchor(), now(), binding, &rs);
            let pb = stage("selecting notes, building witnesses, proving, signing");
            let n = prove(&sk, &notes, &snap, &mut env)?;
            done(pb, format!("{} note{} used; balance not revealed", n, if n == 1 { "" } else { "s" }));
            let b64 = write_proof(&out, &env)?;
            let tag = hex::encode(env.revocation);
            let mut h = History::load(&history_path())?;
            h.entries.push(Entry {
                id: tag[..16].to_string(),
                claim: format!("Holds at least {} ZEC", zec(req.zatoshi)),
                audience: req.audience.clone(),
                network: network.clone(),
                anchor_height: snap.height,
                issued_at: env.issued_at,
                expires_at: env.expires_at,
                revocation_tag: tag.clone(),
                revocation_secret: hex::encode(rs),
                revoked_at: None,
                file: out.display().to_string(),
            });
            h.save(&history_path())?;
            println!("\n  wrote {} ({} bytes). Nothing was broadcast.", out.display(), encode(&env).len());
            println!("  anchor: {network} block {}. Verifiers accept it once this anchor is in their table.", snap.height);
            println!("  proof id {} · revoke with: pof-prove revoke {}", &tag[..16], &tag[..16]);
            println!("\n  base64url (paste into /verify):\n{b64}");
        }

        Cmd::History { secrets } => {
            let h = History::load(&history_path())?;
            if h.entries.is_empty() {
                println!("No proofs yet.");
            }
            let t = now();
            for e in &h.entries {
                let status = if e.revoked_at.is_some() {
                    "revoked"
                } else if t > e.expires_at {
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
            let e = h.find(&id).ok_or_else(|| anyhow::anyhow!("no proof with id {id} in {}", path.display()))?;
            let body = serde_json::json!({ "secret": e.revocation_secret });
            let res = ureq::post(&endpoint).send_json(&body).context("posting the revocation")?;
            if res.status().as_u16() >= 300 {
                bail!("the revocation list refused it: HTTP {}", res.status());
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
        prove_demo(&world, &snap, &sk, &mut env)?;
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
    let _ = revocation_tag; // tags are derived by verifiers from the published secrets
    println!("wrote {} vectors to {}", meta["expected"].as_object().map_or(0, |m| m.len()), dir.display());
    Ok(())
}
