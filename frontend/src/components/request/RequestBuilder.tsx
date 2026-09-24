'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ClaimKind, ProofRequest } from '@/lib/data/types'
import { cliCommand, demoCliCommand, encodeRequest, newRequestId, PROVABLE, ZAT_PER_UNIT } from '@/lib/request'
import { audienceHash } from '@/lib/pof/hash'
import { claimParts, formatDate, formatInt, formatZec } from '@/lib/format'
import { Chip, cx, Panel, TrustNote } from '@/components/ui/primitives'
import { Hash } from '@/components/ui/Hash'
import { toZatoshi, trimZec, useRequest } from './store'

const CLAIMS: { kind: ClaimKind; label: string; hint: string }[] = [
  { kind: 'HoldsAtLeast', label: 'Holds at least', hint: 'Threshold. The balance is never revealed.' },
  { kind: 'ReceivedPayment', label: 'Received a payment', hint: 'One payment, by transaction id.' },
  { kind: 'ReceivedAtLeastSince', label: 'Received at least, since', hint: 'Income over a period, as a threshold.' },
  { kind: 'HoldsExactly', label: 'Holds exactly', hint: 'An exact amount. Deliberately not offered: thresholds reveal less.' },
]

const EXPIRY = [1, 7, 30]
const RESPOND = [0, 1, 3, 7]
const MAX_ZAT = 21_000_000n * 100_000_000n

function useBuilt(id: string): { request: ProofRequest | null; errors: Record<string, string>; roundUp: bigint | null } {
  const s = useRequest()
  return useMemo(() => {
    const errors: Record<string, string> = {}
    let roundUp: bigint | null = null
    const zat = toZatoshi(s.amount, s.unit)
    if (zat === null) errors.amount = s.unit === 'ZEC' ? 'A number with at most 8 decimals.' : 'A whole number of zatoshi.'
    else if (zat <= 0n) errors.amount = 'Must be greater than zero.'
    else if (zat > MAX_ZAT) errors.amount = 'More than 21 million ZEC will ever exist.'
    else if (zat % ZAT_PER_UNIT !== 0n) {
      roundUp = (zat / ZAT_PER_UNIT + 1n) * ZAT_PER_UNIT
      errors.amount = `Thresholds are proven in 0.125 ZEC steps. The next step up is ${formatZec(roundUp, 3)} ZEC.`
    }
    if (!s.audience.trim()) errors.audience = 'Name the one party this proof is for.'
    if (!PROVABLE.includes(s.claim)) errors.claim = 'Not provable yet.'
    if (Object.keys(errors).length || zat === null) return { request: null, errors, roundUp }
    const request: ProofRequest = {
      v: 1,
      id,
      claim: s.claim,
      zatoshi: zat.toString(),
      audience: s.audience.trim(),
      expiryDays: s.expiryDays,
      ...(s.respondDays ? { respondBy: Math.floor(Date.now() / 86_400_000 + s.respondDays) * 86_400 } : {}),
      ...(s.bindSolana ? { bind: 'solana' as const } : {}),
    }
    return { request, errors, roundUp }
  }, [s, id])
}

export function sentence(r: ProofRequest) {
  return claimParts({ kind: 'HoldsAtLeast', zatoshi: Number(r.zatoshi) })
}

