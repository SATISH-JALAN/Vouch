'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ClaimKind, ProofRequest } from '@/lib/data/types'
import { cliCommand, decodeRequest, encodeRequest } from '@/lib/request'
import { audienceHash } from '@/lib/data/fixtures'
import { ANCHOR } from '@/lib/data/chain'
import { claimParts, formatInt, formatZec } from '@/lib/format'
import { Chip, cx, Eyebrow, Panel, TrustNote } from '@/components/ui/primitives'
import { RevealTable } from '@/components/ui/RevealTable'
import { Hash } from '@/components/ui/Hash'
import { toZatoshi, useRequest } from './store'

const CLAIMS: { kind: ClaimKind; label: string; hint: string }[] = [
  { kind: 'HoldsAtLeast', label: 'Holds at least', hint: 'Threshold. The balance is never revealed.' },
  { kind: 'HoldsExactly', label: 'Holds exactly', hint: 'Exact holding. The amount is revealed, nothing else.' },
  { kind: 'ReceivedPayment', label: 'Received a payment', hint: 'One payment, by transaction id.' },
  { kind: 'ReceivedAtLeastSince', label: 'Received at least, since', hint: 'Income over a period, as a threshold.' },
]

const EXPIRY = [1, 7, 30]

function useBuilt(): { request: ProofRequest | null; errors: Record<string, string> } {
  const s = useRequest()
  return useMemo(() => {
    const errors: Record<string, string> = {}
    const zat = toZatoshi(s.amount, s.unit)
    if (zat === null) errors.amount = s.unit === 'ZEC' ? 'A number with at most 8 decimals.' : 'A whole number of zatoshi.'
    else if (zat <= 0n) errors.amount = 'Must be greater than zero.'
    else if (zat > 21_000_000n * 100_000_000n) errors.amount = 'More than 21 million ZEC will ever exist.'
    if (!s.audience.trim()) errors.audience = 'Name the one party this proof is for.'
    if (s.claim === 'ReceivedPayment' && !/^[0-9a-f]{64}$/i.test(s.txid.trim())) errors.txid = '64 hex characters.'
    if (s.claim === 'ReceivedAtLeastSince') {
      const h = Number(s.fromHeight)
      if (!Number.isInteger(h) || h < 1 || h > ANCHOR.height) errors.fromHeight = `A block height up to ${formatInt(ANCHOR.height)}.`
    }
    if (Object.keys(errors).length || zat === null) return { request: null, errors }
    const request: ProofRequest = {
      v: 1,
      claim: s.claim,
      zatoshi: zat.toString(),
      audience: s.audience.trim(),
      expiryDays: s.expiryDays,
      ...(s.claim === 'ReceivedPayment' ? { txid: s.txid.trim().toLowerCase() } : {}),
      ...(s.claim === 'ReceivedAtLeastSince' ? { fromHeight: Number(s.fromHeight) } : {}),
    }
    return { request, errors }
  }, [s])
}

function sentence(r: ProofRequest) {
  const zat = Number(r.zatoshi)
  const c =
    r.claim === 'ReceivedPayment'
      ? { kind: r.claim, zatoshi: zat, txid: r.txid ?? '' }
      : r.claim === 'ReceivedAtLeastSince'
        ? { kind: r.claim, zatoshi: zat, fromHeight: r.fromHeight ?? 0 }
        : { kind: r.claim, zatoshi: zat }
  return claimParts(c as Parameters<typeof claimParts>[0])
}

