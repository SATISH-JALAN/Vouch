'use client'

import Lenis from 'lenis'
import { gsap, ScrollTrigger } from './gsap'

let instance: Lenis | null = null
let tick: ((t: number) => void) | null = null

/** One ticker, always: GSAP drives Lenis; Lenis's own rAF is off. */
export function startLenis(): Lenis {
  if (instance) return instance
  instance = new Lenis({ lerp: 0.085, autoRaf: false })
  instance.on('scroll', ScrollTrigger.update)
  tick = (t: number) => instance?.raf(t * 1000)
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)
  return instance
}

export function stopLenis() {
  if (tick) gsap.ticker.remove(tick)
  instance?.destroy()
  instance = null
  tick = null
}

export const getLenis = () => instance

/** Scroll to an element or y, through Lenis when it is running. */
export function scrollToTarget(target: string | HTMLElement | number, immediate = false) {
  if (instance) {
    instance.scrollTo(target, { immediate, offset: typeof target === 'number' ? 0 : -72, duration: 1.2 })
    return
  }
  if (typeof target === 'number') window.scrollTo({ top: target, behavior: immediate ? 'auto' : 'smooth' })
  else {
    const el = typeof target === 'string' ? document.querySelector(target) : target
    el?.scrollIntoView({ behavior: immediate ? 'auto' : 'smooth' })
  }
}
