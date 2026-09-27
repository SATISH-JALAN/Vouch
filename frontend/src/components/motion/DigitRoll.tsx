'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { D, EASE, motionOK } from '@/lib/motion'

const DIGITS = '0123456789'

/**
 * A number that matters, rolled like a mechanical counter (MOTION.md §7.7): every digit is a column
 * of 0–9 that rolls to its value, right to left, once, when it enters. Tabular figures, so the
 * columns never shift. It rests on the final value: no JS or reduced motion simply shows it.
 */
export function DigitRoll({ text, start = 'top 82%' }: { text: string; start?: string }) {
  const root = useRef<HTMLSpanElement>(null)

  useGSAP(
    () => {
      const el = root.current
      if (!el || !motionOK()) return
      const strips = gsap.utils.toArray<HTMLElement>('[data-strip]', el).reverse()
      gsap.fromTo(
        strips,
        // the strips rest on their digits with an inline translate: start from a clean zero, or the roll
        // would stack on top of that offset
        { y: 0, yPercent: 0 },
        {
          y: 0,
          yPercent: (_i, s: HTMLElement) => -Number(s.dataset.strip) * 10,
          duration: D.lg,
          ease: EASE.arrive,
          stagger: 0.08,
          scrollTrigger: { trigger: el, start, once: true },
        },
      )
    },
    { scope: root },
  )

  return (
    <span ref={root} className="inline-flex">
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex">
        {Array.from(text).map((ch, i) =>
          DIGITS.includes(ch) ? (
            <span key={i} className="relative inline-block h-[1em] overflow-hidden leading-none">
              <span data-strip={ch} className="flex flex-col" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
                {Array.from(DIGITS).map((d) => (
                  <span key={d} className="block h-[1em] leading-none">
                    {d}
                  </span>
                ))}
              </span>
            </span>
          ) : (
            <span key={i} className="inline-block leading-none">
              {ch}
            </span>
          ),
        )}
      </span>
    </span>
  )
}
