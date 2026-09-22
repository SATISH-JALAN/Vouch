'use client'

import { useRef } from 'react'
import { useCounter } from '@/components/motion/hooks'

export interface MetricProps {
  /** Rendered as-is without JS. */
  value: string
  /** Optional count-up target, with the non-numeric parts around it. */
  count?: { to: number; decimals?: number; prefix?: string; suffix?: string }
  unit?: string
  caption: string
}

export function Metric({ value, count, unit, caption }: MetricProps) {
  const num = useRef<HTMLSpanElement>(null)
  useCounter(num, count?.to ?? 0, count?.decimals ?? 0)
  return (
    <div>
      <p className="t-numeral text-ink">
        {count ? (
          <>
            {count.prefix}
            <span ref={num}>{count.to.toFixed(count.decimals ?? 0)}</span>
            {count.suffix}
          </>
        ) : (
          value
        )}
        {unit && <span className="t-data-sm ml-2 align-baseline uppercase tracking-[0.12em] text-ink-2">{unit}</span>}
      </p>
      <p className="t-small mt-4 max-w-[30ch] text-ink-3">{caption}</p>
    </div>
  )
}
