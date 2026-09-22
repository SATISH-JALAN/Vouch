'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { D, E, STAGGER, isDesktop, motionOK } from '@/lib/motion'
import { ANCHOR } from '@/lib/data/chain'
import { formatInt } from '@/lib/format'
import { fixtureUnifiedAddress } from '@/lib/pof/bytes'
import { truncateMiddle } from '@/lib/format'
import { Redact } from '@/components/ui/Redact'
import { Accent, Chip, Eyebrow, Rule, SectionHead } from '@/components/ui/primitives'
import { useLineReveal } from '@/components/motion/hooks'

// An illustrative holder. The point is the pile-up, not the figures.
const VIEWING_KEY: { label: string; value: string }[] = [
  { label: 'Balance', value: '4,018.20417300 ZEC' },
  { label: 'Every payment received', value: '1,284 notes since March 2021' },
  { label: 'Every amount', value: 'to the zatoshi' },
  { label: 'Every memo', value: '“inv 4471 — thanks, see you Thursday”' },
  { label: 'Every counterparty', value: '312 distinct senders' },
  { label: 'Every address', value: truncateMiddle(fixtureUnifiedAddress('holder-1'), 10, 6) },
  { label: 'Every date', value: 'back to the wallet’s birthday' },
  { label: 'Unrelated income', value: 'salary, OTC fills, gifts' },
  { label: 'Next week’s payments', value: 'visible on arrival' },
  { label: 'Next year’s payments', value: 'still visible' },
  { label: 'Revocation', value: 'impossible — forever' },
]

const WITHHELD: { label: string; width: number }[] = [
  { label: 'Balance', width: 17 },
  { label: 'Payments', width: 12 },
  { label: 'Amounts', width: 8 },
  { label: 'Memos', width: 21 },
  { label: 'Counterparties', width: 10 },
  { label: 'Addresses', width: 19 },
  { label: 'Dates', width: 14 },
  { label: 'Other income', width: 11 },
  { label: 'Future payments', width: 9 },
  { label: 'History', width: 15 },
]

