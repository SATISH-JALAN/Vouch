'use client'

import { useRef, useState } from 'react'
import { truncateMiddle } from '@/lib/format'
import { cx } from './primitives'

/** Mono, middle-truncated, click-to-copy. Flashes --valid for 600ms on copy. */
export function Hash({ value, head = 5, tail = 4, full = false, className, label }: { value: string; head?: number; tail?: number; full?: boolean; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 600)
    } catch {
      /* clipboard denied: the value is still selectable via the title */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
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
