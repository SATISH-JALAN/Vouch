//! pof-gate and pof-credit against LiteSVM, loading the SBF builds from target/deploy.
//! Build first: `anchor build` (or `cargo build-sbf`) in backend/solana. Then `cargo test`.
//!
//! Every attack from the architecture doc is a test: wrong key, wrong message, offsets that
//! point into another instruction, stale slot, expired proof, replay, unknown claim, below
//! threshold, wrong audience, wrong signer, and double consumption.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use ed25519_dalek::{Signer as _, SigningKey};
use litesvm::LiteSVM;
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use pof_gate::ClaimReceipt;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

type Pubkey = anchor_lang::prelude::Pubkey;

const NOW: i64 = 1_790_200_000;
const SLOT: u64 = 400_000_000;
const REQUIRED: u64 = 50_000_000_000; // 500 ZEC

fn audience(id: &str) -> [u8; 32] {
    let s = format!("pof-audience:{}", id.trim().to_lowercase());
    blake2b_simd::Params::new().hash_length(32).hash(s.as_bytes()).as_bytes().try_into().unwrap()
}

struct Msg {
    subject: [u8; 32],
    beneficiary: Pubkey,
    audience: [u8; 32],
    kind: u8,
    value: u64,
    height: u32,
    expires: u64,
    verdict: u8,
    slot: u64,
}

impl Msg {
    fn valid(beneficiary: Pubkey, subject_seed: u8) -> Self {
        Msg { subject: [subject_seed; 32], beneficiary, audience: audience("pof-credit:usdc-pool-1"), kind: 0, value: REQUIRED, height: 3_491_040, expires: (NOW + 86_400) as u64, verdict: 0, slot: SLOT - 5 }
    }
    fn bytes(&self) -> Vec<u8> {
        let mut m = Vec::with_capacity(139);
        m.extend_from_slice(b"POF-ATTEST-v1");
        m.extend_from_slice(&self.subject);
        m.extend_from_slice(self.beneficiary.as_ref());
        m.extend_from_slice(&self.audience);
        m.push(self.kind);
        m.extend_from_slice(&self.value.to_le_bytes());
        m.extend_from_slice(&self.height.to_le_bytes());
        m.extend_from_slice(&self.expires.to_le_bytes());
        m.push(self.verdict);
        m.extend_from_slice(&self.slot.to_le_bytes());
        assert_eq!(m.len(), 139);
        m
    }
}

/// Ed25519 native-program instruction with every offset pointing into itself.
fn ed25519_ix(keys: &[&SigningKey], msg: &[u8]) -> Instruction {
    let n = keys.len();
    let header = 2 + 14 * n;
    let mut data = vec![n as u8, 0];
    let mut body = Vec::new();
    for k in keys {
        let pk_off = header + body.len();
        body.extend_from_slice(k.verifying_key().as_bytes());
        let sig_off = header + body.len();
        body.extend_from_slice(&k.sign(msg).to_bytes());
        let msg_off = header + body.len();
        body.extend_from_slice(msg);
        for v in [sig_off, 0xFFFF, pk_off, 0xFFFF, msg_off, msg.len(), 0xFFFF] {
            data.extend_from_slice(&(v as u16).to_le_bytes());
        }
    }
    data.extend_from_slice(&body);
    Instruction { program_id: solana_sdk_ids::ed25519_program::ID, accounts: vec![], data }
}

struct World {
    svm: LiteSVM,
    admin: Keypair,
    attestors: Vec<SigningKey>,
    borrower: Keypair,
    stranger: Keypair,
    mint: Pubkey,
}

fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, program).0
}

fn config() -> Pubkey {
    pda(&[b"config"], &pof_gate::ID)
}
fn receipt(subject: &[u8; 32]) -> Pubkey {
    pda(&[b"receipt", subject], &pof_gate::ID)
}
fn pool(mint: &Pubkey) -> Pubkey {
    pda(&[b"pool", mint.as_ref()], &pof_credit::ID)
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> Result<(), String> {
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), &signers, svm.latest_blockhash());
    let r = svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?} {}", e.err, e.meta.logs.join("\n")));
    svm.expire_blockhash();
    r
}

