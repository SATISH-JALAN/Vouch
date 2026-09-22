import type { Claim } from '@/lib/data/types'
import { claimParts, formatInt } from '@/lib/format'
import { cx } from './primitives'

/**
 * A claim as a sentence. Only the disclosed value takes --seal, and only when the fact
 * has actually been established. An unverified claim renders without the seal.
 */
export function ClaimLine({ claim, anchorHeight, disclosed = true, className }: { claim: Claim; anchorHeight?: number; disclosed?: boolean; className?: string }) {
  const p = claimParts(claim)
  return (
    <p className={cx('t-body text-ink', className)}>
      {p.before}{' '}
      <span className={cx('font-mono', disclosed ? 'text-seal' : 'text-ink-2')}>{p.value}</span>
      {p.after && ` ${p.after}`}
      {anchorHeight !== undefined && (
        <>
          {' '}as of block <span className="font-mono">{formatInt(anchorHeight)}</span>
        </>
      )}
      .
    </p>
  )
}
