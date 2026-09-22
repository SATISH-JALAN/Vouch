'use client'

import { useRef } from 'react'
import type { VerificationResult, Verdict as V } from '@/lib/data/types'
import { gsap, useGSAP } from '@/lib/gsap'
import { D, E, motionOK } from '@/lib/motion'
import { claimParts, daysBetween, formatDate, formatInt, formatStamp, plural } from '@/lib/format'
import { Mark, type MarkState, type MarkTone } from '@/components/brand/Mark'
import { ClaimLine } from './ClaimLine'
import { Chip, cx, type ChipStatus } from './primitives'
import { Hash } from './Hash'

type Tone = 'valid' | 'invalid' | 'expired' | 'neutral'

interface Presentation {
  tone: Tone
  word: string
  code: string
  detail?: string
  mark: { state: MarkState; tone: MarkTone }
}

const BORDER: Record<Tone, string> = {
  valid: 'var(--color-valid)',
  invalid: 'var(--color-invalid)',
  expired: 'var(--color-expired)',
  neutral: 'var(--color-border)',
}

export function present(v: V, now: number): Presentation {
  const invalid = (code: string, detail?: string): Presentation => ({ tone: 'invalid', word: 'Invalid.', code, detail, mark: { state: 'void', tone: 'void' } })
  switch (v.kind) {
    case 'Valid':
      return { tone: 'valid', word: 'Valid.', code: 'PROOF VALID', mark: { state: 'disclosed', tone: 'bone' } }
    case 'Expired': {
      const days = daysBetween(v.at, now)
      return {
        tone: 'expired',
        word: 'Expired.',
        code: days === 0 ? 'EXPIRED TODAY' : `EXPIRED ${plural(days, 'DAY')} AGO`,
        detail: `It stopped verifying at ${formatStamp(v.at)}. Nothing here is permanent.`,
        mark: { state: 'void', tone: 'expired' },
      }
    }
    case 'Revoked':
      return invalid('REVOKED', 'The holder invalidated this proof before its expiry.')
    case 'WrongAudience':
      return invalid('WRONG AUDIENCE', 'This proof names a different verifier. Passing a proof on is visible.')
    case 'AnchorNotFound':
      return invalid('ANCHOR NOT FOUND', 'The tree root it claims does not exist at that block height.')
    case 'ProofInvalid':
      return invalid('PROOF INVALID', v.detail)
    case 'Malformed':
      return invalid('MALFORMED', v.reason)
    case 'Unchecked':
      return { tone: 'neutral', word: 'Not checked.', code: 'NOT VERIFIED HERE', detail: v.reason, mark: { state: 'sealed', tone: 'bone' } }
  }
}

/**
 * The most important surface on the site. Text never animates. Only the mark and the border
 * change state: valid settles, invalid snaps. (12.6)
 */
export function Verdict({ result, audienceId, className }: { result: VerificationResult; audienceId?: string; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const p = present(result.verdict, result.now)
  const env = result.envelope
  const v = result.verdict

  useGSAP(
    () => {
      const el = root.current
      if (!el || !motionOK()) return
      const line = el.querySelector('.v-line')
      const strike = el.querySelector('.v-strike')
      const tl = gsap.timeline()
      if (p.tone === 'valid') {
        tl.fromTo(line, { attr: { 'fill-opacity': 1, 'stroke-opacity': 0 } }, { attr: { 'fill-opacity': 0, 'stroke-opacity': 1 }, duration: D.sm, ease: E.snap })
          .fromTo(el, { borderColor: BORDER.neutral }, { borderColor: BORDER.valid, duration: D.sm, ease: E.out }, '<')
      } else if (p.tone === 'invalid') {
        // abrupt: no ease-out, no bounce
        tl.set(line, { attr: { 'fill-opacity': 0, 'stroke-opacity': 1 } })
          .fromTo(el, { borderColor: BORDER.neutral }, { borderColor: BORDER.invalid, duration: D.xs, ease: 'none' }, '<')
          .to(el, { x: -2, duration: 0.04, yoyo: true, repeat: 3, ease: 'none' }, '<')
          .fromTo(strike, { drawSVG: '0%' }, { drawSVG: '100%', duration: D.xs, ease: 'none' }, '<')
      } else if (p.tone === 'expired') {
        tl.fromTo(line, { attr: { 'fill-opacity': 1, 'stroke-opacity': 0 } }, { attr: { 'fill-opacity': 0, 'stroke-opacity': 1 }, duration: D.sm, ease: E.out })
          .fromTo(el, { borderColor: BORDER.neutral }, { borderColor: BORDER.expired, duration: D.sm, ease: E.out }, '<')
          .fromTo(strike, { drawSVG: '0%' }, { drawSVG: '100%', duration: D.sm, ease: E.out }, '-=0.2')
      }
    },
    { scope: root, dependencies: [result], revertOnUpdate: true },
  )

  const chipStatus: ChipStatus = p.tone
  const fixtureChecks = result.checks.filter((c) => c.fixture && c.status === 'pass').length
  const passed = result.checks.filter((c) => c.status === 'pass').length

  return (
    <div
      ref={root}
      role="status"
      aria-live="polite"
      className={cx('rounded-panel border bg-bone px-5 py-6 sm:px-8 sm:py-8', className)}
      style={{ borderColor: BORDER[p.tone] }}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        <Mark size={56} state={p.mark.state} tone={p.mark.tone} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <p className="t-display-m text-ink">{p.word}</p>
            <Chip status={chipStatus}>{p.code}</Chip>
          </div>

          {v.kind === 'Valid' && env ? (
            <div className="mt-5 space-y-2">
              <ClaimLine claim={v.claim} anchorHeight={v.anchorHeight} />
              <p className="t-data text-ink-2">
                Made for you · valid until {formatDate(env.expiresAt)} · {passed} of 6 checks passed
                {fixtureChecks > 0 && ` · ${fixtureChecks} against committed fixtures`}
              </p>
            </div>
          ) : (
            p.detail && <p className="t-data mt-4 max-w-[72ch] text-ink-2">{p.detail}</p>
          )}

          {env && v.kind !== 'Valid' && (
            <p className="t-data-sm mt-4 text-ink-3">
              It claimed: <ClaimText env={env} /> — not established.
            </p>
          )}

          {env && (
            <dl className="t-data-sm mt-6 grid gap-x-8 gap-y-2 border-t border-border pt-4 text-ink-3 sm:grid-cols-[auto_1fr]">
              <dt>ANCHOR</dt>
              <dd className="text-ink-2">
                block {formatInt(env.anchor.height)} · root <Hash value={env.anchor.root} head={8} tail={6} label="tree root" />
              </dd>
              <dt>AUDIENCE</dt>
              <dd className="text-ink-2">
                <Hash value={env.audience} head={8} tail={6} label="audience hash" />
                {v.kind === 'Valid' && audienceId && <span> · blake2b of “{audienceId}”</span>}
              </dd>
              <dt>FILE</dt>
              <dd className="text-ink-2">
                {formatInt(result.sizeBytes)} bytes · checksum{' '}
                {result.checksum ? <Hash value={result.checksum} head={8} tail={6} label="checksum" /> : '—'} · checked in {result.elapsedMs.toFixed(1)} ms
              </dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}

/** Plain and unsealed: this fact has not been established. */
function ClaimText({ env }: { env: NonNullable<VerificationResult['envelope']> }) {
  const p = claimParts(env.claim)
  return (
    <span className="text-ink-2">
      {p.before.toLowerCase()} {p.value}
      {p.after && ` ${p.after}`}
    </span>
  )
}
