// The mark as plain SVG for next/og (Satori): no classes, no CSS variables.

export function OgMark({ size, body, line, state = 'sealed' }: { size: number; body: string; line?: string; state?: 'sealed' | 'disclosed' }) {
  const open = state === 'disclosed'
  const sw = size < 24 ? 1.5 : size > 160 ? 1 : 1.25
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect x="5" y="4" width="22" height="24" rx="1" stroke={body} strokeWidth={sw} />
      <rect x="8.5" y="8" width="15" height="2.4" fill={body} />
      <rect x="8.5" y="12" width="11" height="2.4" fill={body} />
      <rect x="8.5" y="16" width="15" height="2.4" fill={body} />
      {open ? (
        <rect x="8.5" y="20" width="13" height="2.4" fill="none" stroke={line ?? body} strokeWidth="1" />
      ) : (
        <rect x="8.5" y="20" width="13" height="2.4" fill={body} />
      )}
      <rect x="8.5" y="24" width="9" height="2.4" fill={body} />
    </svg>
  )
}

export const OG = {
  shielded: '#0B0D0C',
  onDark: '#EDEAE1',
  onDark2: '#7E847E',
  ruleDark: '#222622',
  seal: '#C8452F',
  bone: '#F3F1EA',
}
