'use client'

import { useCopy } from './useCopy'

export function CopyBlock({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <span className="t-eyebrow text-ink-3">{label}</span>
        <button type="button" className="t-data-sm uppercase tracking-[0.12em] text-ink-2 hover:text-ink" data-cursor="COPY" onClick={() => void copy(value)}>
          <span className={copied ? 'text-valid' : undefined}>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="t-data-sm overflow-x-auto whitespace-pre-wrap break-all rounded-chip border border-border bg-bone-2 p-4 text-ink" data-lenis-prevent="">
        {value}
      </pre>
    </div>
  )
}