export function RequestBuilder() {
  const s = useRequest()
  const { request, errors } = useBuilt()
  const [incoming, setIncoming] = useState<ProofRequest | null>(null)
  const [origin, setOrigin] = useState('')

  // A request link opens here: load it into the review screen and the form, once.
  useEffect(() => {
    setOrigin(window.location.origin)
    const r = new URLSearchParams(window.location.search).get('r')
    const parsed = r ? decodeRequest(r) : null
    if (parsed) {
      setIncoming(parsed)
      useRequest.getState().load(parsed)
    }
  }, [])

  const encoded = request ? encodeRequest(request) : null
  const link = encoded && origin ? `${origin}/request?r=${encoded}` : null
  const cli = encoded ? cliCommand(encoded) : null
  const isThreshold = s.claim === 'HoldsAtLeast' || s.claim === 'ReceivedAtLeastSince'

  return (
    <div className="space-y-16">
      {incoming && <IncomingReview request={incoming} />}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12">
        {/* the form */}
        <Panel label="Build a request" chip={<Chip>No account</Chip>} bodyClassName="space-y-8 p-5 sm:p-6">
          <fieldset>
            <legend className="t-eyebrow mb-3 text-ink-3">CLAIM</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CLAIMS.map((c) => (
                <label
                  key={c.kind}
                  className={cx(
                    'cursor-pointer rounded-chip border px-4 py-3 transition-colors duration-200 hover:border-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-seal',
                    s.claim === c.kind ? 'border-ink bg-bone-2' : 'border-border',
                  )}
                >
                  <input type="radio" name="claim" value={c.kind} checked={s.claim === c.kind} onChange={() => s.set({ claim: c.kind })} className="sr-only" />
                  <span className="block text-[15px] font-medium">{c.label}</span>
                  <span className="t-small block text-ink-3">{c.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="amount" className="t-eyebrow mb-3 block text-ink-3">
              {isThreshold ? 'THRESHOLD' : 'AMOUNT'}
            </label>
            <div className="flex gap-2">
              <input
                id="amount"
                inputMode="decimal"
                className="field t-data flex-1"
                value={s.amount}
                onChange={(e) => s.set({ amount: e.target.value })}
                aria-invalid={!!errors.amount}
                aria-describedby="amount-help"
              />
              <div role="group" aria-label="Unit" className="flex overflow-hidden rounded-chip border border-border">
                {(['ZEC', 'zat'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => s.setUnit(u)}
                    aria-pressed={s.unit === u}
                    className={cx('t-data-sm px-4 uppercase tracking-[0.1em] transition-colors duration-200', s.unit === u ? 'bg-ink text-bone' : 'text-ink-2 hover:bg-bone-2')}
                  >
                    {u === 'zat' ? 'zatoshi' : 'ZEC'}
                  </button>
                ))}
              </div>
            </div>
            <p id="amount-help" className={cx('t-data-sm mt-2', errors.amount ? 'text-invalid' : 'text-ink-3')}>
              {errors.amount ??
                (() => {
                  const z = toZatoshi(s.amount, s.unit)
                  return z === null ? '' : s.unit === 'ZEC' ? `= ${formatInt(z)} zatoshi` : `= ${formatZec(z)} ZEC`
                })()}
            </p>
          </div>

          {s.claim === 'ReceivedPayment' && (
            <Field id="txid" label="TRANSACTION ID" error={errors.txid} hint="The payment being proven. 64 hex characters.">
              <input id="txid" className="field t-data" value={s.txid} onChange={(e) => s.set({ txid: e.target.value })} spellCheck={false} placeholder="c9f2…" />
            </Field>
          )}
          {s.claim === 'ReceivedAtLeastSince' && (
            <Field id="from" label="SINCE BLOCK" error={errors.fromHeight} hint="Payments received from this height onward count toward the threshold.">
              <input id="from" inputMode="numeric" className="field t-data" value={s.fromHeight} onChange={(e) => s.set({ fromHeight: e.target.value })} placeholder="3,070,000" />
            </Field>
          )}

          <Field id="audience" label="AUDIENCE" error={errors.audience} hint="Your verifier identifier. The proof carries only its hash, never this name.">
            <input id="audience" className="field t-data" value={s.audience} onChange={(e) => s.set({ audience: e.target.value })} spellCheck={false} />
            {s.audience.trim() && (
              <p className="t-data-sm mt-2 text-ink-3">
                blake2b → <Hash value={audienceHash(s.audience)} head={10} tail={8} label="audience hash" />
              </p>
            )}
          </Field>

          <fieldset>
            <legend className="t-eyebrow mb-3 text-ink-3">EXPIRY</legend>
            <div className="flex flex-wrap items-center gap-2">
              {EXPIRY.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={s.expiryDays === d}
                  onClick={() => s.set({ expiryDays: d })}
                  className={cx('btn btn-sm border', s.expiryDays === d ? 'border-ink bg-bone-2' : 'border-border hover:border-ink')}
                >
                  {d === 1 ? '1 day' : `${d} days`}
                </button>
              ))}
              <label className="t-data-sm ml-2 flex items-center gap-2 text-ink-3">
                or
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="field t-data h-[38px] w-20 px-3"
                  value={s.expiryDays}
                  onChange={(e) => s.set({ expiryDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
                  aria-label="Expiry in days"
                />
                days
              </label>
            </div>
            <p className="t-data-sm mt-2 text-ink-3">The proof stops verifying this many days after the holder generates it.</p>
          </fieldset>
        </Panel>

        {/* the output */}
        <div className="space-y-6">
          <Panel label="Send this link" chip={request ? <Chip>Ready</Chip> : <Chip>Incomplete</Chip>} bodyClassName="p-5 sm:p-6">
            {request && link ? (
              <>
                <p className="t-body text-ink">
                  {(() => {
                    const p = sentence(request)
                    return (
                      <>
                        Asks for proof that the holder {p.before.toLowerCase()} <span className="font-mono">{p.value}</span>
                        {p.after && ` ${p.after}`}, for <span className="font-mono">{request.audience}</span>, valid {request.expiryDays}{' '}
                        {request.expiryDays === 1 ? 'day' : 'days'}.
                      </>
                    )
                  })()}
                </p>
                <CopyBlock label="LINK" value={link} />
                <CopyBlock label="OR, FOR THE CLI" value={cli!} />
              </>
            ) : (
              <p className="t-data text-ink-3">Fix the highlighted fields and the link appears here.</p>
            )}
          </Panel>
          <TrustNote label="STATELESS">
            Nothing is stored. The whole request is encoded in the link itself. No server keeps it, there is no account, and closing this tab
            forgets it.
          </TrustNote>
        </div>
      </div>
    </div>
  )
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="t-eyebrow mb-3 block text-ink-3">
        {label}
      </label>
      {children}
      <p className={cx('t-data-sm mt-2', error ? 'text-invalid' : 'text-ink-3')}>{error ?? hint}</p>
    </div>
  )
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <span className="t-eyebrow text-ink-3">{label}</span>
        <button
          type="button"
          className="t-data-sm uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
          data-cursor="COPY"
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 600)
          }}
        >
          <span className={copied ? 'text-valid' : undefined}>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="t-data-sm overflow-x-auto whitespace-pre-wrap break-all rounded-chip border border-border bg-bone-2 p-4 text-ink" data-lenis-prevent="">
        {value}
      </pre>
    </div>
  )
}

