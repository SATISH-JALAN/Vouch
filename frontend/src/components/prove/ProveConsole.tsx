'use client'

import { useCallback, useEffect, useState, type DragEvent } from 'react'
import type { ProofRequest, ServiceStatus, VerificationResult } from '@/lib/data/types'
import { decodeRequestDetailed, encodeRequest, cliCommand, demoCliCommand, newRequestId } from '@/lib/request'
import { verify } from '@/lib/data/verifier'
import { demoProve, serviceStatus } from '@/lib/data/services'
import { DEMO_AUDIENCE } from '@/lib/data/chain'
import { claimParts, formatDate, formatStamp } from '@/lib/format'
import { fromBase64Url, toBase64Url } from '@/lib/pof/bytes'
import { MAGIC } from '@/lib/pof/codec'
import { downloadReceipt } from '@/lib/receipt'
import { Chip, cx, Eyebrow, Panel, TrustNote } from '@/components/ui/primitives'
import { RevealTable } from '@/components/ui/RevealTable'
import { Verdict } from '@/components/ui/Verdict'
import { SourceNote } from '@/components/verify/SourceNote'
import { CopyBlock } from '@/components/request/RequestBuilder'
import { readHistory, revoke, revokedSecrets, upsert, writeHistory, type HistoryEntry } from './history'

const SAMPLE: ProofRequest = { v: 1, claim: 'HoldsAtLeast', zatoshi: '50000000000', audience: DEMO_AUDIENCE.id, expiryDays: 7 }

const INSTALL: Record<string, string> = {
  'macOS / Linux': 'cargo install --git https://github.com/SATISH-JALAN/Vouch pof-prove --locked',
  Windows: 'cargo install --git https://github.com/SATISH-JALAN/Vouch pof-prove --locked   # PowerShell, Rust 1.91+',
  'From source': 'git clone https://github.com/SATISH-JALAN/Vouch && cd Vouch/backend && cargo build --release -p pof-prove',
}

const isBase58Key = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim())

