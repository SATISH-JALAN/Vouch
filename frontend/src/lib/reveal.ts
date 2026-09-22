import type { Envelope, Verdict } from './data/types'
import { claimParts, formatDate, formatInt } from './format'

/** What a verifier learns from one proof file, and what it can never learn. */
export function revealRows(env: Envelope, verdict: Verdict) {
  const p = claimParts(env.claim)
  const established = verdict.kind === 'Valid'
  return {
    learn: [
      { label: 'The claim', value: `${p.before} ${p.value}${p.after ? ` ${p.after}` : ''}${established ? '' : ' (not established)'}` },
      { label: 'As of', value: `block ${formatInt(env.anchor.height)}` },
      { label: 'Made for', value: verdict.kind === 'WrongAudience' ? 'someone else' : 'you — the audience hash matches' },
      { label: 'Valid until', value: formatDate(env.expiresAt) },
      { label: 'Revocable', value: 'yes, by the holder, any time before expiry' },
    ],
    never: [
      { label: 'Exact balance', width: 16 },
      { label: 'Which notes', width: 11 },
      { label: 'How many notes', width: 7 },
      { label: 'Any address', width: 22 },
      { label: 'Payment history', width: 14 },
      { label: 'Counterparties', width: 9 },
      { label: 'Future payments', width: 12 },
    ],
  }
}