/** The holder's side: what opening a request link looks like. This is the review screen. */
function IncomingReview({ request }: { request: ProofRequest }) {
  const p = sentence(request)
  const threshold = request.claim === 'HoldsAtLeast' || request.claim === 'ReceivedAtLeastSince'
  return (
    <section aria-labelledby="incoming-h" className="rounded-panel border border-ink p-5 sm:p-8">
      <Eyebrow>INCOMING PROOF REQUEST · REVIEW BEFORE ANYTHING IS GENERATED</Eyebrow>
      <h2 id="incoming-h" className="t-display-m mt-6 max-w-[30ch] text-ink">
        <span className="font-mono text-[0.72em]">{request.audience}</span> asks you to prove you {p.before.replace(/^Holds/, 'hold').replace(/^Received/, 'received')} {p.value}
        {p.after && ` ${p.after}`}.
      </h2>
      <p className="t-small mt-4 text-ink-2">
        Expires {request.expiryDays} {request.expiryDays === 1 ? 'day' : 'days'} after you generate it. You can revoke it before then.
      </p>
      <RevealTable
        className="mt-8"
        learn={[
          { label: 'The claim', value: `${p.before} ${p.value}${p.after ? ` ${p.after}` : ''}` },
          { label: 'As of', value: 'one finalised block, chosen when you prove' },
          { label: 'Made for', value: request.audience },
          { label: 'Valid for', value: `${request.expiryDays} ${request.expiryDays === 1 ? 'day' : 'days'}` },
        ]}
        never={[
          ...(threshold ? [{ label: 'Exact balance', width: 16 }] : []),
          { label: 'Which notes', width: 11 },
          { label: 'Any address', width: 22 },
          { label: 'Payment history', width: 14 },
          { label: 'Counterparties', width: 9 },
          { label: 'Future payments', width: 12 },
        ]}
      />
      <p className="t-data-sm mt-6 text-ink-3">
        Approve by running the command below on your own machine. Keys never leave it. Nothing is broadcast.
      </p>
    </section>
  )
}
