'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { useEnter, useLineReveal } from '@/components/motion/hooks'
import { Metric } from '@/components/ui/Metric'
import { Accent, SectionHead, Triptych, TriptychCell } from '@/components/ui/primitives'
import { D } from '@/lib/motion'

export function Problem() {
  const title = useRef<HTMLHeadingElement>(null)
  const metrics = useRef<HTMLDivElement>(null)
  useLineReveal(title)
  useEnter(metrics, { start: 'top 80%', y: 12, duration: D.lg })

  return (
    <section id="problem" aria-labelledby="problem-h">
      <div className="wrap section">
        <div className="grid-12 items-start">
          <div className="col-span-12 lg:col-span-7">
            <SectionHead eyebrow="THE ONLY TOOL YOU HAVE" title={<>A viewing key is <Accent>all or nothing.</Accent></>} titleRef={title} lineReveal />
            <div className="section-body space-y-6 text-ink-2">
              <p className="t-prose">
                Zcash hides everything by design. The only disclosure tool it gives you is a viewing key, and a viewing key is all-or-nothing:
                hand one to a lender, an accountant or an OTC desk and they see every payment you have ever received, permanently, including
                the ones that have nothing to do with them.
              </p>
              <p className="t-prose">
                So nobody discloses. And because nobody discloses, more than $1.7 billion of shielded ZEC cannot be borrowed against, pledged,
                underwritten or presented to a counterparty. The money is there. There is no way to show it is there.
              </p>
            </div>
          </div>
          <figure className="col-span-12 mx-auto mt-12 w-full max-w-[440px] lg:col-span-5 lg:col-start-8 lg:mt-0 lg:max-w-none">
            <div data-fade="">
            <Image
              src="/visuals/ledger.webp"
              width={1122}
              height={1402}
              sizes="(min-width: 1024px) 38vw, 440px"
              alt="Oil painting: a bank clerk opens a ledger and an endless ribbon of pages pours onto the floor while onlookers read them."
              className="h-auto w-full"
            />
            </div>
            <figcaption className="t-data-sm relative z-10 -mt-6 text-ink-3 lg:pl-[12%]">A viewing key: every page, to anyone holding it, forever.</figcaption>
          </figure>
        </div>
        <div className="mt-[var(--s-content)]">
          <div ref={metrics}>
            <Triptych>
              <TriptychCell data-enter="">
                <Metric value="$1.7B" count={{ prefix: '$', to: 1.7, decimals: 1, suffix: 'B' }} caption="of ZEC sealed in the shielded pool when Ironwood activated." />
              </TriptychCell>
              <TriptychCell data-enter="">
                <Metric value="0" caption="ways to prove any of it without showing all of it." />
              </TriptychCell>
              <TriptychCell data-enter="">
                <Metric value="1" caption="disclosure tool, and it reveals everything, forever." />
              </TriptychCell>
            </Triptych>
          </div>
        </div>
      </div>
    </section>
  )
}