export function ProveConsole() {
  const [request, setRequest] = useState<ProofRequest | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [path, setPath] = useState<'wallet' | 'demo'>('demo')
  const [os, setOs] = useState('macOS / Linux')
  const [solana, setSolana] = useState('')
  const [proving, setProving] = useState(false)
  const [proveError, setProveError] = useState<string | null>(null)
  const [proof, setProof] = useState<{ b64: string; result: VerificationResult; provingMs?: number; notesUsed?: number } | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [revoked, setRevoked] = useState<Set<string>>(new Set())

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('r')
    if (r) {
      const d = decodeRequestDetailed(r)
      if (d.ok) setRequest(d.request)
      else setRequestError(d.reason)
    }
    setHistory(readHistory())
    void revokedSecrets().then(setRevoked)
    void serviceStatus().then((s) => {
      setStatus(s)
      if (!s.demoProver) setPath('wallet')
    })
  }, [])

  const needsBinding = request?.bind === 'solana'
  const bindingOk = !needsBinding || isBase58Key(solana)

  const record = useCallback(
    (b64: string, result: VerificationResult, secret?: string) => {
      const env = result.envelope
      if (!env || !request) return
      const p = claimParts(env.claim)
      setHistory(
        upsert({
          id: env.revocation.slice(0, 16),
          claim: `${p.before} ${p.value}`,
          audience: request.audience,
          network: result.anchor?.network ?? 'unknown',
          anchorHeight: env.anchor.height,
          createdAt: env.issuedAt,
          expiresAt: env.expiresAt,
          revocationTag: env.revocation,
          revocationSecret: secret,
          proof: b64,
        }),
      )
    },
    [request],
  )

  const selfVerify = useCallback(
    async (input: string | Uint8Array, secret?: string, meta?: { provingMs?: number; notesUsed?: number }) => {
      if (!request) return
      const b64 = typeof input === 'string' ? input.trim() : toBase64Url(input)
      const result = await verify(b64, request.audience)
      setProof({ b64, result, ...meta })
      if (result.verdict.kind === 'Valid') record(b64, result, secret)
    },
    [request, record],
  )

  const proveAsDemo = async () => {
    if (!request || !bindingOk) return
    setProving(true)
    setProveError(null)
    setProof(null)
    const out = await demoProve(request, needsBinding ? solana.trim() : undefined)
    if (out.ok) await selfVerify(out.proof.proof, out.proof.revocationSecret, { provingMs: out.proof.provingMs, notesUsed: out.proof.notesUsed })
    else setProveError(out.message)
    setProving(false)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const buf = new Uint8Array(await file.arrayBuffer())
    const isBinary = buf.length >= 4 && MAGIC.every((m, i) => buf[i] === m)
    await selfVerify(isBinary ? buf : new TextDecoder().decode(buf))
  }

  if (!request) {
    return (
      <div className="space-y-8">
        {requestError && (
          <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
            This request link cannot be used: {requestError}
          </div>
        )}
        <Panel label="No request open" bodyClassName="space-y-4 p-5 sm:p-8">
          <p className="t-body max-w-[60ch] text-ink-2">
            A verifier sends you a link that says exactly what they want to know. Open it and this page shows you what they will and will not learn
            before anything is generated.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={() => window.location.assign(`/prove?r=${encodeRequest({ ...SAMPLE, id: newRequestId() })}`)}>
              Open a sample request
            </button>
            <a className="btn btn-secondary" href="/request">
              Build a request
            </a>
          </div>
        </Panel>
        <History entries={history} revoked={revoked} onChange={setHistory} onRevoked={(s) => setRevoked(new Set([...revoked, s]))} />
      </div>
    )
  }

  const p = claimParts({ kind: 'HoldsAtLeast', zatoshi: Number(request.zatoshi) })
  const encoded = encodeRequest(request)
  const overdue = request.respondBy && request.respondBy < Date.now() / 1000

  return (
    <div className="space-y-16">
      {/* the review screen: the product */}
      <section aria-labelledby="review-h" className="rounded-panel border border-ink p-5 sm:p-8">
        <Eyebrow>INCOMING PROOF REQUEST · REVIEW BEFORE ANYTHING IS GENERATED</Eyebrow>
        <h2 id="review-h" className="t-display-m mt-6 max-w-[30ch] text-ink">
          <span className="font-mono text-[0.72em]">{request.audience}</span> asks you to prove you hold at least {p.value}.
        </h2>
        <p className="t-small mt-4 text-ink-2">
          Expires {request.expiryDays} {request.expiryDays === 1 ? 'day' : 'days'} after you generate it. You can revoke it before then.
          {request.respondBy && ` They asked for an answer by ${formatDate(request.respondBy)}${overdue ? ' — that date has passed' : ''}.`}
          {request.id && ` Request id ${request.id}.`}
        </p>
        <RevealTable
          className="mt-8"
          learn={[
            { label: 'The claim', value: `Holds at least ${p.value}` },
            { label: 'As of', value: 'one finalised block, chosen when you prove' },
            { label: 'Made for', value: request.audience },
            ...(needsBinding ? [{ label: 'Usable by', value: 'only your Solana account, which you name below' }] : []),
            { label: 'Valid for', value: `${request.expiryDays} ${request.expiryDays === 1 ? 'day' : 'days'}` },
          ]}
          never={[
            { label: 'Exact balance', width: 16 },
            { label: 'Which notes', width: 11 },
            { label: 'How many notes', width: 7 },
            { label: 'Any address', width: 22 },
            { label: 'Payment history', width: 14 },
            { label: 'Counterparties', width: 9 },
            { label: 'Future payments', width: 12 },
          ]}
        />
      </section>

      {/* approve */}
      <section aria-labelledby="approve-h" className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="approve-h" className="t-display-m text-ink">
            Approve it.
          </h2>
          <div role="tablist" aria-label="How to prove" className="flex overflow-hidden rounded-chip border border-border">
            {(
              [
                ['demo', 'As the demo holder'],
                ['wallet', 'With your own wallet'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={path === k}
                type="button"
                onClick={() => setPath(k)}
                className={cx('t-data-sm px-4 py-2 uppercase tracking-[0.1em] transition-colors', path === k ? 'bg-ink text-bone' : 'text-ink-2 hover:bg-bone-2')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {needsBinding && (
          <label className="block">
            <span className="t-eyebrow mb-2 block text-ink-3">YOUR SOLANA ACCOUNT (BASE58)</span>
            <input className="field t-data w-full" value={solana} onChange={(e) => setSolana(e.target.value)} placeholder="e.g. 7Xf…9Qk" spellCheck={false} aria-invalid={!!solana && !bindingOk} />
            <span className={cx('t-data-sm mt-2 block', solana && !bindingOk ? 'text-invalid' : 'text-ink-3')}>
              {solana && !bindingOk ? 'That is not a base58 Solana public key.' : 'The proof is bound to this account; nobody else can use it on-chain.'}
            </span>
          </label>
        )}

        {path === 'demo' ? (
          <Panel label="The demo holder" chip={<Chip>{status?.demoProver ? 'LIVE' : status ? 'NOT CONFIGURED' : 'CHECKING'}</Chip>} bodyClassName="space-y-5 p-5 sm:p-6">
            <p className="t-body max-w-[70ch] text-ink-2">
              No ZEC needed. The demo holder owns 4,018.2 ZEC in five real Ironwood notes on the published demo ledger. Pressing prove makes the
              demo prover answer this exact request with a real Halo2 proof; then this page verifies it the way the other side will.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-primary" onClick={() => void proveAsDemo()} disabled={proving || !status?.demoProver || !bindingOk}>
                {proving ? 'Proving…' : 'Prove as the demo holder'}
              </button>
              {!status?.demoProver && status && <span className="t-data-sm text-ink-3">{status.attestor.message ?? 'The demo prover runs inside pof-attest; this deployment has none.'} Use the CLI below.</span>}
            </div>
            <CopyBlock label="OR RUN THE SAME THING LOCALLY" value={demoCliCommand(encoded, request.bind)} />
          </Panel>
        ) : (
          <Panel label="Your own wallet" chip={<Chip>Keys stay on your machine</Chip>} bodyClassName="space-y-5 p-5 sm:p-6">
            <div role="tablist" aria-label="Install" className="flex flex-wrap gap-2">
              {Object.keys(INSTALL).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={os === k} onClick={() => setOs(k)} className={cx('btn btn-sm border', os === k ? 'border-ink bg-bone-2' : 'border-border hover:border-ink')}>
                  {k}
                </button>
              ))}
            </div>
            <CopyBlock label="1 · INSTALL THE PROVER" value={INSTALL[os]!} />
            <CopyBlock label="2 · ANSWER THIS REQUEST" value={cliCommand(encoded, request.bind)} />
            <p className="t-data-sm text-ink-3">
              It scans the Ironwood pool for your notes with your viewing key, picks the fewest that clear the bar, and proves. Nothing is broadcast
              and nothing leaves your machine but proof.pof.
            </p>
          </Panel>
        )}

        <label
          onDragOver={(e: DragEvent) => e.preventDefault()}
          onDrop={(e: DragEvent) => {
            e.preventDefault()
            void onFile(e.dataTransfer.files[0])
          }}
          className="flex cursor-pointer flex-col gap-2 rounded-panel border border-dashed border-border p-5 hover:border-ink hover:bg-bone-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-seal"
        >
          <span className="t-eyebrow text-ink-3">3 · CHECK IT BEFORE YOU SEND IT</span>
          <span className="t-title">Drop the proof.pof it wrote. You see exactly what they will see.</span>
          <input type="file" accept=".pof,.txt,application/octet-stream,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>

        {proveError && (
          <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
            The demo holder could not prove this: {proveError}
          </div>
        )}
      </section>

      {proof && (
        <section aria-labelledby="handover-h" className="space-y-6">
          <h2 id="handover-h" className="t-display-m text-ink">
            {proof.result.verdict.kind === 'Valid' ? 'Hand it over.' : 'Do not send this one.'}
          </h2>
          {proof.provingMs !== undefined && (
            <p className="t-data-sm text-ink-3">
              Proved in {(proof.provingMs / 1000).toFixed(1)} s from {proof.notesUsed} note{proof.notesUsed === 1 ? '' : 's'}. The count is not in the proof.
            </p>
          )}
          <Verdict result={proof.result} audienceId={request.audience} />
          <SourceNote anchor={proof.result.anchor} verifier={proof.result.verifier} />
          {proof.result.verdict.kind === 'Valid' && <Handover b64={proof.b64} audience={request.audience} result={proof.result} />}
        </section>
      )}

      <History entries={history} revoked={revoked} onChange={setHistory} onRevoked={(s) => setRevoked(new Set([...revoked, s]))} />
    </div>
  )
}

function Handover({ b64, audience, result }: { b64: string; audience: string; result: VerificationResult }) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (what: string, v: string) => {
    await navigator.clipboard.writeText(v).catch(() => {})
    setCopied(what)
    setTimeout(() => setCopied(null), 600)
  }
  const download = () => {
    const bytes = fromBase64Url(b64)
    if (!bytes) return
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'proof.pof'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }
  const link = () => `${window.location.origin}/verify#p=${b64}&a=${encodeURIComponent(audience)}`
  return (
    <Panel label="Send it however you already talk to them" bodyClassName="flex flex-wrap gap-2 p-5 sm:p-6">
      <button type="button" className="btn btn-primary" onClick={download}>
        Download proof.pof
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => void copy('link', link())}>
        <span className={copied === 'link' ? 'text-valid' : undefined}>{copied === 'link' ? 'Copied' : 'Copy verify link'}</span>
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => void copy('text', b64)}>
        <span className={copied === 'text' ? 'text-valid' : undefined}>{copied === 'text' ? 'Copied' : 'Copy as text'}</span>
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => downloadReceipt(result, audience)}>
        Download your receipt
      </button>
    </Panel>
  )
}

