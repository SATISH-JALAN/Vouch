import type { Preset } from './types.ts'
import { DEMO_AUDIENCE } from './chain.ts'

// Every preset is a real proof written by `pof-prove demo fixtures` (backend) and served from
// /proofs. They verify against the demo anchor: real Ironwood notes and real Halo2 proofs, in a
// published demo tree rather than mainnet's. The page says so wherever a demo anchor is used.

const A = DEMO_AUDIENCE.id

export const PRESETS: Preset[] = [
  { id: 'valid', label: 'A valid proof', note: 'Holds ≥ 500 ZEC, made for the demo pool, valid until 1 Jan 2027.', audience: A, file: 'valid.pof' },
  { id: 'tampered', label: 'A tampered proof', note: 'The same proof with one byte of Halo2 evidence flipped, then re-sealed like a forger would.', audience: A, file: 'tampered.pof' },
  { id: 'expired', label: 'An expired proof', note: 'A real proof whose expiry passed on 22 Sep 2026.', audience: A, file: 'expired.pof' },
  { id: 'revoked', label: 'A revoked proof', note: 'Its holder published the revocation secret. Nothing else about it changed.', audience: A, file: 'revoked.pof' },
  { id: 'wrong-audience', label: 'Made for someone else', note: 'A valid proof addressed to an OTC desk, checked here by the demo pool.', audience: A, file: 'wrong-audience.pof' },
  { id: 'forged-claim', label: 'A forged claim', note: '“500 ZEC” edited to “5,000 ZEC” after proving, then re-sealed.', audience: A, file: 'forged-claim.pof' },
  { id: 'readdressed', label: 'A re-addressed proof', note: 'Someone handed a proof edits the audience to themselves. Checked as that someone.', audience: 'otc-desk:someone-else', file: 'readdressed.pof' },
]

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p])) as Record<string, Preset>
