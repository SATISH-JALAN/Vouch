'use client'

import { Fragment, useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { motionOK } from '@/lib/motion'
import { ANCHOR, SHIELDED_POOL_USD } from '@/lib/data/chain'
import { formatInt } from '@/lib/format'
import { BRAND } from '@/lib/site'

// The claims counter is 0 because no production proof has been made yet. Keep it honest.
const ITEMS: { label: string; value?: string; valid?: boolean }[] = [
  { label: BRAND.toUpperCase() },
  { label: 'SHIELDED POOL', value: SHIELDED_POOL_USD },
  { label: 'CLAIMS PROVEN', value: '0' },
  { label: 'VIEWING KEYS SURRENDERED', value: '0', valid: true },
  { label: 'IRONWOOD' },
  { label: 'BLOCK', value: formatInt(ANCHOR.height) },
]

function Run() {
  return (
    <span className="flex shrink-0 items-center">
      {Array.from({ length: 3 }).map((_, k) => (
        <Fragment key={k}>
          {ITEMS.map((it) => (
            <span key={it.label} className="flex items-center whitespace-nowrap">
              <span>{it.label}</span>
              {it.value && <span className={`ml-[0.6em] ${it.valid ? 'text-valid' : 'text-on-dark'}`}>{it.value}</span>}
              <span className="mx-[1.4em] text-on-dark-2" aria-hidden>
                ·
              </span>
            </span>
          ))}
        </Fragment>
      ))}
    </span>
  )
}

/** 40px marquee. Two identical runs, translated -50% forever. Never a CSS marquee. */
export function Ticker() {
  const track = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!motionOK()) return
      gsap.to(track.current, { xPercent: -50, ease: 'none', duration: 32, repeat: -1 })
    },
    { scope: track },
  )

  return (
    <div className="relative z-20 h-10 overflow-hidden border-b border-rule-dark bg-shielded" data-band="shielded">
      <p className="sr-only">
        Vouch · shielded pool {SHIELDED_POOL_USD} · claims proven 0 · viewing keys surrendered 0 · Ironwood · block {formatInt(ANCHOR.height)}
      </p>
      <div ref={track} className="t-data-sm flex h-full w-max items-center text-on-dark-2" aria-hidden>
        <Run />
        <Run />
      </div>
    </div>
  )
}
