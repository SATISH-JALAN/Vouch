// The demo relayer: pays for and sends the demo's Solana transactions with devnet keys held
// here, so a visitor needs no wallet. It holds the borrower key the demo proof is bound to,
// and a "stranger" key for the wrong-wallet run. Everything it does is on a public explorer.
import { PublicKey, SystemProgram } from '@solana/web3.js'
import { formatUnits } from '@/lib/server/units'
import {
  bs58, connection, decodePool, ed25519Ix, explain, explorer, keypairFrom, linePda, openLineIx, receiptPda, send, submitIx, GATE_ID, CREDIT_ID,
} from '@/lib/server/solana'
import { clientKey, limited } from '@/lib/server/store'
import type { CreditLine, GateTransaction } from '@/lib/data/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body =
  | { action: 'borrower' }
  | { action: 'submit'; attestation: { message: string; signature: string; attestor: string }; tamper?: boolean }
  | { action: 'open-line'; receipt: string; wallet?: 'borrower' | 'stranger' }

function configured() {
  const { SOLANA_RPC_URL, POF_POOL, RELAYER_SECRET_KEY, BORROWER_SECRET_KEY } = process.env
  return Boolean(SOLANA_RPC_URL && POF_POOL && RELAYER_SECRET_KEY && BORROWER_SECRET_KEY)
}

export async function POST(req: Request) {
  if (!configured()) return Response.json({ error: 'the Solana relayer is not configured on this deployment' }, { status: 503 })
  if (limited(`relay:${clientKey(req)}`, 20, 60_000)) return Response.json({ error: 'slow down' }, { status: 429 })
  const body = (await req.json().catch(() => null)) as Body | null
  if (!body) return Response.json({ error: 'bad request' }, { status: 400 })

  const relayer = keypairFrom(process.env.RELAYER_SECRET_KEY, 'RELAYER_SECRET_KEY')
  const borrower = keypairFrom(process.env.BORROWER_SECRET_KEY, 'BORROWER_SECRET_KEY')
  if (body.action === 'borrower') return Response.json({ borrower: borrower.publicKey.toBase58() })

  const conn = connection()
  if (body.action === 'submit') {
    const message = Buffer.from(body.attestation.message, 'hex')
    const signature = Buffer.from(body.attestation.signature, 'hex')
    if (message.length !== 139 || signature.length !== 64) return Response.json({ error: 'malformed attestation' }, { status: 400 })
    const attestor = new PublicKey(body.attestation.attestor)
    // "Flip one byte of the attestation": the claim value, changed after the attestor signed.
    const sent = Buffer.from(message)
    if (body.tamper) sent[110] = sent[110]! ^ 0x01
    const subject = sent.subarray(13, 45)
    try {
      const sig = await send(conn, [ed25519Ix(attestor, sent, signature), submitIx(relayer.publicKey, sent)], [relayer])
      const status = await conn.getSignatureStatus(sig)
      const receipt = receiptPda(subject).toBase58()
      const tx: GateTransaction = {
        signature: sig,
        slot: status.value?.slot ?? 0,
        receipt,
        explorer: explorer('tx', sig),
        instructions: [
          { index: 0, program: 'Ed25519 native program', programId: 'Ed25519SigVerify111111111111111111111111111', summary: `verify sig by ${attestor.toBase58().slice(0, 6)}… over 139 bytes` },
          { index: 1, program: 'pof-gate', programId: GATE_ID.toBase58(), summary: 'submit_attestation → ClaimReceipt created' },
        ],
      }
      return Response.json({ tx })
    } catch (err) {
      const why = explain(err)
      const failedAt = /already in use/i.test(why) || /already in use/i.test(String((err as Error).message))
        ? 'Instruction 1 · pof-gate · the receipt for this proof already exists'
        : body.tamper || /signature|precompile|0x2|custom program error: 0x2/i.test(why)
          ? 'Instruction 0 · Ed25519SigVerify'
          : 'Instruction 1 · pof-gate'
      const message = failedAt.startsWith('Instruction 0')
        ? `The Ed25519 native program rejected the signature: one byte of the attestation was changed after the attestor signed it. The transaction failed before pof-gate ran; no receipt exists. (${why})`
        : failedAt.includes('already exists')
          ? `Replay refused: the ClaimReceipt account for this proof id already exists, so pof-gate cannot create it again. One proof, one receipt. (${why})`
          : why
      return Response.json({ error: message, failedAt }, { status: 422 })
    }
  }

  if (body.action === 'open-line') {
    const pool = new PublicKey(process.env.POF_POOL!)
    const who = body.wallet === 'stranger' ? keypairFrom(process.env.STRANGER_SECRET_KEY ?? bs58.encode(relayer.secretKey), 'STRANGER_SECRET_KEY') : borrower
    try {
      const receipt = new PublicKey(body.receipt)
      // the borrower pays rent for its CreditLine; top it up from the relayer in the same transaction
      const fund = SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: who.publicKey, lamports: 5_000_000 })
      const sig = await send(conn, [fund, openLineIx(pool, who.publicKey, receipt)], [relayer, who])
      const poolAcc = await conn.getAccountInfo(pool)
      const p = decodePool(poolAcc!.data)
      const line = linePda(pool, who.publicKey)
      const out: CreditLine = {
        account: line.toBase58(),
        pool: pool.toBase58(),
        limit: `${formatUnits(p.lineLimit, 6)} dUSDC`,
        drawn: '0.00 dUSDC',
        openedAgainst: body.receipt,
        requiredZatoshi: Number(p.requiredZatoshi),
        explorer: explorer('tx', sig),
      }
      return Response.json({ line: out })
    } catch (err) {
      const why = explain(err)
      return Response.json({ error: why, failedAt: `pof-credit · open_line${body.wallet === 'stranger' ? ' (another wallet)' : ''}` }, { status: 422 })
    }
  }
  return Response.json({ error: 'unknown action' }, { status: 400 })
}

export function GET() {
  return Response.json({ gate: GATE_ID.toBase58(), credit: CREDIT_ID.toBase58(), configured: configured() })
}
