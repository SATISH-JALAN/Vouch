'use client'

import type { RefObject } from 'react'
import { gsap, SplitText, useGSAP } from '@/lib/gsap'
import { D, E, STAGGER, motionOK } from '@/lib/motion'

/** 12.2 — masked line reveal for headings and prose. */
export function useLineReveal<T extends HTMLElement>(ref: RefObject<T | null>, start = 'top 82%') {
  useGSAP(
    (_ctx, contextSafe) => {
      const el = ref.current
      if (!el) return
      if (!motionOK()) {
        gsap.set(el, { visibility: 'visible' })
        return
      }
      let split: SplitText | null = null
      // fonts can settle after unmount; splitting a detached node would leak its trigger
      let dead = false
      const run = contextSafe!(() => {
        if (dead) return
        split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'line' })
        gsap.set(el, { visibility: 'visible' })
        gsap.from(split.lines, {
          yPercent: 108,
          duration: D.md,
          ease: E.big,
          stagger: STAGGER.line,
          scrollTrigger: { trigger: el, start, once: true },
          onComplete: () => split?.revert(),
        })
      })
      document.fonts.ready.then(run)
      return () => {
        dead = true
        split?.revert()
      }
    },
    { scope: ref },
  )
}

/** Fade-and-rise for [data-enter] children, once. */
export function useEnter<T extends HTMLElement>(
  ref: RefObject<T | null>,
  opts: { start?: string; y?: number; stagger?: number; duration?: number } = {},
) {
  const { start = 'top 82%', y = 20, stagger = STAGGER.card, duration = D.md } = opts
  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      const items = el.querySelectorAll<HTMLElement>('[data-enter]')
      if (!motionOK()) {
        gsap.set(items, { opacity: 1 })
        return
      }
      gsap.fromTo(
        items,
        { opacity: 0, y },
        { opacity: 1, y: 0, duration, ease: E.out, stagger, scrollTrigger: { trigger: el, start, once: true } },
      )
    },
    { scope: ref },
  )
}

/** 12.4 — count up on enter, snapped, tabular. Never below the final decimals. */
export function useCounter<T extends HTMLElement>(ref: RefObject<T | null>, to: number, decimals = 0, start = 'top 80%') {
  useGSAP(
    () => {
      const el = ref.current
      if (!el || !motionOK() || to === 0) return
      const fmt = (n: number) => n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      const state = { n: 0 }
      el.textContent = fmt(0)
      gsap.to(state, {
        n: to,
        duration: D.lg,
        ease: E.out,
        snap: { n: 1 / 10 ** decimals },
        onUpdate: () => {
          el.textContent = fmt(state.n)
        },
        scrollTrigger: { trigger: el, start, once: true },
      })
    },
    { scope: ref },
  )
}

/** 12.7 — the two hero CTAs only. */
export function useMagnetic<T extends HTMLElement>(ref: RefObject<T | null>, strength = 0.3, radius = 110) {
  useGSAP(
    (_ctx, contextSafe) => {
      const el = ref.current
      if (!el || !motionOK() || !window.matchMedia('(pointer: fine) and (min-width: 1024px)').matches) return
      const xTo = gsap.quickTo(el, 'x', { duration: D.sm, ease: E.out })
      const yTo = gsap.quickTo(el, 'y', { duration: D.sm, ease: E.out })
      let pulled = false
      const onMove = contextSafe!((e: PointerEvent) => {
        const r = el.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        const near = Math.abs(dx) < r.width / 2 + radius && Math.abs(dy) < r.height / 2 + radius
        if (near) {
          pulled = true
          xTo(dx * strength)
          yTo(dy * strength)
        } else if (pulled) {
          pulled = false
          gsap.to(el, { x: 0, y: 0, duration: D.lg, ease: 'elastic.out(1, 0.4)' })
        }
      })
      window.addEventListener('pointermove', onMove, { passive: true })
      return () => window.removeEventListener('pointermove', onMove)
    },
    { scope: ref },
  )
}