fn world(threshold: u8, n_attestors: usize) -> World {
    let mut svm = LiteSVM::new().with_precompiles();
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/deploy");
    svm.add_program_from_file(pof_gate::ID, format!("{dir}/pof_gate.so")).expect("run `anchor build` first");
    svm.add_program_from_file(pof_credit::ID, format!("{dir}/pof_credit.so")).expect("run `anchor build` first");
    let mut clock: Clock = svm.get_sysvar();
    clock.slot = SLOT;
    clock.unix_timestamp = NOW;
    svm.set_sysvar(&clock);

    let admin = Keypair::new();
    let borrower = Keypair::new();
    let stranger = Keypair::new();
    for k in [&admin, &borrower, &stranger] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let attestors: Vec<SigningKey> = (0..n_attestors).map(|i| SigningKey::from_bytes(&[i as u8 + 1; 32])).collect();
    let keys: Vec<Pubkey> = attestors.iter().map(|k| Pubkey::new_from_array(k.verifying_key().to_bytes())).collect();

    let init = Instruction {
        program_id: pof_gate::ID,
        accounts: pof_gate::accounts::Initialize { config: config(), admin: admin.pubkey(), system_program: anchor_lang::system_program::ID }.to_account_metas(None),
        data: pof_gate::instruction::Initialize { attestors: keys, threshold, max_age_slots: 150 }.data(),
    };
    send(&mut svm, &[init], &admin, &[]).unwrap();

    let mint = CreateMint::new(&mut svm, &admin).decimals(6).send().unwrap();
    let vault = pda(&[b"vault", pool(&mint).as_ref()], &pof_credit::ID);
    let init_pool = Instruction {
        program_id: pof_credit::ID,
        accounts: pof_credit::accounts::InitPool {
            pool: pool(&mint),
            mint,
            vault,
            authority: admin.pubkey(),
            token_program: litesvm_token::TOKEN_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pof_credit::instruction::InitPool { audience: audience("pof-credit:usdc-pool-1"), required_zatoshi: REQUIRED, line_limit: 25_000_000_000 }.data(),
    };
    send(&mut svm, &[init_pool], &admin, &[]).unwrap();
    MintTo::new(&mut svm, &admin, &mint, &vault, 1_000_000_000_000).send().unwrap();
    World { svm, admin, attestors, borrower, stranger, mint }
}

fn submit_ix(payer: &Pubkey, m: &Msg) -> Instruction {
    Instruction {
        program_id: pof_gate::ID,
        accounts: pof_gate::accounts::SubmitAttestation {
            config: config(),
            receipt: receipt(&m.subject),
            payer: *payer,
            instructions: solana_sdk_ids::sysvar::instructions::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pof_gate::instruction::SubmitAttestation { subject: m.subject, message: m.bytes() }.data(),
    }
}

fn open_line_ix(w: &World, borrower: &Pubkey, subject: &[u8; 32]) -> Instruction {
    let p = pool(&w.mint);
    Instruction {
        program_id: pof_credit::ID,
        accounts: pof_credit::accounts::OpenLine {
            pool: p,
            receipt: receipt(subject),
            line: pda(&[b"line", subject.as_ref(), borrower.as_ref()], &pof_credit::ID),
            borrower: *borrower,
            consumer: pda(&[b"consumer"], &pof_credit::ID),
            gate_program: pof_gate::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pof_credit::instruction::OpenLine {}.data(),
    }
}

fn attest(w: &mut World, m: &Msg) -> Result<(), String> {
    let payer = Keypair::new();
    w.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let a0 = w.attestors[0].clone();
    send(&mut w.svm, &[ed25519_ix(&[&a0], &m.bytes()), submit_ix(&payer.pubkey(), m)], &payer, &[])
}

fn read_receipt(w: &World, subject: &[u8; 32]) -> ClaimReceipt {
    let acc = w.svm.get_account(&receipt(subject)).expect("receipt exists");
    ClaimReceipt::try_deserialize(&mut &acc.data[..]).unwrap()
}

#[test]
fn happy_path_opens_and_draws() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 1);
    attest(&mut w, &m).expect("valid attestation is accepted");
    let r = read_receipt(&w, &m.subject);
    assert_eq!(r.claim_value, REQUIRED);
    assert!(!r.consumed);

    let b = w.borrower.insecure_clone();
    let ix = open_line_ix(&w, &b.pubkey(), &m.subject);
    send(&mut w.svm, &[ix], &b, &[]).expect("open_line");
    assert!(read_receipt(&w, &m.subject).consumed);

    let ata = CreateAssociatedTokenAccount::new(&mut w.svm, &b, &w.mint).owner(&b.pubkey()).send().unwrap();
    let p = pool(&w.mint);
    let draw = |amount: u64| Instruction {
        program_id: pof_credit::ID,
        accounts: pof_credit::accounts::Draw {
            pool: p,
            line: pda(&[b"line", m.subject.as_ref(), b.pubkey().as_ref()], &pof_credit::ID),
            borrower: b.pubkey(),
            vault: pda(&[b"vault", p.as_ref()], &pof_credit::ID),
            borrower_token: ata,
            token_program: litesvm_token::TOKEN_ID,
        }
        .to_account_metas(None),
        data: pof_credit::instruction::Draw { amount }.data(),
    };
    send(&mut w.svm, &[draw(1_000_000_000)], &b, &[]).expect("draw within limit");
    assert!(send(&mut w.svm, &[draw(25_000_000_000)], &b, &[]).unwrap_err().contains("OverLimit"), "over the limit");
}

#[test]
fn replay_of_the_same_proof_fails() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 2);
    attest(&mut w, &m).unwrap();
    let mut again = Msg::valid(w.borrower.pubkey(), 2);
    again.slot = SLOT - 1; // re-attested later: different message, same proof id
    assert!(attest(&mut w, &again).is_err(), "one proof, one receipt");
}

