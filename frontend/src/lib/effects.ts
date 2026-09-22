'use client'

import { gsap, ScrollTrigger, SplitText } from '@/lib/gsap'
import { D, E } from '@/lib/motion'

/**
 * Page-wide motion driven by data attributes, so any section gets it by markup alone:
 *  [data-rule]        full-bleed rules draw in from the left
 *  [data-letters]     eyebrows: letters surface out of a soft blur, one after another
 *  [data-parallax=n]  an oversized image drifts ±n% against the scroll
 *  [data-unveil]      a framed painting is uncovered bottom-up as the image eases out of a slight zoom
 *  [data-fade]        a feather-edged plate rises and settles, with no hard edge to clip
 * Called once per route after the page's own triggers exist; returns the cleanup.
 */
export function pageEffects(): () => void {
  const ctx = gsap.context(() => {
    ScrollTrigger.batch('[data-rule]', {
      start: 'top 96%',
      once: true,
      onEnter: (els) => gsap.to(els, { scaleX: 1, duration: D.xl, ease: E.big, stagger: 0.08 }),
    })

    for (const el of gsap.utils.toArray<HTMLElement>('[data-letters]')) {
      const split = SplitText.create(el, { type: 'chars' })
      gsap.from(split.chars, {
        opacity: 0,
        filter: 'blur(6px)',
        duration: D.lg,
        ease: E.out,
        stagger: 0.028,
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
        onComplete: () => split.revert(),
      })
    }

    for (const el of gsap.utils.toArray<HTMLElement>('[data-parallax]')) {
      const amt = parseFloat(el.dataset.parallax || '8')
      gsap.fromTo(
        el,
        { yPercent: -amt },
        { yPercent: amt, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } },
      )
    }

    for (const el of gsap.utils.toArray<HTMLElement>('[data-unveil]')) {
      const img = el.querySelector('img')
      const tl = gsap.timeline({
        scrollTrigger: { trigger: el, start: 'top 84%', once: true },
        onComplete: () => {
          gsap.set(el, { clipPath: 'none' }) // an explicit value: clearing it would restore the hidden pre-state
          if (img) gsap.set(img, { clearProps: 'transform' }) // hand hover back to CSS
        },
      })
      tl.fromTo(el, { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 1.3, ease: 'power4.out' }, 0)
      if (img) tl.fromTo(img, { scale: 1.18 }, { scale: 1, duration: 1.6, ease: 'power4.out' }, 0)
    }

    ScrollTrigger.batch('[data-fade]', {
      start: 'top 84%',
      once: true,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 26, scale: 1.03 }, { opacity: 1, y: 0, scale: 1, duration: D.xl, ease: E.out, stagger: 0.1 }),
    })
  })

  return () => ctx.revert()
}
