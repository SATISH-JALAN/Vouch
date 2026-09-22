'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { source } from '@/lib/data/adapter'
import type { Attestation, CreditLine, GateTransaction, Preset, VerificationResult } from '@/lib/data/types'
import { DEMO_AUDIENCE, DEMO_THRESHOLD_ZAT, INSTRUCTIONS_SYSVAR } from '@/lib/data/chain'
import { formatDate, formatInt, formatZec } from '@/lib/format'
import { Chip, cx, TrustNote } from '@/components/ui/primitives'
import { ClaimLine } from '@/components/ui/ClaimLine'
import { Hash } from '@/components/ui/Hash'
import { Mark } from '@/components/brand/Mark'

type Status = 'idle' | 'done' | 'failed'
type StepId = 'proof' | 'attest' | 'tx' | 'line'

interface State {
  proof?: VerificationResult
  attestation?: Attestation
  tx?: GateTransaction
  line?: CreditLine
  status: Record<StepId, Status>
  error: Partial<Record<StepId, { title: string; body: string }>>
}

const INITIAL: State = { status: { proof: 'idle', attest: 'idle', tx: 'idle', line: 'idle' }, error: {} }
const ORDER: StepId[] = ['proof', 'attest', 'tx', 'line']

export function GateDemo() {
  const [presets, setPresets] = useState<Preset[]>([])
  const [s, setS] = useState<State>(INITIAL)
  const [tamperProof, setTamperProof] = useState(false)
  const [tamperAtt, setTamperAtt] = useState(false)
  const [attestorDown, setAttestorDown] = useState(false)

  useEffect(() => setPresets(source.presets()), [])

  const next = ORDER.find((id) => s.status[id] === 'idle')
  const halted = ORDER.some((id) => s.status[id] === 'failed')
  const proofText = presets.find((p) => p.id === (tamperProof ? 'tampered' : 'valid'))?.encoded ?? ''

  const reset = () => setS(INITIAL)

  async function step(id: StepId, st: State): Promise<State> {
    const done = (patch: Partial<State>): State => ({ ...st, ...patch, status: { ...st.status, [id]: 'done' } })
    const fail = (title: string, body: string): State => ({ ...st, status: { ...st.status, [id]: 'failed' }, error: { ...st.error, [id]: { title, body } } })
    switch (id) {
      case 'proof': {
        const r = await source.verify(proofText, { audience: DEMO_AUDIENCE.id })
        return done({ proof: r })
      }
      case 'attest': {
        const out = await source.attest(proofText, { simulateDown: attestorDown })
        if (out.ok) return done({ attestation: out.attestation })
        return out.reason === 'unreachable' ? fail('Attestor unreachable', out.message) : fail('Attestor refused to sign', out.message)
      }
      case 'tx': {
        const out = await source.submit(st.attestation!, { tamperAttestation: tamperAtt })
        return out.ok ? done({ tx: out.tx }) : fail(`Transaction failed · ${out.failedAt}`, out.message)
      }
      case 'line': {
        const line = await source.openLine(st.tx!)
        return done({ line })
      }
    }
  }

  const runNext = async () => {
    if (!next || halted) return
    setS(await step(next, s))
  }

  const runAll = async () => {
    let st: State = INITIAL
    setS(st)
    for (const id of ORDER) {
      st = await step(id, st)
      setS(st)
      if (st.status[id] === 'failed') break
    }
  }

  const fixture = source.kind === 'fixture'

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-14">
      {/* controls */}
      <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-2">
          <button type="button" className="btn btn-primary w-full" data-cursor="RUN" onClick={runNext} disabled={!presets.length || !next || halted}>
            {halted ? 'Halted · reset to retry' : next ? `Run step ${ORDER.indexOf(next) + 1}` : 'Complete'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-sm btn-secondary" data-cursor="RUN" onClick={runAll} disabled={!presets.length}>
              Run all
            </button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={reset}>
              Reset
            </button>
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="t-eyebrow mb-3 text-ink-3">BREAK SOMETHING</legend>
          <Toggle checked={tamperProof} onChange={(v) => { setTamperProof(v); reset() }} label="Flip one byte of the proof" hint="The attestor verifies, gets ProofInvalid, refuses to sign." />
          <Toggle checked={tamperAtt} onChange={(v) => { setTamperAtt(v); reset() }} label="Flip one byte of the attestation" hint="The Ed25519 instruction fails; pof-gate never runs." />
          <Toggle checked={attestorDown} onChange={(v) => { setAttestorDown(v); reset() }} label="Take the attestor offline" hint="Simulated. The demo says so instead of spinning." />
        </fieldset>

        {fixture && (
          <TrustNote label="FIXTURE">
            Steps 2–4 use committed test artifacts. No attestor was contacted and nothing was sent to Solana. The failures you can trigger here are
            the same failures the real stack produces, at the same layers.
          </TrustNote>
        )}
      </aside>

      {/* the stepper */}
      <ol className="relative">
        <Step n={1} title="The proof" status={s.status.proof} caption="The borrower hands over proof.pof. The ZEC stays where it is.">
          {s.proof?.envelope && (
            <>
              {s.proof.verdict.kind === 'Valid' ? (
                <ClaimLine claim={s.proof.envelope.claim} anchorHeight={s.proof.envelope.anchor.height} />
              ) : (
                <p className="t-body text-ink-2">
                  Claims to hold at least {formatZec(s.proof.envelope.claim.zatoshi, 2)} ZEC. One byte of its evidence has been changed.
                </p>
              )}
              <Artifact
                rows={[
                  ['file', `proof.pof · ${formatInt(s.proof.sizeBytes)} bytes · POF1 v${s.proof.envelope.version}`],
                  ['audience', <Hash key="a" value={s.proof.envelope.audience} head={10} tail={6} label="audience hash" />],
                  ['anchor', `block ${formatInt(s.proof.envelope.anchor.height)}`],
                  ['expires', formatDate(s.proof.envelope.expiresAt)],
                  ['checksum', <Hash key="c" value={s.proof.checksum ?? ''} head={10} tail={6} label="checksum" />],
                ]}
              />
            </>
          )}
        </Step>

        <Step n={2} title="The attestation" status={s.status.attest} error={s.error.attest} caption="pof-attest runs the same verifier and signs the verdict for a chain that cannot read Zcash.">
          <TrustNote label="TRUST-MINIMISED" tone="strong" className="mb-5">
            This is the one step that is not trustless. Solana cannot verify a Zcash proof: wrong curve, and no access to Zcash state. So an
            open-source attestor runs pof-verify and signs the result. The program accepts only keys on its allowlist, anyone can run an
            attestor, and anyone can re-derive the verdict from the proof and public chain data.
          </TrustNote>
          {s.attestation && (
            <Artifact
              rows={[
                ['domain', s.attestation.domain],
                ['subject', <Hash key="s" value={s.attestation.subject} head={10} tail={6} label="subject" />],
                ['claim', `kind ${s.attestation.claimKind} · value ${formatInt(s.attestation.claimValue)} zat`],
                ['anchor_ht', formatInt(s.attestation.anchorHeight)],
                ['verdict', `${s.attestation.verdict} (Valid)`],
                ['slot', formatInt(s.attestation.slot)],
                ['message', <Hash key="m" value={s.attestation.message} head={16} tail={8} label="message" />],
                ['signature', <Hash key="g" value={s.attestation.signature} head={16} tail={8} label="signature" />],
                ['attestor', <Hash key="p" value={s.attestation.attestor} head={8} tail={6} label="attestor key" />],
              ]}
            />
          )}
        </Step>

        <Step n={3} title="The transaction" status={s.status.tx} error={s.error.tx} caption="One transaction, two instructions. pof-gate reads the Instructions sysvar to bind the signature to this attestation.">
          {s.tx && (
            <Artifact
              rows={[
                ...s.tx.instructions.map((ix): [string, ReactNode] => [
                  `ix ${ix.index}`,
                  <span key={ix.index}>
                    {ix.program} · <Hash value={ix.programId} head={8} tail={4} label="program id" /> · {ix.summary}
                  </span>,
                ]),
                ['sysvar', <Hash key="sv" value={INSTRUCTIONS_SYSVAR} head={10} tail={4} label="sysvar" />],
                ['receipt', <Hash key="r" value={s.tx.receipt} head={8} tail={6} label="ClaimReceipt" />],
                ['signature', <Hash key="t" value={s.tx.signature} head={12} tail={8} label="transaction signature" />],
                ['slot', formatInt(s.tx.slot)],
              ]}
            />
          )}
        </Step>

        <Step n={4} title="Credit line opened" status={s.status.line} caption="pof-credit reads the receipt, checks the threshold, marks it consumed, and opens the line." last>
          {s.line && (
            <>
              <p className="t-body text-ink">
                A credit line of <span className="font-mono">{s.line.limit}</span> is open against a proof of at least{' '}
                {formatZec(s.line.requiredZatoshi, 2)} ZEC.
              </p>
              <Artifact
                rows={[
                  ['line', <Hash key="l" value={s.line.account} head={8} tail={6} label="CreditLine account" />],
                  ['pool', <Hash key="p" value={s.line.pool} head={8} tail={6} label="pool account" />],
                  ['limit', s.line.limit],
                  ['drawn', s.line.drawn],
                  ['against', <Hash key="a" value={s.line.openedAgainst} head={8} tail={6} label="receipt" />],
                  ['required', `${formatInt(DEMO_THRESHOLD_ZAT)} zat`],
                ]}
              />
              <p className="t-data-sm mt-5 text-ink-3">
                The ZEC never left Zcash. The pool never learned the balance, the notes, or any address.
              </p>
            </>
          )}
        </Step>
      </ol>
    </div>
  )
}

