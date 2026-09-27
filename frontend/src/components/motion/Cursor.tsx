'use client'

import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { CURSOR, MICRO, MQ, motionOK } from '@/lib/motion'

/**
 * One cursor, one set of states (MOTION.md §6.1). Components never run cursor logic; they declare it:
 *   data-cursor="lens"         a painting worth lingering on: a thin ring, and the painting veiled
 *                              everywhere except under it (the element supplies a .lens-veil child)
 *   data-cursor="seal"         red underneath: no difference blend (it would turn the seal cyan)
 *   data-cursor="none"         hide the dot
 *   data-cursor-label="TOP"    a target with no words of its own: the ring carries a short label
 * Anything else is inferred from the nearest target: a .btn or button runs its own fill, so the dot
 * gets out of the way; a link grows the dot into a disc that inverts the words; seal-accent text
 * drops the blend; a text field keeps the native cursor.
 * Fine pointer only. Off under reduced motion.
 */

type State = 'dot' | 'link' | 'button' | 'lens' | 'label' | 'seal' | 'native'

const TARGETS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-cursor-label], [data-cursor], .btn, button, [role="button"], a, .text-seal'
const TEXT_INPUT = /^(text|search|email|url|tel|password|number|)$/

function classify(t: Element | null): { state: State; el: HTMLElement | null; label: string } {
  const el = t?.closest<HTMLElement>(TARGETS) ?? null
  if (!el) return { state: 'dot', el: null, label: '' }
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return { state: 'native', el, label: '' }
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return TEXT_INPUT.test(type) ? { state: 'native', el, label: '' } : { state: 'button', el, label: '' }
  }
  const label = el.dataset.cursorLabel
  if (label) return { state: 'label', el, label }
  const declared = el.dataset.cursor
  if (declared === 'lens') return { state: 'lens', el, label: '' }
  if (declared === 'seal') return { state: 'seal', el, label: '' }
  if (declared === 'none') return { state: 'native', el, label: '' }
  if (el.classList.contains('btn') || tag === 'BUTTON' || el.getAttribute('role') === 'button') return { state: 'button', el, label: '' }
  if (tag === 'A') return { state: 'link', el, label: '' }
  if (el.classList.contains('text-seal')) return { state: 'seal', el, label: '' }
  return { state: 'dot', el: null, label: '' }
}

export function Cursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)

  useGSAP(() => {
    if (!motionOK() || !window.matchMedia(MQ.hover).matches) return
    const html = document.documentElement
    html.classList.add('has-cursor')
    const d = dot.current!
    const r = ring.current!
    const l = label.current!

    // Drawn state. The ticker is the only writer of transforms; tweens only move these numbers.
    const s = { dot: 0, ring: 0, shown: 0 }
    const target = { x: -100, y: -100 }
    const pos = { x: -100, y: -100 }
    let state: State = 'dot'
    let dark = false
    let lensEl: HTMLElement | null = null
    const last = { dx: '', rx: '', ro: '', lx: '', ly: '' }

    const DOT = CURSOR.dot / CURSOR.link // the dot is the link disc, scaled down
    const size = (st: State) => (st === 'link' ? 1 : st === 'dot' || st === 'seal' ? DOT : 0)

    const setState = (next: State, el: HTMLElement | null, text: string) => {
      if (next === state && el === lensEl) return
      if (lensEl && lensEl !== el) lensEl.classList.remove('is-lens')
      lensEl = next === 'lens' ? el : null
      lensEl?.classList.add('is-lens')
      state = next
      d.dataset.state = r.dataset.state = next
      l.textContent = next === 'label' ? text : ''
      gsap.to(s, { dot: size(next), ring: next === 'lens' || next === 'label' ? 1 : 0, duration: MICRO.cursor, ease: 'expo.out', overwrite: 'auto' })
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') {
        if (s.shown) gsap.to(s, { shown: 0, duration: MICRO.cursor, overwrite: 'auto' })
        return
      }
      target.x = e.clientX
      target.y = e.clientY
      if (!s.shown) {
        pos.x = target.x
        pos.y = target.y
        gsap.to(s, { shown: 1, duration: MICRO.cursor, overwrite: 'auto' })
      }
    }

    // state changes only happen when the pointer crosses onto a new element
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const t = e.target as Element | null
      const c = classify(t)
      setState(c.state, c.el, c.label)
      const isDark = !!t?.closest('[data-band="shielded"]')
      if (isDark !== dark) {
        dark = isDark
        d.dataset.dark = r.dataset.dark = String(isDark)
      }
    }

    const onLeave = () => gsap.to(s, { shown: 0, duration: MICRO.cursor, overwrite: 'auto' })

    const tick = (_t: number, dt: number) => {
      // 0.18 of the way per 60fps frame, whatever the real frame rate
      const k = 1 - Math.pow(1 - CURSOR.lerp, dt / (1000 / 60))
      pos.x += (target.x - pos.x) * k
      pos.y += (target.y - pos.y) * k
      const x = pos.x.toFixed(1)
      const y = pos.y.toFixed(1)
      const dx = `translate3d(${x}px,${y}px,0) translate(-50%,-50%) scale(${(s.dot * s.shown).toFixed(3)})`
      const rx = `translate3d(${x}px,${y}px,0) translate(-50%,-50%) scale(${(0.6 + 0.4 * s.ring).toFixed(3)})`
      if (dx !== last.dx) d.style.transform = last.dx = dx
      const ro = (s.ring * s.shown).toFixed(3)
      if (rx !== last.rx) r.style.transform = last.rx = rx
      if (ro !== last.ro) r.style.opacity = last.ro = ro
      if (lensEl) {
        const b = lensEl.getBoundingClientRect()
        const lx = `${(pos.x - b.left).toFixed(1)}px`
        const ly = `${(pos.y - b.top).toFixed(1)}px`
        if (lx !== last.lx) lensEl.style.setProperty('--lx', (last.lx = lx))
        if (ly !== last.ly) lensEl.style.setProperty('--ly', (last.ly = ly))
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerover', onOver, { passive: true })
    html.addEventListener('pointerleave', onLeave)
    gsap.ticker.add(tick)
    return () => {
      gsap.ticker.remove(tick)
      lensEl?.classList.remove('is-lens')
      html.classList.remove('has-cursor')
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerover', onOver)
      html.removeEventListener('pointerleave', onLeave)
    }
  })

  return (
    <>
      <div
        ref={ring}
        aria-hidden
        className="cursor-ring pointer-events-none fixed left-0 top-0 z-[90] flex items-center justify-center rounded-full border border-ink opacity-0 data-[dark=true]:border-on-dark"
        style={{ width: CURSOR.ring, height: CURSOR.ring, willChange: 'transform, opacity' }}
      >
        {/* under the ring, never inside it: the ring frames the target, and the target stays legible */}
        <span ref={label} className="t-data-sm absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[9px] tracking-[0.12em] text-ink in-data-[dark=true]:text-on-dark" />
      </div>
      <div
        ref={dot}
        aria-hidden
        className="cursor-dot pointer-events-none fixed left-0 top-0 z-[91] rounded-full"
        style={{ width: CURSOR.link, height: CURSOR.link, transform: 'scale(0)', willChange: 'transform' }}
      />
    </>
  )
}
