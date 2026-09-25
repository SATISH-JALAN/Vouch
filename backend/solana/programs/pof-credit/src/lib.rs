//! pof-credit — the demo consumer of pof-gate receipts.
//!
//! Deliberately small: it exists to show a receipt is integrable, not to be a lending
//! protocol. A pool names the audience it accepts proofs for (the hash of its verifier
//! identifier) and a threshold. `open_line` reads a `ClaimReceipt`, checks audience,
//! threshold, expiry and that the signer is the account the proof was bound to, consumes the
//! receipt by CPI and opens a credit line. `draw` lends from the vault.
//!
//! A line is keyed by the proof it was opened against and its borrower
//! (`[b"line", subject, borrower]`): one proof, one line. Keying by borrower alone would not stop
//! anyone reusing funds (a second wallet gets around it), and it would let one open line block
//! every later proof bound to the same account. The borrower in the seed means another wallet
//! presenting the same receipt reaches the `NotBoundToSigner` check instead of a collision.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use pof_gate::{program::PofGate, ClaimReceipt};

declare_id!("J6ewFZAzcTkbVsYNBrcZvzdBtTTUK5UrpqCg9jiNyra1");

#[program]
pub mod pof_credit {
    use super::*;

    pub fn init_pool(ctx: Context<InitPool>, audience: [u8; 32], required_zatoshi: u64, line_limit: u64) -> Result<()> {
        require!(required_zatoshi > 0 && line_limit > 0, CreditError::BadTerms);
        let p = &mut ctx.accounts.pool;
        p.authority = ctx.accounts.authority.key();
        p.mint = ctx.accounts.mint.key();
        p.vault = ctx.accounts.vault.key();
        p.audience = audience;
        p.required_zatoshi = required_zatoshi;
        p.line_limit = line_limit;
        p.bump = ctx.bumps.pool;
        Ok(())
    }

    pub fn open_line(ctx: Context<OpenLine>) -> Result<()> {
        let r = &ctx.accounts.receipt;
        let pool = &ctx.accounts.pool;
        let borrower = ctx.accounts.borrower.key();
        let clock = Clock::get()?;
        require!(r.audience == pool.audience, CreditError::WrongAudience);
        require!(r.claim_value >= pool.required_zatoshi, CreditError::BelowThreshold);
        require_keys_eq!(r.beneficiary, borrower, CreditError::NotBoundToSigner);
        require!(!r.consumed, CreditError::ReceiptConsumed);
        require!(r.expires_at > clock.unix_timestamp, CreditError::ProofExpired);

        let bump = ctx.bumps.consumer;
        let seeds: &[&[u8]] = &[b"consumer", &[bump]];
        pof_gate::cpi::mark_consumed(CpiContext::new_with_signer(
            ctx.accounts.gate_program.key(),
            pof_gate::cpi::accounts::MarkConsumed {
                receipt: ctx.accounts.receipt.to_account_info(),
                beneficiary: ctx.accounts.borrower.to_account_info(),
                consumer: ctx.accounts.consumer.to_account_info(),
                consumer_program: ctx.accounts.consumer_program.to_account_info(),
            },
            &[seeds],
        ))?;

        let line = &mut ctx.accounts.line;
        line.pool = pool.key();
        line.borrower = borrower;
        line.limit = pool.line_limit;
        line.drawn = 0;
        line.opened_against = ctx.accounts.receipt.subject;
        line.anchor_height = ctx.accounts.receipt.anchor_height;
        line.opened_slot = clock.slot;
        line.bump = ctx.bumps.line;
        emit!(LineOpened { line: line.key(), borrower, limit: line.limit, against: line.opened_against });
        Ok(())
    }

    pub fn draw(ctx: Context<Draw>, amount: u64) -> Result<()> {
        let line = &mut ctx.accounts.line;
        let after = line.drawn.checked_add(amount).ok_or(CreditError::OverLimit)?;
        require!(amount > 0 && after <= line.limit, CreditError::OverLimit);
        line.drawn = after;
        let pool = &ctx.accounts.pool;
        let mint = pool.mint;
        let seeds: &[&[u8]] = &[b"pool", mint.as_ref(), &[pool.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.borrower_token.to_account_info(), authority: ctx.accounts.pool.to_account_info() },
                &[seeds],
            ),
            amount,
        )?;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    /// blake2b("pof-audience:" ‖ identifier). Proofs for anyone else are refused.
    pub audience: [u8; 32],
    pub required_zatoshi: u64,
    /// Per-line limit, in the mint's base units.
    pub line_limit: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CreditLine {
    pub pool: Pubkey,
    pub borrower: Pubkey,
    pub limit: u64,
    pub drawn: u64,
    /// The receipt subject (proof id) this line was opened against.
    pub opened_against: [u8; 32],
    pub anchor_height: u32,
    pub opened_slot: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(init, payer = authority, space = 8 + Pool::INIT_SPACE, seeds = [b"pool", mint.key().as_ref()], bump)]
    pub pool: Account<'info, Pool>,
    /// The pool's creator must control the mint: nobody can open a pool under someone else's asset.
    #[account(mint::authority = authority)]
    pub mint: Account<'info, Mint>,
    #[account(init, payer = authority, token::mint = mint, token::authority = pool, seeds = [b"vault", pool.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenLine<'info> {
    #[account(seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(mut)]
    pub receipt: Account<'info, ClaimReceipt>,
    #[account(init, payer = payer, space = 8 + CreditLine::INIT_SPACE, seeds = [b"line", receipt.subject.as_ref(), borrower.key().as_ref()], bump)]
    pub line: Account<'info, CreditLine>,
    pub borrower: Signer<'info>,
    /// Pays the line's rent, so a borrower needs no SOL (in the demo, the relayer).
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: this program's consumer authority PDA; it signs the CPI into pof-gate.
    #[account(seeds = [b"consumer"], bump)]
    pub consumer: UncheckedAccount<'info>,
    /// This program, named to pof-gate as the consumer.
    pub consumer_program: Program<'info, program::PofCredit>,
    pub gate_program: Program<'info, PofGate>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Draw<'info> {
    #[account(seeds = [b"pool", pool.mint.as_ref()], bump = pool.bump, has_one = vault)]
    pub pool: Account<'info, Pool>,
    #[account(mut, seeds = [b"line", line.opened_against.as_ref(), borrower.key().as_ref()], bump = line.bump, has_one = borrower, has_one = pool)]
    pub line: Account<'info, CreditLine>,
    pub borrower: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = pool.mint, token::authority = borrower)]
    pub borrower_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct LineOpened {
    pub line: Pubkey,
    pub borrower: Pubkey,
    pub limit: u64,
    pub against: [u8; 32],
}

#[error_code]
pub enum CreditError {
    #[msg("terms must be non-zero")]
    BadTerms,
    #[msg("the proof was made for a different verifier")]
    WrongAudience,
    #[msg("the proven amount is below this pool's threshold")]
    BelowThreshold,
    #[msg("the signer is not the account the proof is bound to")]
    NotBoundToSigner,
    #[msg("this receipt has already funded a line")]
    ReceiptConsumed,
    #[msg("the proof has expired")]
    ProofExpired,
    #[msg("draw exceeds the line's limit")]
    OverLimit,
}