function History({ entries, revoked, onChange, onRevoked }: { entries: HistoryEntry[]; revoked: Set<string>; onChange: (e: HistoryEntry[]) => void; onRevoked: (secret: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [paste, setPaste] = useState<Record<string, string>>({})
  const now = Date.now() / 1000

  const doRevoke = async (e: HistoryEntry) => {
    const secret = (e.revocationSecret ?? paste[e.id] ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(secret)) {
      setMessage('Paste the 64-character revocation secret from `pof-prove history --secrets` first.')
      return
    }
    setBusy(e.id)
    const out = await revoke(secret)
    setBusy(null)
    setMessage(out.message)
    if (out.ok) {
      const next = entries.map((x) => (x.id === e.id ? { ...x, revocationSecret: secret, revokedAt: Math.floor(now) } : x))
      writeHistory(next)
      onChange(next)
      onRevoked(secret)
    }
  }

  return (
    <section aria-labelledby="history-h">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
        <h2 id="history-h" className="t-eyebrow text-ink">
          Your proof history · this browser only
        </h2>
        {entries.length > 0 && (
          <button
            type="button"
            className="t-data-sm uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
            onClick={() => {
              writeHistory([])
              onChange([])
            }}
          >
            Forget all
          </button>
        )}
      </div>
      {message && <p className="t-data-sm mb-3 text-ink-2" role="status">{message}</p>}
      {entries.length === 0 ? (
        <p className="t-data text-ink-3">No proofs made in this browser yet. Proofs from the CLI are listed by `pof-prove history`.</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e) => {
            const isRevoked = e.revokedAt !== undefined || (e.revocationSecret !== undefined && revoked.has(e.revocationSecret))
            const state = isRevoked ? 'revoked' : now > e.expiresAt ? 'expired' : 'live'
            return (
              <li key={e.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="t-data text-ink">
                    {e.claim} · for <span className="font-mono">{e.audience}</span>
                  </p>
                  <p className="t-data-sm text-ink-3">
                    id {e.id} · made {formatStamp(e.createdAt)} · expires {formatDate(e.expiresAt)} · {e.network} anchor, block {e.anchorHeight.toLocaleString('en-US')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip status={state === 'live' ? 'valid' : state === 'expired' ? 'expired' : 'invalid'}>{state}</Chip>
                  <a className="btn btn-sm btn-secondary" href={`/verify#p=${e.proof}&a=${encodeURIComponent(e.audience)}`}>
                    Open
                  </a>
                  {state === 'live' && (
                    <>
                      {!e.revocationSecret && (
                        <input
                          className="field t-data-sm h-[34px] w-44 px-2"
                          placeholder="revocation secret"
                          value={paste[e.id] ?? ''}
                          onChange={(ev) => setPaste({ ...paste, [e.id]: ev.target.value })}
                          aria-label={`Revocation secret for ${e.id}`}
                        />
                      )}
                      <button type="button" className="btn btn-sm border border-invalid text-invalid hover:bg-bone-2" disabled={busy === e.id} onClick={() => void doRevoke(e)}>
                        {busy === e.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <TrustNote label="REVOCATION" className="mt-6">
        Each proof carries a tag, the hash of a secret only you hold. Revoking publishes the secret; verifiers that check the list refuse the proof.
        The list server can drop or delay an entry, but it cannot revoke a proof you did not.
      </TrustNote>
    </section>
  )
}