export function SideBySide({ hasImage = false }: { hasImage?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  useLineReveal(title)

  useGSAP(
    () => {
      const el = root.current!
      const rows = el.querySelectorAll<HTMLElement>('[data-enter]')
      const seal = el.querySelector<HTMLElement>('[data-reveal]')
      if (!motionOK()) return
      if (!isDesktop()) {
        gsap.set(seal, { scaleX: 0 })
        gsap.fromTo(rows, { opacity: 0 }, { opacity: 1, duration: D.sm, stagger: STAGGER.row, scrollTrigger: { trigger: el, start: 'top 78%', once: true } })
        return
      }
      // the asymmetry does the arguing: eleven rows pile in fast, then one line, alone
      gsap
        .timeline({ scrollTrigger: { trigger: el, start: 'top 78%', once: true } })
        .fromTo(rows, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: D.sm, ease: E.out, stagger: STAGGER.row })
        .to(seal, { scaleX: 0, transformOrigin: 'right center', duration: D.md, ease: E.big }, '+=0.4')
    },
    { scope: root },
  )

  return (
    <section id="lender" aria-labelledby="lender-h">
      <Rule />
      <div className="wrap section">
        {hasImage ? (
          /* S2, after Colosseum's plates: a dark panel with a mat line outside it, the words on the left,
             and the painting filling the right edge to edge, dissolving away behind them. Only once it exists. */
          <div className="framed relative isolate overflow-hidden rounded-panel bg-shielded text-on-dark">
            <div className="relative grid lg:min-h-[clamp(420px,29vw,540px)] lg:grid-cols-12">
              {/* flush to the panel's top, right and bottom edges; no frame of its own, just a long dissolve */}
              <figure className="relative aspect-[1060/690] lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[60%]">
                <div data-unveil="" className="plate-fade absolute inset-0 overflow-hidden">
                  <div data-parallax="4" className="absolute inset-x-0 -inset-y-[6%]">
                    <Image
                      src="/visuals/lender-desk.webp"
                      alt="Oil painting: on a lender's desk, an overstuffed portfolio spills every paper its owner has; beside it lies one small card sealed in red wax, and the lender reaches for the card."
                      fill
                      sizes="(min-width: 1024px) 56vw, 100vw"
                      unoptimized
                      className="object-cover object-[62%_50%]"
                    />
                  </div>
                </div>
              </figure>
              <div className="relative z-10 -mt-4 px-6 pb-12 sm:px-8 lg:col-span-6 lg:mt-0 lg:self-center lg:py-14 lg:pl-12 lg:pr-8 xl:pl-16">
                <Eyebrow dark>SIDE BY SIDE</Eyebrow>
                <h2
                  ref={title}
                  id="lender-h"
                  data-line-reveal=""
                  className="mt-[var(--s-eyebrow)] max-w-[15ch] font-serif text-on-dark"
                  style={{ fontSize: 'clamp(30px, 3.1vw, 54px)', lineHeight: 1.08, letterSpacing: '-0.015em' }}
                >
                  Two ways to answer the <Accent>same question.</Accent>
                </h2>
                <p className="mt-5 max-w-[42ch] text-[16px] leading-[1.65] text-on-dark/70 lg:text-[17px]">
                  A lender asks whether you hold at least 500 ZEC. You can hand over a viewing key and open every payment you have ever
                  received, or you can send one line that answers only that question.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <SectionHead eyebrow="SIDE BY SIDE" title={<span id="lender-h">Two ways to answer the <Accent>same question.</Accent></span>} titleRef={title} lineReveal />
            <p className="t-prose mt-6 text-ink-2">A lender asks: do you hold at least 500 ZEC?</p>
          </div>
        )}

        <div ref={root} className="section-body grid overflow-hidden rounded-panel border border-border lg:grid-cols-2">
          {/* left — the avalanche */}
          <div className="border-b border-border lg:border-b-0 lg:border-r">
            <div className="flex h-[42px] items-center justify-between border-b border-border px-5">
              <span className="t-data-sm uppercase tracking-[0.12em] text-ink-2">Viewing key</span>
              <Chip>11 disclosures</Chip>
            </div>
            <p className="t-title px-5 pt-6 sm:px-8">You share a viewing key.</p>
            <p className="t-data-sm px-5 pb-4 pt-1 text-ink-3 sm:px-8">Everything opens, permanently.</p>
            <dl className="pb-4">
              {VIEWING_KEY.map((r) => (
                <div key={r.label} data-enter="" className="grid grid-cols-[minmax(0,11rem)_1fr] items-baseline gap-4 border-t border-border px-5 py-[9px] sm:px-8">
                  <dt className="t-data-sm uppercase tracking-[0.1em] text-ink-3">{r.label}</dt>
                  <dd className="t-data min-w-0 truncate text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* right — one line, then permanent redaction */}
          <div>
            <div className="flex h-[42px] items-center justify-between border-b border-border px-5">
              <span className="t-data-sm uppercase tracking-[0.12em] text-ink-2">Vouch proof</span>
              <Chip>1 disclosure</Chip>
            </div>
            <p className="t-title px-5 pt-6 sm:px-8">You send a Vouch proof.</p>
            <p className="t-data-sm px-5 pb-4 pt-1 text-ink-3 sm:px-8">One line opens. The rest never will.</p>
            <div className="border-t border-border px-5 py-[9px] sm:px-8">
              <p className="t-data text-seal">
                <Redact reveal>Holds ≥ 500.00 ZEC at block {formatInt(ANCHOR.height)}</Redact>
              </p>
            </div>
            <dl className="pb-4">
              {WITHHELD.map((r) => (
                <div key={r.label} className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-4 border-t border-border px-5 py-[9px] sm:px-8">
                  <dt className="t-data-sm uppercase tracking-[0.1em] text-ink-3">{r.label}</dt>
                  <dd className="t-data">
                    <Redact width={r.width} label={`${r.label}: withheld`} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <p className="t-data-sm mt-4 text-ink-3">The viewing-key column is an illustrative holder, not a real wallet. The proof column is exactly what a threshold proof carries.</p>
      </div>
    </section>
  )
}
