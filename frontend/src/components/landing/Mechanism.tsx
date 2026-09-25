'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { MQ } from '@/lib/motion'
import { Mark } from '@/components/brand/Mark'
import { Accent, Rule, SectionHead, TrustNote } from '@/components/ui/primitives'

const STAGES = [
  {
    title: 'Pin a moment',
    img: '/visuals/step-1-pin.webp',
    alt: 'Oil painting: a gloved hand stops a brass chronometer at one moment.',
    body: 'The prover takes a snapshot of the chain at one finalised block. Every proof is “as of” that block, which is what makes it checkable and what makes it expire honestly.',
  },
  {
    title: 'Locate the notes',
    img: '/visuals/step-2-locate.webp',
    alt: 'Oil painting: a clerk on a ladder threads a path through an archive of pigeonholes.',
    body: 'With keys derived from your seed, the prover finds your notes in that snapshot, builds a path from each one to it, and shows each is unspent without revealing it. This ties the claim to real, on-chain money.',
  },
  {
    title: 'Sign without sending',
    img: '/visuals/step-3-sign.webp',
    alt: 'Oil painting: a letter is signed, then placed in a drawer instead of the post.',
    body: 'The prover reads your seed from a local file and signs with the spending key it derives. The seed never leaves your machine. The result is transaction-shaped and is never broadcast.',
  },
  {
    title: 'Produce the proof',
    img: '/visuals/step-4-seal.webp',
    alt: 'Oil painting: a notary presses a brass seal into red wax on a single card.',
    body: 'Claim, audience, expiry and evidence are packed into one file. For a threshold, the amount is proven to clear the bar without being revealed.',
  },
]

/** The Anoma move: one pinned diagram, not four cards. Below 1024px it is a numbered list. */
export function Mechanism() {
  const pin = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(`${MQ.desktop} and ${MQ.motion}`, () => {
        const el = pin.current!
        const stages = gsap.utils.toArray<HTMLElement>('[data-stage]', el)
        const nodes = gsap.utils.toArray<HTMLElement>('[data-node]', el)
        const rail = el.querySelector('[data-rail]')
        gsap.set(stages.slice(1), { opacity: 0.36 })
        gsap.set(nodes.slice(1), { opacity: 0 })

        const tl = gsap.timeline({
          scrollTrigger: { trigger: el, start: 'top top', end: '+=320%', pin: true, scrub: 1, snap: { snapTo: 1 / 3, duration: { min: 0.2, max: 0.6 }, ease: 'power2.inOut' } },
        })
        tl.fromTo(rail, { drawSVG: '0%' }, { drawSVG: '100%', duration: 3, ease: 'none' }, 0)
        for (let i = 1; i < stages.length; i++) {
          tl.to(stages[i - 1]!, { opacity: 0.36, duration: 0.3, ease: 'none' }, i - 0.5)
            .to(stages[i]!, { opacity: 1, duration: 0.3, ease: 'none' }, i - 0.5)
            .to(nodes[i]!, { opacity: 1, duration: 0.3, ease: 'none' }, i - 0.5)
        }
      })
      return () => mm.revert()
    },
    { scope: pin },
  )

  return (
    <section id="mechanism" aria-labelledby="mechanism-h">
      <Rule />
      <div ref={pin} className="lg:flex lg:min-h-screen lg:flex-col lg:justify-center lg:pt-16">
        <div className="wrap pt-[var(--s-top)] lg:py-10">
          <SectionHead eyebrow="FOUR STEPS" title={<span id="mechanism-h">A proof is a transaction that is <Accent>never sent.</Accent></span>} className="[&_h2]:lg:max-w-none" />

          <div className="mt-[var(--s-content)] lg:mt-10">
            {/* the rail: desktop only. The mark sits on each column's left edge, pale until its step arrives. */}
            <div className="relative mb-8 hidden h-[28px] lg:block" aria-hidden>
              <svg className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 overflow-visible" viewBox="0 0 1000 2" preserveAspectRatio="none">
                <line x1="0" y1="1" x2="1000" y2="1" stroke="var(--color-rule)" strokeWidth="1" />
              </svg>
              <svg
                className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 overflow-visible"
                style={{ width: 'calc(75% + 18px)' }}
                viewBox="0 0 1000 2"
                preserveAspectRatio="none"
              >
                <line data-rail="" x1="0" y1="1" x2="1000" y2="1" stroke="var(--color-ink)" strokeWidth="1" />
              </svg>
              <div className="absolute inset-y-0 left-0" style={{ width: 'calc(75% + 18px)' }}>
                {STAGES.map((_, i) => (
                  <span
                    key={i}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-bone px-1.5"
                    style={{ left: `${(i / 3) * 100}%` }}
                  >
                    <span className="relative block">
                      <Mark size={28} tone="decorative" />
                      {/* the inked mark on top, faded up as the step becomes current */}
                      <span data-node="" className="absolute inset-0">
                        <Mark size={28} tone="bone" />
                      </span>
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <ol className="grid gap-y-10 lg:grid-cols-4 lg:gap-x-6">
              {STAGES.map((s, i) => (
                <li key={s.title} data-stage="" className="grid grid-cols-1 gap-x-5 border-t border-border pt-6 md:grid-cols-[220px_1fr] md:gap-x-8 lg:block lg:border-t-0 lg:pt-0">
                  <div data-fade="" className="relative mb-5 w-full min-w-0 max-w-[260px] md:row-span-3 md:mb-0 md:max-w-none lg:mb-5 lg:w-fit lg:max-w-full">
                    <Image src={s.img} alt={s.alt} width={480} height={600} unoptimized className="h-auto w-full lg:h-[clamp(260px,calc(100vh-540px),460px)] lg:w-auto lg:max-w-full lg:object-contain lg:object-left" />
                  </div>
                  <p className="t-data-sm text-ink-3">{String(i + 1).padStart(2, '0')}</p>
                  <h3 className="t-display-m mt-2 text-ink">{s.title}</h3>
                  <p className="t-small mt-3 max-w-[36ch] text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <div className="wrap pb-[var(--s-end)] pt-12 lg:pt-0">
        <TrustNote label="NO BROADCAST">Nothing is broadcast. The prover reads your seed from a local file, builds and signs the transaction on your machine, and discards it. The seed never leaves your machine.</TrustNote>
      </div>
    </section>
  )
}
