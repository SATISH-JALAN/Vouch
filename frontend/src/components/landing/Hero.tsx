'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { D, E, STAGGER, isDesktop, motionOK } from '@/lib/motion'
import { useIntro } from '@/lib/store'
import { scrollToTarget } from '@/lib/lenis'
import { useMagnetic } from '@/components/motion/hooks'
import { HeroMedia } from './HeroMedia'
import { Redact } from '@/components/ui/Redact'

/**
 * The kinetic moment, and the only one on the site. The headline arrives fully redacted;
 * line by line the bars collapse from the right; "nothing else." holds an extra beat,
 * then clears in --seal. Do not reuse this anywhere else.
 */
export function Hero() {
  const root = useRef<HTMLElement>(null)
  const primary = useRef<HTMLAnchorElement>(null)
  const secondary = useRef<HTMLButtonElement>(null)
  const introDone = useIntro((s) => s.introDone)

  useMagnetic(primary)
  useMagnetic(secondary)

  useGSAP(
    () => {
      if (!introDone) return
      const el = root.current!
      const bars = Array.from(el.querySelectorAll<HTMLElement>('h1 [data-reveal]'))
      const last = bars.pop()!
      const after = el.querySelectorAll<HTMLElement>('[data-enter]')

      if (!motionOK() || !isDesktop()) {
        gsap.set([...bars, last], { scaleX: 0 })
        gsap.set(after, { opacity: 1 })
        return
      }

      const lineEnd = (bars.length - 1) * STAGGER.line + D.md
      gsap
        .timeline({ delay: 0.12 })
        .to(bars, { scaleX: 0, transformOrigin: 'right center', duration: D.md, ease: E.big, stagger: STAGGER.line }, 0)
        // the hold: nothing else. stays barred a beat longer than everything else
        .to(last, { scaleX: 0, transformOrigin: 'right center', duration: D.md, ease: E.big }, lineEnd * 0.6 + 0.4)
        .fromTo(after, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: D.sm, ease: E.out, stagger: 0.06 }, lineEnd * 0.6 + 0.25)
    },
    { scope: root, dependencies: [introDone] },
  )

  return (
    <section ref={root} data-band="shielded" className="relative flex min-h-[90vh] flex-col overflow-hidden bg-shielded text-on-dark" aria-labelledby="hero-h">
      <HeroMedia />

      <div className="wrap grid-12 relative flex-1 content-start items-baseline pb-[clamp(56px,7vw,112px)] pt-[clamp(128px,14vw,200px)] md:content-end">
        <div className="col-span-12 lg:col-span-8">
          <h1 id="hero-h" className="t-display-xl t-hero text-on-dark">
            <span className="block">
              <Redact reveal tone="on-dark">Prove what</Redact>
            </span>
            <span className="block">
              <Redact reveal tone="on-dark">you hold.</Redact>
            </span>
            <span className="block">
              <Redact reveal tone="on-dark">Reveal</Redact>{' '}
              <Redact reveal tone="on-dark" className="text-seal">
                nothing else.
              </Redact>
            </span>
          </h1>

          <p data-enter="" className="t-prose mt-10 max-w-[54ch] text-on-dark/80">
            Zcash gives you one disclosure tool: a viewing key that reveals everything you have ever received, permanently. Vouch proves a
            single fact instead.
          </p>

          <div className="mt-11 flex flex-wrap gap-3">
            <Link ref={primary} data-enter="" href="/verify" className="btn btn-on-dark hover:scale-[1.02]" data-cursor="VERIFY">
              Verify a proof
            </Link>
            <button ref={secondary} data-enter="" type="button" className="btn btn-ghost-dark" onClick={() => scrollToTarget('#lender')} data-cursor="OPEN">
              See what a lender learns
            </button>
          </div>

          <p data-enter="" className="t-data-sm mt-10 uppercase tracking-[0.16em] text-on-dark/70">
            Built on <span className="text-on-dark">Zcash</span> · <span className="text-on-dark">Ironwood pool</span> ·{' '}
            <span className="text-on-dark">Solana</span>
          </p>
        </div>
      </div>
    </section>
  )
}
