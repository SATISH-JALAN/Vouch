// Display formatting. Amounts are zatoshi internally; ZEC has exactly 8 decimals.

import type { Claim } from './data/types.ts'

export const ZAT_PER_ZEC = 100_000_000n

/** 50_000_000_000 → "500.00000000". Pass `decimals` to round for prose. */
export function formatZec(zatoshi: number | bigint | string, decimals = 8): string {
  const z = BigInt(zatoshi)
  const neg = z < 0n
  const abs = neg ? -z : z
  const whole = abs / ZAT_PER_ZEC
  const frac = (abs % ZAT_PER_ZEC).toString().padStart(8, '0').slice(0, decimals)
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${w}${decimals > 0 ? '.' + frac : ''}`
}

/** "500", "500.5", "0.00000001" → zatoshi. Returns null on anything malformed or over 8 decimals. */
export function parseZec(input: string): bigint | null {
  const s = input.trim().replace(/,/g, '')
  const m = /^(\d+)(?:\.(\d{0,8}))?$/.exec(s)
  if (!m) return null
  return BigInt(m[1]!) * ZAT_PER_ZEC + BigInt((m[2] ?? '').padEnd(8, '0') || '0')
}

export const formatInt = (n: number | bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Unix seconds → "29 Sep 2026" (UTC). */
export function formatDate(sec: number): string {
  const d = new Date(sec * 1000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Unix seconds → "2026-09-29 00:00 UTC". */
export function formatStamp(sec: number): string {
  const d = new Date(sec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

/** Whole days between two unix-second instants, floored. */
export const daysBetween = (a: number, b: number) => Math.floor(Math.abs(b - a) / 86_400)

export function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`
}

export function truncateMiddle(s: string, head = 5, tail = 4): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`
}

/** The claim as a sentence fragment, split so the disclosed value can be styled on its own. */
export function claimParts(c: Claim): { before: string; value: string; after: string } {
  switch (c.kind) {
    case 'HoldsAtLeast':
      return { before: 'Holds at least', value: `${formatZec(c.zatoshi, 2)} ZEC`, after: '' }
    case 'HoldsExactly':
      return { before: 'Holds exactly', value: `${formatZec(c.zatoshi)} ZEC`, after: '' }
    case 'ReceivedPayment':
      return { before: 'Received', value: `${formatZec(c.zatoshi)} ZEC`, after: `in transaction ${truncateMiddle(c.txid, 6, 6)}` }
    case 'ReceivedAtLeastSince':
      return { before: 'Received at least', value: `${formatZec(c.zatoshi, 2)} ZEC`, after: `since block ${formatInt(c.fromHeight)}` }
  }
}

export const CLAIM_LABEL: Record<Claim['kind'], string> = {
  HoldsAtLeast: 'Holds at least',
  HoldsExactly: 'Holds exactly',
  ReceivedPayment: 'Received a payment',
  ReceivedAtLeastSince: 'Received at least, since',
}