function Step({ n, title, caption, status, error, last, children }: { n: number; title: string; caption: string; status: Status; error?: { title: string; body: string }; last?: boolean; children?: ReactNode }) {
  return (
    <li className={cx('relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-5 sm:grid-cols-[56px_minmax(0,1fr)] sm:gap-x-8', !last && 'pb-12')}>
      {!last && <span className="absolute bottom-0 left-5 top-12 w-px bg-border sm:left-7" aria-hidden />}
      <div className="flex justify-center pt-1">
        <Mark size={40} state={status === 'done' ? 'disclosed' : status === 'failed' ? 'void' : 'sealed'} tone={status === 'failed' ? 'void' : status === 'idle' ? 'decorative' : 'bone'} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <p className="t-data-sm text-ink-3">{String(n).padStart(2, '0')}</p>
          <h2 className="t-display-m text-ink">{title}</h2>
          {status === 'done' && <Chip>done</Chip>}
          {status === 'failed' && <Chip status="invalid">failed</Chip>}
        </div>
        <p className="t-small mt-2 max-w-[60ch] text-ink-2">{caption}</p>
        <div className="mt-5">
          {children}
          {error && (
            <div role="alert" className="rounded-panel border border-invalid px-5 py-4">
              <p className="t-data font-medium text-invalid">{error.title}</p>
              <p className="t-data-sm mt-2 max-w-[80ch] text-ink-2">{error.body}</p>
            </div>
          )}
          {status === 'idle' && !children && <p className="t-data-sm text-ink-3">Waiting.</p>}
        </div>
      </div>
    </li>
  )
}

function Artifact({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="t-data-sm mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] border-t border-border">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="border-b border-border py-2 uppercase tracking-[0.1em] text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words border-b border-border py-2 text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-chip border border-border p-3 transition-colors duration-200 hover:border-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-seal">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border', checked ? 'border-ink bg-ink' : 'border-border')} aria-hidden>
        {checked && <span className="h-1.5 w-1.5 bg-bone" />}
      </span>
      <span>
        <span className="block text-[14px] font-medium text-ink">{label}</span>
        <span className="t-data-sm block text-ink-3">{hint}</span>
      </span>
    </label>
  )
}
