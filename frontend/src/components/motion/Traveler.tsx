'use client'

import { useRef } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { MQ, THROUGH } from '@/lib/motion'
import { SHAPES, currentSlots, onSlotsChange, type Shape, type Slot } from '@/lib/through'

/**
 * The through-line object (MOTION.md §5.5): one seal, fixed above the page, that travels from slot
 * to slot and changes shape, size and colour as the argument changes. Tracking is live: every frame
 * it reads the current rects of the two slots it is between, so late fonts, pins and resizes never
 * leave it behind. Anchors (scroll ranges) are re-read only when ScrollTrigger refreshes.
 * Long transits don't drag it across the sections in between: it leaves, and it arrives.
 * On phones it parks in the right margin while travelling. Under reduced motion it never shows.
 */
export function Traveler() {
  const root = useRef<SVGSVGElement>(null)

  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add(MQ.motion, () => {
      const svg = root.current!
      const path = svg.querySelector<SVGPathElement>('[data-t-path]')!
      const ring = svg.querySelector<SVGCircleElement>('[data-t-ring]')!
      const bars = svg.querySelector<SVGGElement>('[data-t-bars]')!
      const css = getComputedStyle(document.documentElement)
      const COLOR: Record<Shape, string> = { seal: css.getPropertyValue('--color-seal').trim(), doc: css.getPropertyValue('--color-ink').trim() }
      const inOut = gsap.parseEase('power2.inOut')
      const clamp = gsap.utils.clamp(0, 1)
      const phone = window.matchMedia(MQ.mobile)

      type Seat = { slot: Slot; a: number; b: number }
      let seats: Seat[] = []
      let morphs: (gsap.core.Tween | null)[] = []
      let colors: ((v: number) => string)[] = []

      const measure = () => {
        morphs.forEach((m) => m?.kill())
        seats = currentSlots().map((slot) => {
          const [a, b] = slot.range()
          return { slot, a, b: Math.max(a, b) }
        })
        // one paused morph per transit; the tick sets its progress
        morphs = seats.slice(0, -1).map((s, i) => {
          const to = seats[i + 1]!.slot.shape
          return s.slot.shape === to ? null : gsap.fromTo(path, { morphSVG: SHAPES[s.slot.shape] }, { morphSVG: SHAPES[to], paused: true, ease: 'none' })
        })
        colors = seats.slice(0, -1).map((s, i) => gsap.utils.interpolate(COLOR[s.slot.shape], COLOR[seats[i + 1]!.slot.shape]))
        last.key = ''
      }

      const last = { t: '', o: '', key: '', fade: -1 }
      const tick = () => {
        const n = seats.length
        if (!n) {
          if (last.o !== '0') svg.style.opacity = last.o = '0'
          return
        }
        const y = window.scrollY
        const vh = window.innerHeight
        // where are we: seated on k, or travelling from k to k+1 with progress t
        let k = n - 1
        let t = 0
        let seated = true
        let op = 1
        if (y < seats[0]!.a) {
          k = 0
          op = 0
        } else {
          for (let j = 0; j < n; j++) {
            const s = seats[j]!
            if (y <= s.b) {
              if (y >= s.a) k = j
              else {
                k = j - 1
                const from = seats[k]!
                t = (y - from.b) / Math.max(1, s.a - from.b)
                seated = false
                // a long way: leave, and arrive, but don't cross everything in between
                if (s.a - from.b > THROUGH.longTransit * vh) {
                  const f = THROUGH.fade * vh
                  op = Math.max(clamp(1 - (y - from.b) / f), clamp(1 - (s.a - y) / f))
                }
              }
              break
            }
          }
          // past the last slot: seated on it, then gone into the painting
          if (k === n - 1 && seated && y > seats[n - 1]!.b) op = 1 - clamp((y - seats[n - 1]!.b) / (THROUGH.landFade * vh))
        }

        // the first slot hands over from a painted form: the painting fades as the object arrives
        const first = seats[0]!
        const handover = y < first.a ? 0 : y >= first.b ? 1 : (y - first.a) / Math.max(1, first.b - first.a)
        if (first.slot.crossfade && Math.abs(handover - last.fade) > 0.001) {
          last.fade = handover
          first.slot.crossfade(handover)
        }
        if (k === 0 && seated) op = Math.min(op, handover)

        const e = seated ? 0 : inOut(clamp(t))
        const A = seats[k]!.slot.el.getBoundingClientRect()
        const B = seated ? A : seats[k + 1]!.slot.el.getBoundingClientRect()
        let x = A.left + (B.left - A.left) * e
        let top = A.top + (B.top - A.top) * e
        let w = A.width + (B.width - A.width) * e
        if (!seated && phone.matches) {
          // park in the margin mid-flight, so it never sits over text on a narrow screen
          const m = Math.sin(Math.PI * e)
          const size = THROUGH.marginSize
          const mx = window.innerWidth - size - 4
          const my = top + w / 2 - size / 2
          x += (mx - x) * m
          top += (my - top) * m
          w += (size - w) * m
        }

        const tr = `translate3d(${x.toFixed(1)}px,${top.toFixed(1)}px,0) scale(${(w / 100).toFixed(4)})`
        if (tr !== last.t) svg.style.transform = last.t = tr
        const o = clamp(op).toFixed(3)
        if (o !== last.o) svg.style.opacity = last.o = o

        const key = `${k}:${e.toFixed(3)}`
        if (key === last.key) return
        last.key = key
        const shape = seats[k]!.slot.shape
        if (seated || !morphs[k]) path.setAttribute('d', SHAPES[shape])
        else morphs[k]!.progress(e)
        const fill = seated ? COLOR[shape] : colors[k]!(clamp((e - THROUGH.colorHold) / THROUGH.colorSpan))
        path.setAttribute('fill', fill)
        // detail layers belong to their own shape and fade quickly away from it
        const p = k + e
        let barsOp = 0
        let ringOp = 0
        seats.forEach((s, j) => {
          const near = clamp(1 - Math.abs(p - j) * THROUGH.detailFalloff)
          if (s.slot.shape === 'doc') barsOp = Math.max(barsOp, near)
          else ringOp = Math.max(ringOp, near * 0.7)
        })
        bars.setAttribute('opacity', barsOp.toFixed(3))
        ring.setAttribute('opacity', ringOp.toFixed(3))
        ring.setAttribute('stroke-width', (140 / Math.max(w, 1) + 0.6).toFixed(2))
      }

      measure()
      ScrollTrigger.addEventListener('refresh', measure)
      const off = onSlotsChange(measure)
      gsap.ticker.add(tick)
      return () => {
        gsap.ticker.remove(tick)
        ScrollTrigger.removeEventListener('refresh', measure)
        off()
        morphs.forEach((m) => m?.kill())
        seats.forEach((s) => s.slot.crossfade?.(0))
        svg.style.opacity = '0'
      }
    })
    return () => mm.revert()
  })

  return (
    <svg
      ref={root}
      viewBox="0 0 100 100"
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-40 overflow-visible"
      style={{ width: 100, height: 100, transformOrigin: '0 0', opacity: 0, willChange: 'transform, opacity' }}
    >
      <path data-t-path="" d={SHAPES.seal} fill="var(--color-seal)" />
      <circle data-t-ring="" cx="50" cy="50" r="30" fill="none" stroke="var(--color-seal-bg)" strokeWidth="1.4" opacity="0" />
      <g data-t-bars="" fill="var(--color-bone)" opacity="0">
        <rect x="32" y="30" width="34" height="5" />
        <rect x="32" y="41" width="25" height="5" />
        <rect x="32" y="52" width="32" height="5" />
        <rect x="32" y="63" width="29" height="5" />
        <rect x="32" y="74" width="19" height="5" />
      </g>
    </svg>
  )
}
