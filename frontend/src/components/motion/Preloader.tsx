'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { D, E, STAGGER } from '@/lib/motion'
import { useIntro } from '@/lib/store'
import { Logo } from '@/components/brand/Logo'

/**
 * 12.1 — first visit to the landing page only (decided before paint by HEAD_SCRIPT).
 * Frame draws, bars stagger in, counter 0→100, overlay wipes up over the hero. ≤ 2.0s. Skippable.
 */
export function Preloader() {
  const root = useRef<HTMLDivElement>(null)
  const setIntroDone = useIntro((s) => s.setIntroDone)

  useGSAP(
    (_ctx, contextSafe) => {
      const el = root.current!
      const html = document.documentElement
      if (!html.classList.contains('preload')) {
        setIntroDone()
        return
      }

      const finish = () => {
        html.classList.remove('preload')
        try {
          sessionStorage.setItem('vouch:intro', '1')
        } catch {}
      }

      const counter = el.querySelector<HTMLElement>('[data-counter]')!
      const count = { n: 0 }
      const tl = gsap.timeline({ onComplete: finish })
      tl.fromTo(el.querySelector('.v-frame'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.5, ease: E.inOut }, 0)
        .fromTo(el.querySelectorAll('.v-bar, .v-line'), { scaleX: 0 }, { scaleX: 1, duration: D.sm, ease: E.out, stagger: STAGGER.bar }, 0.26)
        .fromTo(el.querySelector('.wordmark'), { opacity: 0 }, { opacity: 1, duration: D.sm, ease: E.out }, 0.5)
        .to(count, { n: 100, duration: 1.1, ease: 'power1.inOut', onUpdate: () => (counter.textContent = String(Math.round(count.n)).padStart(3, '0')) }, 0)
        .add(() => setIntroDone(), 0.98)
        .fromTo(el, { clipPath: 'inset(0 0 0% 0)' }, { clipPath: 'inset(0 0 100% 0)', duration: D.lg * 0.95, ease: E.big }, 1.0)

      const skip = contextSafe!(() => {
        if (tl.time() < 1.0) tl.seek(1.0)
      })
      window.addEventListener('keydown', skip)
      el.addEventListener('click', skip)
      return () => {
        window.removeEventListener('keydown', skip)
        el.removeEventListener('click', skip)
      }
    },
    { scope: root },
  )

  return (
    <div
      ref={root}
      className="preloader fixed inset-0 z-[100] items-center justify-center bg-shielded text-on-dark"
      data-band="shielded"
      aria-hidden="true"
    >
      <Logo variant="stacked" surface="shielded" />
      <span data-counter className="t-data-sm absolute bottom-8 right-[var(--gutter)] text-on-dark-2">
        000
      </span>
      <span className="t-data-sm absolute bottom-8 left-[var(--gutter)] text-on-dark-2">CLICK OR PRESS ANY KEY TO SKIP</span>
    </div>
  )
}