export function RequestBuilder() {
  const s = useRequest()
  const [id, setId] = useState('0000000000000000')
  const [origin, setOrigin] = useState('')
  const { request, errors, roundUp } = useBuilt(id)

  // Old links pointed at /request?r=…; the holder's side now lives at /prove.
  useEffect(() => {
    setOrigin(window.location.origin)
    setId(newRequestId())
    const r = new URLSearchParams(window.location.search).get('r')
    if (r) window.location.replace(`/prove?r=${r}`)
  }, [])

  const encoded = request ? encodeRequest(request) : null
  const link = encoded && origin ? `${origin}/prove?r=${encoded}` : null

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12">
      {/* the form */}
      <Panel label="Build a request" chip={<Chip>No account</Chip>} bodyClassName="space-y-8 p-5 sm:p-6">
        <fieldset>
          <legend className="t-eyebrow mb-3 text-ink-3">CLAIM</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CLAIMS.map((c) => {
              const provable = PROVABLE.includes(c.kind)
              return (
                <label
                  key={c.kind}
                  className={cx(
                    'rounded-chip border px-4 py-3 transition-colors duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-seal',
                    provable ? 'cursor-pointer hover:border-ink' : 'cursor-not-allowed opacity-60',
                    s.claim === c.kind ? 'border-ink bg-bone-2' : 'border-border',
                  )}
                >
                  <input type="radio" name="claim" value={c.kind} checked={s.claim === c.kind} disabled={!provable} onChange={() => s.set({ claim: c.kind })} className="sr-only" />
                  <span className="flex items-center justify-between gap-2">
                    <span className="block text-[15px] font-medium">{c.label}</span>
                    {!provable && <Chip>{c.kind === 'HoldsExactly' ? 'By design' : 'Roadmap'}</Chip>}
                  </span>
                  <span className="t-small block text-ink-3">{c.hint}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div>
          <label htmlFor="amount" className="t-eyebrow mb-3 block text-ink-3">
            THRESHOLD
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
                return z === null ? '' : s.unit === 'ZEC' ? `= ${formatInt(z)} zatoshi · proven in 0.125 ZEC steps` : `= ${formatZec(z)} ZEC`
              })()}
            {roundUp !== null && (
              <button
                type="button"
                className="ml-3 uppercase tracking-[0.12em] text-ink underline underline-offset-4"
                onClick={() => s.set({ amount: s.unit === 'ZEC' ? trimZec(formatZec(roundUp).replace(/,/g, '')) : roundUp.toString() })}
              >
                Round up
              </button>
            )}
          </p>
        </div>

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
                onChange={(e) => s.set({ expiryDays: Math.max(1, Math.min(365, Math.round(Number(e.target.value)) || 1)) })}
                aria-label="Expiry in days"
              />
              days
            </label>
          </div>
          <p className="t-data-sm mt-2 text-ink-3">The proof stops verifying this many days after the holder generates it.</p>
        </fieldset>

        <fieldset>
          <legend className="t-eyebrow mb-3 text-ink-3">RESPOND BY</legend>
          <div className="flex flex-wrap gap-2">
            {RESPOND.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={s.respondDays === d}
                onClick={() => s.set({ respondDays: d })}
                className={cx('btn btn-sm border', s.respondDays === d ? 'border-ink bg-bone-2' : 'border-border hover:border-ink')}
              >
                {d === 0 ? 'No deadline' : d === 1 ? 'Tomorrow' : `${d} days`}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer gap-3 rounded-chip border border-border p-3 transition-colors duration-200 hover:border-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-seal">
          <input type="checkbox" className="sr-only" checked={s.bindSolana} onChange={(e) => s.set({ bindSolana: e.target.checked })} />
          <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border', s.bindSolana ? 'border-ink bg-ink' : 'border-border')} aria-hidden>
            {s.bindSolana && <span className="h-1.5 w-1.5 bg-bone" />}
          </span>
          <span>
            <span className="block text-[14px] font-medium text-ink">Bind to the holder’s Solana account</span>
            <span className="t-data-sm block text-ink-3">For on-chain verifiers. Only that account can use the proof, so a copied proof is worthless.</span>
          </span>
        </label>
      </Panel>

      {/* the output */}
      <div className="space-y-6">
        <Panel label="Send this link" chip={request ? <Chip>Ready</Chip> : <Chip>Incomplete</Chip>} bodyClassName="p-5 sm:p-6">
          {request && link && encoded ? (
            <>
              <p className="t-body text-ink">
                Asks for proof that the holder holds at least <span className="font-mono">{sentence(request).value}</span>, for{' '}
                <span className="font-mono">{request.audience}</span>, valid {request.expiryDays} {request.expiryDays === 1 ? 'day' : 'days'}
                {request.respondBy ? `, answered by ${formatDate(request.respondBy)}` : ''}
                {request.bind ? ', bound to their Solana account' : ''}.
              </p>
              <CopyBlock label="LINK" value={link} />
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn btn-sm btn-secondary" href={link} target="_blank" rel="noreferrer" data-cursor="OPEN">
                  Preview as the holder ↗
                </a>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setId(newRequestId())}>
                  New request id
                </button>
              </div>
              <CopyBlock label="OR, FOR THE CLI" value={cliCommand(encoded, request.bind)} />
              <CopyBlock label="ON THE DEMO LEDGER" value={demoCliCommand(encoded, request.bind)} />
              <p className="t-data-sm mt-4 text-ink-3">Request id {id}. It lets you match the proof you receive to the request you sent.</p>
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

export function CopyBlock({ label, value }: { label: string; value: string }) {
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
