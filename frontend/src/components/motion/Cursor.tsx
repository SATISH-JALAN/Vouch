'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { D, E, motionOK } from '@/lib/motion'

/**
 * 12.8 — 8px dot + 34px ring on a slower lerp. The ring grows to 60px with a mono label on
 * anything carrying data-cursor. Inverts over shielded bands. Off on touch and reduced motion.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)

  useGSAP(() => {
    if (!motionOK() || !window.matchMedia('(pointer: fine) and (min-width: 1024px)').matches) return
    const html = document.documentElement
    html.classList.add('has-cursor')
    const d = dot.current!
    const r = ring.current!
    const l = label.current!
    gsap.set([d, r], { xPercent: -50, yPercent: -50, opacity: 0 })

    const dx = gsap.quickTo(d, 'x', { duration: 0.08, ease: 'none' })
    const dy = gsap.quickTo(d, 'y', { duration: 0.08, ease: 'none' })
    const rx = gsap.quickTo(r, 'x', { duration: 0.42, ease: E.out })
    const ry = gsap.quickTo(r, 'y', { duration: 0.42, ease: E.out })

    let current = ''
    let dark = false
    let shown = false

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      if (!shown) {
        shown = true
        gsap.set([d, r], { x: e.clientX, y: e.clientY })
        gsap.to([d, r], { opacity: 1, duration: D.xs })
      }
      dx(e.clientX)
      dy(e.clientY)
      rx(e.clientX)
      ry(e.clientY)

      const t = e.target as Element | null
      const want = t?.closest<HTMLElement>('[data-cursor]')?.dataset.cursor ?? ''
      if (want !== current) {
        current = want
        l.textContent = want
        gsap.to(r, { width: want ? 60 : 34, height: want ? 60 : 34, duration: D.xs, ease: E.out })
        gsap.to(l, { opacity: want ? 1 : 0, duration: D.xs })
        gsap.to(d, { scale: want ? 0 : 1, duration: D.xs })
      }
      const isDark = !!t?.closest('[data-band="shielded"]')
      if (isDark !== dark) {
        dark = isDark
        d.dataset.dark = String(isDark)
        r.dataset.dark = String(isDark)
      }
    }
    const onLeave = () => {
      shown = false
      gsap.to([d, r], { opacity: 0, duration: D.xs })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      html.classList.remove('has-cursor')
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  })

  return (
    <>
      <div
        ref={ring}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[90] flex h-[34px] w-[34px] items-center justify-center rounded-full border border-ink opacity-0 data-[dark=true]:border-on-dark"
        style={{ willChange: 'transform' }}
      >
        <span ref={label} className="t-data-sm text-[9px] tracking-[0.12em] text-ink opacity-0 in-data-[dark=true]:text-on-dark" />
      </div>
      <div
        ref={dot}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[91] h-2 w-2 rounded-full bg-ink opacity-0 data-[dark=true]:bg-on-dark"
        style={{ willChange: 'transform' }}
      />
    </>
  )
}
