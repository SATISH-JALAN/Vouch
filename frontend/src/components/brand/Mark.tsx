import type { CSSProperties } from 'react'

// The mark: a redacted document with one line legible (§6).
// Each bar is its own element so the states can animate independently. Animations
// target these class names: .v-frame .v-bar .v-line .v-strike

export type MarkState = 'sealed' | 'disclosed' | 'void' | 'drawing'
export type MarkTone = 'bone' | 'shielded' | 'void' | 'expired' | 'decorative' | 'decorative-dark'

const TONE: Record<MarkTone, { body: string; line: string }> = {
  bone: { body: 'var(--color-ink)', line: 'var(--color-seal)' },
  shielded: { body: 'var(--color-on-dark)', line: 'var(--color-seal)' },
  void: { body: 'var(--color-invalid)', line: 'var(--color-invalid)' },
  expired: { body: 'var(--color-expired)', line: 'var(--color-expired)' },
  decorative: { body: 'var(--color-rule)', line: 'var(--color-rule)' },
  'decorative-dark': { body: 'var(--color-rule-dark)', line: 'var(--color-rule-dark)' },
}

/** Bars above the disclosed line, then the one below it. Lengths vary so it reads as text, not a barcode. */
const BARS = [
  { y: 8, w: 15 },
  { y: 12, w: 11 },
  { y: 16, w: 15 },
  { y: 24, w: 9 },
]

export function frameStroke(size: number) {
  if (size < 24) return 1.5
  if (size > 160) return 1
  return 1.25
}

export interface MarkProps {
  state?: MarkState
  size?: number
  tone?: MarkTone
  className?: string
  style?: CSSProperties
  /** Accessible name. Omit for decorative use. */
  title?: string
}

export function Mark({ state = 'sealed', size = 24, tone = 'bone', className, style, title }: MarkProps) {
  const c = TONE[tone]
  const open = state === 'disclosed' || state === 'void'
  const sw = frameStroke(size)
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      style={{ color: c.body, flex: 'none', overflow: 'visible', ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-state={state}
    >
      <rect className="v-frame" x="5" y="4" width="22" height="24" rx="1" stroke="currentColor" strokeWidth={sw} />
      {BARS.slice(0, 3).map((b) => (
        <rect key={b.y} className="v-bar" x="8.5" y={b.y} width={b.w} height="2.4" fill="currentColor" style={barOrigin} />
      ))}
      {/* the disclosed line — solid in `sealed`, an outline in `disclosed` */}
      <rect
        className="v-line"
        x="8.5"
        y="20"
        width="13"
        height="2.4"
        fill="currentColor"
        fillOpacity={open ? 0 : 1}
        stroke={c.line}
        strokeOpacity={open ? 1 : 0}
        strokeWidth={size < 24 ? 1.25 : 1}
        style={barOrigin}
      />
      <rect className="v-bar" x="8.5" y={BARS[3]!.y} width={BARS[3]!.w} height="2.4" fill="currentColor" style={barOrigin} />
      <path className="v-strike" d="M6 27 L26 5" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" opacity={state === 'void' ? 1 : 0} />
    </svg>
  )
}

const barOrigin: CSSProperties = { transformBox: 'fill-box', transformOrigin: '0% 50%' }
