// Never hand-write a duration.
export const D = { xs: 0.22, sm: 0.38, md: 0.68, lg: 1.05, xl: 1.7 } as const
export const E = {
  out: 'power3.out',
  big: 'expo.out',
  inOut: 'power2.inOut',
  snap: 'back.out(1.6)',
} as const
export const STAGGER = { line: 0.075, row: 0.045, bar: 0.06, card: 0.09 } as const

/**
 * The motion pass (docs/MOTION.md §4). Eases by job, not by taste:
 * arrivals land, camera moves travel, exits accelerate away, scrubbed timelines stay linear.
 * No elastic or bounce anywhere; `pop` is for sub-10px pops only.
 */
export const EASE = {
  arrive: 'expo.out',
  camera: 'power3.inOut',
  leave: 'power2.in',
  scrub: 'none',
  pop: 'back.out(1.4)',
} as const

/** Micro-interactions (§6). All inside the 0.12–0.38s band. */
export const MICRO = {
  /** press: down fast, released on EASE.arrive over D.sm */
  press: 0.09,
  pressScale: 0.97,
  /** a button's fill flooding in from the pointer, and draining out toward it */
  fill: 0.38,
  /** the label roll: per-character stagger and each character's travel */
  roll: 0.38,
  rollStagger: 0.012,
  /** cursor state changes (grow, shrink, show a ring) */
  cursor: 0.3,
  /** header crossing between grounds */
  ground: 0.3,
} as const

export const CURSOR = {
  /** fraction of the remaining distance covered per 60fps frame; frame-rate corrected in Cursor */
  lerp: 0.18,
  dot: 8,
  /** link state: the dot grows to this and inverts what is under it */
  link: 44,
  /** lens and label states: a thin ring this wide */
  ring: 72,
} as const

export const MAGNET = {
  /** px: the shell never travels further than this */
  max: 6,
  /** the label travels this much further than the shell, so the button has depth */
  labelDepth: 0.4,
  pull: 0.3,
  radius: 110,
} as const

/** The iris handoff (§5.1). Pin lengths are scroll distance past the hero's top. */
export const IRIS = {
  pinDesktop: '+=180%',
  pinMobile: '+=110%',
  scrub: 0.65,
  /** the painting is only 1536px wide: push in no further than this, and end on a larger circle */
  pushMax: 1.8,
  /** the portrait source is softer still on a 2× phone screen: a gentler push and a larger end circle */
  pushMobile: 1.4,
  endMinMobile: 56,
  /** the end circle frames the whole card, not just the wax: this much of the pushed-in card size */
  endFrame: 0.62,
  endMin: 44,
  endMax: 120,
  /** the video hands over to the laid-out still as the pin starts, and back at the top */
  videoFade: 0.3,
} as const

/** Rebuild layout-dependent timelines only on a meaningful resize (§8); ignores address-bar jitter. */
export const RESIZE = { dx: 2, dy: 150 } as const

/** Budgets (§4, §9), checked in QA rather than enforced at runtime. */
export const BUDGET = {
  pinsLanding: 4,
  pinnedViewportsDesktop: 9,
  pinnedViewportsMobile: 5,
  liveTriggers: 40,
} as const

/** Media queries shared with gsap.matchMedia. */
export const MQ = {
  desktop: '(min-width: 1024px)',
  mobile: '(max-width: 1023.98px)',
  motion: '(prefers-reduced-motion: no-preference)',
  fine: '(pointer: fine)',
  /** a mouse, not a stylus or a finger: the custom cursor and hover-driven detail */
  hover: '(hover: hover) and (pointer: fine)',
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