#[test]
fn wrong_key_is_refused() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 3);
    let rogue = SigningKey::from_bytes(&[99; 32]);
    let payer = Keypair::new();
    w.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let e = send(&mut w.svm, &[ed25519_ix(&[&rogue], &m.bytes()), submit_ix(&payer.pubkey(), &m)], &payer, &[]).unwrap_err();
    assert!(e.contains("NotEnoughSignatures"), "{e}");
}

#[test]
fn signature_over_a_different_message_is_refused() {
    let mut w = world(1, 1);
    let signed = Msg::valid(w.borrower.pubkey(), 4);
    let mut claimed = Msg::valid(w.borrower.pubkey(), 4);
    claimed.value = REQUIRED * 10; // raise the claim after signing
    let payer = Keypair::new();
    w.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let a0 = w.attestors[0].clone();
    let e = send(&mut w.svm, &[ed25519_ix(&[&a0], &signed.bytes()), submit_ix(&payer.pubkey(), &claimed)], &payer, &[]).unwrap_err();
    assert!(e.contains("NotEnoughSignatures"), "{e}");
}

#[test]
fn offsets_into_another_instruction_are_refused() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 5);
    let a0 = w.attestors[0].clone();
    // The signature is genuine, but the message offset points into instruction 1's data
    // (anchor discriminator 8 + subject 32 + vec length 4 = 44).
    let mut ix = ed25519_ix(&[&a0], &m.bytes());
    // offsets entry: sig_off 2..4 · sig_ix 4..6 · pk_off 6..8 · pk_ix 8..10 · msg_off 10..12 · msg_len 12..14 · msg_ix 14..16
    ix.data[10..12].copy_from_slice(&44u16.to_le_bytes()); // message offset inside instruction 1
    ix.data[12..14].copy_from_slice(&139u16.to_le_bytes());
    ix.data[14..16].copy_from_slice(&1u16.to_le_bytes()); // message instruction index = 1
    let payer = Keypair::new();
    w.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let e = send(&mut w.svm, &[ix, submit_ix(&payer.pubkey(), &m)], &payer, &[]).unwrap_err();
    assert!(e.contains("ForeignOffsets"), "{e}");
}

#[test]
fn stale_expired_invalid_and_unknown_are_refused() {
    let mut w = world(1, 1);
    let mut m = Msg::valid(w.borrower.pubkey(), 6);
    m.slot = SLOT - 1_000;
    assert!(attest(&mut w, &m).unwrap_err().contains("Stale"));
    let mut m = Msg::valid(w.borrower.pubkey(), 7);
    m.expires = (NOW - 1) as u64;
    assert!(attest(&mut w, &m).unwrap_err().contains("Expired"));
    let mut m = Msg::valid(w.borrower.pubkey(), 8);
    m.verdict = 1;
    assert!(attest(&mut w, &m).unwrap_err().contains("NotValid"));
    let mut m = Msg::valid(w.borrower.pubkey(), 9);
    m.kind = 2;
    assert!(attest(&mut w, &m).unwrap_err().contains("UnknownClaim"));
}

