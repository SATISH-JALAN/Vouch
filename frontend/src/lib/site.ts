// Site-wide copy constants and links. A dead link is worse than no link:
// anything set to null is not rendered until it has a real URL.

export const BRAND = 'Vouch'

export const TAGLINE = 'Prove what you hold. Reveal nothing else.'

export const DESCRIPTION =
  'Vouch replaces the Zcash viewing key with a proof: one claim, to one named party, with an expiry and a revocation, verifiable against the public chain by anyone.'

export const SUBMISSION = {
  event: "CRYPTO WORLD'S FAIR 2026",
  track: 'ZCASH TRACK',
  date: '12 OCT 2026',
} as const

export const LINKS = {
  /** TODO: set when the repository is public. */
  repo: 'https://github.com/SATISH-JALAN/Vouch' as string | null,
  /** TODO: set when the Zcash forum thread is posted. */
  forum: null as string | null,
  formatSpec: '/docs/format',
  verifier: '/verify',
  zip311: 'https://zips.z.cash/zip-0311',
  votingCircuits: 'https://github.com/valargroup/voting-circuits',
  zcashVoting: 'https://github.com/chainapsis/zcash_voting',
  ironwood: 'https://www.coindesk.com/tech/2026/07/28/zcash-seals-usd1-7-billion-shielded-pool-as-ironwood-upgrade-activates',
} as const

export const NAV = [
  { href: '/verify', label: 'Verify' },
  { href: '/request', label: 'Request' },
  { href: '/prove', label: 'Prove' },
  { href: '/demo', label: 'Demo' },
  { href: '/docs/format', label: 'Docs' },
] as const
