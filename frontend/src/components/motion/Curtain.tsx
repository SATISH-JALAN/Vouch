'use client'

import { useRef } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { CURTAIN, MQ } from '@/lib/motion'

/**
 * The curtain (MOTION.md §5.3): the problem statement, the all-or-nothing reveal Vouch replaces.
 * Two pleated drapes hang across the whole section with a line printed over the seam. As the section
 * rises, the line tears in two with the cloth first, then the drapes gather to the sides, bunching
 * as they go, their inner hems lifting like a tied-back theatre curtain, and they draw off into the
 * margins. Behind them the scene (any [data-curtain-scene] in the section) pushes in slightly.
 * No pin: scrubbed while the section's top travels from CURTAIN.start to CURTAIN.end.
 * Drapes exist only under js-ready (motion allowed): without JS or with reduced motion there is
 * nothing over the section at all. Used once.
 */
export function Curtain({ line }: { line: string }) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MQ.motion, () => {
        const el = root.current!
        const section = el.closest('section') ?? el.parentElement!
        const [L, R] = gsap.utils.toArray<HTMLElement>('[data-drape]', el)
        const [tL, tR] = gsap.utils.toArray<HTMLElement>('[data-seam]', el)
        const scene = gsap.utils.toArray<HTMLElement>('[data-curtain-scene]', section)
        const full = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'
        gsap.set([L, R], { clipPath: full, scaleX: 1, xPercent: 0 })

        const tl = gsap.timeline({ defaults: { ease: 'none' } })
        // the printed line tears first: it must be gone before the heading can be read
        tl.to(tL!, { xPercent: -62, duration: 3, ease: 'power2.in' }, 0)
          .to(tR!, { xPercent: 62, duration: 3, ease: 'power2.in' }, 0)
          .to([tL!, tR!], { opacity: 0, duration: 1.4 }, 1.6)
          // compressing the pleats toward each side edge reads as cloth bunching
          // drawn decisively, the way a curtain is pulled: slow off the seam, then a sweep, so the
          // words behind are half-covered for as short a stretch as possible
          .to(L!, { scaleX: CURTAIN.gathered, duration: 3.4, ease: 'power3.in' }, 0.8)
          .to(R!, { scaleX: CURTAIN.gathered, duration: 3.4, ease: 'power3.in' }, 0.8)
          .to(L!, { clipPath: 'polygon(0% 0%, 100% 0%, 100% 58%, 0% 100%)', duration: 3, ease: 'power2.inOut' }, 1)
          .to(R!, { clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 58%)', duration: 3, ease: 'power2.inOut' }, 1)
          // then off into the margins, so nothing is left hanging over the reading
          .to(L!, { xPercent: -100, duration: 1.2, ease: 'power2.in' }, 4)
          .to(R!, { xPercent: 100, duration: 1.2, ease: 'power2.in' }, 4)
        if (scene.length) tl.fromTo(scene, { scale: CURTAIN.push }, { scale: 1, duration: 7, ease: 'power2.out' }, 0)

        gsap.timeline({ scrollTrigger: { trigger: section, start: CURTAIN.start, end: CURTAIN.end, scrub: CURTAIN.scrub } }).add(tl)
        // layers exist only around the cloth's range (§8), promoted half a screen early so the first
        // frame of movement doesn't also pay for creating them
        const layers = [L!, R!, tL!, tR!, ...scene]
        ScrollTrigger.create({
          trigger: section,
          start: 'top 135%',
          end: CURTAIN.end,
          onToggle: (self) => gsap.set(layers, { willChange: self.isActive ? 'transform, clip-path' : 'auto' }),
        })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <div ref={root} className="curtain pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden>
      <div data-drape="" className="curtain-drape curtain-drape-l" />
      <div data-drape="" className="curtain-drape curtain-drape-r" />
      {/* the line across the seam, twice: each half rides with its own drape */}
      <div data-seam="" className="curtain-seam curtain-seam-l">
        <span className="curtain-line">{line}</span>
      </div>
      <div data-seam="" className="curtain-seam curtain-seam-r">
        <span className="curtain-line">{line}</span>
      </div>
    </div>
  )
}