#[test]
fn only_the_bound_account_can_open_a_line() {
    let mut w = world(1, 1);
    let m = Msg::valid(w.borrower.pubkey(), 10);
    attest(&mut w, &m).unwrap();
    let s = w.stranger.insecure_clone();
    let ix = open_line_ix(&w, &s.pubkey(), &m.subject);
    assert!(send(&mut w.svm, &[ix], &s, &[]).unwrap_err().contains("NotBoundToSigner"));
    // and still refused once the rightful borrower has opened the line
    let b = w.borrower.insecure_clone();
    let ix = open_line_ix(&w, &b.pubkey(), &m.subject);
    send(&mut w.svm, &[ix], &b, &[]).unwrap();
    let ix = open_line_ix(&w, &s.pubkey(), &m.subject);
    assert!(send(&mut w.svm, &[ix], &s, &[]).unwrap_err().contains("NotBoundToSigner"));
}

#[test]
fn below_threshold_and_wrong_audience_are_refused() {
    let mut w = world(1, 1);
    let b = w.borrower.insecure_clone();
    let mut low = Msg::valid(b.pubkey(), 11);
    low.value = REQUIRED - 12_500_000;
    attest(&mut w, &low).unwrap();
    let ix = open_line_ix(&w, &b.pubkey(), &low.subject);
    assert!(send(&mut w.svm, &[ix], &b, &[]).unwrap_err().contains("BelowThreshold"));

    let mut other = Msg::valid(b.pubkey(), 12);
    other.audience = audience("otc-desk:someone-else");
    attest(&mut w, &other).unwrap();
    let ix = open_line_ix(&w, &b.pubkey(), &other.subject);
    assert!(send(&mut w.svm, &[ix], &b, &[]).unwrap_err().contains("WrongAudience"));
}

#[test]
fn a_receipt_funds_one_line_only() {
    let mut w = world(1, 1);
    let b = w.borrower.insecure_clone();
    let m = Msg::valid(b.pubkey(), 13);
    attest(&mut w, &m).unwrap();
    // a second pool with the same terms, different mint
    let mint2 = CreateMint::new(&mut w.svm, &w.admin).decimals(6).send().unwrap();
    let admin = w.admin.insecure_clone();
    let init_pool = Instruction {
        program_id: pof_credit::ID,
        accounts: pof_credit::accounts::InitPool {
            pool: pool(&mint2),
            mint: mint2,
            vault: pda(&[b"vault", pool(&mint2).as_ref()], &pof_credit::ID),
            authority: admin.pubkey(),
            token_program: litesvm_token::TOKEN_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: pof_credit::instruction::InitPool { audience: audience("pof-credit:usdc-pool-1"), required_zatoshi: REQUIRED, line_limit: 1 }.data(),
    };
    send(&mut w.svm, &[init_pool], &admin, &[]).unwrap();
    let ix = open_line_ix(&w, &b.pubkey(), &m.subject);
    send(&mut w.svm, &[ix], &b, &[]).unwrap();
    w.mint = mint2;
    let ix = open_line_ix(&w, &b.pubkey(), &m.subject);
    // Refused twice over: the line for this proof already exists, and the receipt is consumed.
    let e = send(&mut w.svm, &[ix], &b, &[]).unwrap_err();
    assert!(e.contains("already in use") || e.contains("ReceiptConsumed"), "{e}");
}

#[test]
fn one_wallet_can_open_a_line_per_proof() {
    // Every visitor to the demo shares one borrower: an open line must not block the next proof.
    let mut w = world(1, 1);
    let b = w.borrower.insecure_clone();
    for seed in [15, 16] {
        let m = Msg::valid(b.pubkey(), seed);
        attest(&mut w, &m).unwrap();
        let ix = open_line_ix(&w, &b.pubkey(), &m.subject);
        send(&mut w.svm, &[ix], &b, &[]).expect("a fresh proof opens its own line");
    }
}

#[test]
fn threshold_two_of_three() {
    let mut w = world(2, 3);
    let m = Msg::valid(w.borrower.pubkey(), 14);
    assert!(attest(&mut w, &m).unwrap_err().contains("NotEnoughSignatures"), "one signature is not enough");
    let payer = Keypair::new();
    w.svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (a, b) = (w.attestors[0].clone(), w.attestors[2].clone());
    // the same key twice counts once
    let e = send(&mut w.svm, &[ed25519_ix(&[&a, &a], &m.bytes()), submit_ix(&payer.pubkey(), &m)], &payer, &[]).unwrap_err();
    assert!(e.contains("NotEnoughSignatures"), "{e}");
    send(&mut w.svm, &[ed25519_ix(&[&a, &b], &m.bytes()), submit_ix(&payer.pubkey(), &m)], &payer, &[]).expect("two distinct attestors");
    assert_eq!(read_receipt(&w, &m.subject).signers, 2);
}
