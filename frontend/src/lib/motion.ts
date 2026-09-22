// Never hand-write a duration.
export const D = { xs: 0.22, sm: 0.38, md: 0.68, lg: 1.05, xl: 1.7 } as const
export const E = {
  out: 'power3.out',
  big: 'expo.out',
  inOut: 'power2.inOut',
  snap: 'back.out(1.6)',
} as const
export const STAGGER = { line: 0.075, row: 0.045, bar: 0.06, card: 0.09 } as const

/** Media queries shared with gsap.matchMedia. */
export const MQ = {
  desktop: '(min-width: 1024px)',
  motion: '(prefers-reduced-motion: no-preference)',
  fine: '(pointer: fine)',
} as const

/**
 * True when entrance animations should run. The `js-ready` class is set by an inline
 * head script only when motion is allowed, so without JS (or with reduced motion)
 * every pre-animation state is simply never applied.
 */
export function motionOK(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('js-ready')
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MQ.desktop).matches
}
