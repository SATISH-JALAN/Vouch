'use client'

import { truncateMiddle } from '@/lib/format'
import { cx } from './primitives'
import { useCopy } from './useCopy'

/** Mono, middle-truncated, click-to-copy. Flashes --valid for 600ms on copy. */
export function Hash({ value, head = 5, tail = 4, full = false, className, label }: { value: string; head?: number; tail?: number; full?: boolean; className?: string; label?: string }) {
  const { copied, copy } = useCopy()

  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      title={value}
      data-cursor="COPY"
      aria-label={`Copy ${label ?? 'value'} ${value}`}
      className={cx(
        'inline max-w-full cursor-copy break-all text-left font-mono transition-colors duration-200',
        copied ? 'text-valid' : 'text-ink-2 hover:text-ink',
        className,
      )}
    >
      {full ? value : truncateMiddle(value, head, tail)}
      <span className="sr-only" aria-live="polite">
        {copied ? 'copied' : ''}
      </span>
    </button>
  )
}
