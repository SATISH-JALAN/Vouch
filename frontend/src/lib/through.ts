'use client'

/**
 * The through-line object (MOTION.md §5.5): one seal that travels the landing page, changing shape
 * as the argument changes. Sections don't know about the object; they register a slot for it:
 * an element to sit on, the scroll range to sit there, and the shape to be while seated.
 * The Traveler reads the registry whenever ScrollTrigger refreshes, and tracks the slots live.
 */

export type Shape = 'seal' | 'doc'

export interface Slot {
  el: HTMLElement
  shape: Shape
  /** the scroll range (px) in which the object sits on this slot; outside it, it travels */
  range: () => [number, number]
  /**
   * The object is seated here as a painting would be: 0 → the painting shows, 1 → the vector object
   * does. Called only for a slot that hands over from a painted form (the iris).
   */
  crossfade?: (v: number) => void
}

const slots = new Map<number, Slot>()
const EVENT = 'vouch:slots'

export function registerSlot(index: number, slot: Slot) {
  slots.set(index, slot)
  window.dispatchEvent(new Event(EVENT))
  return () => {
    if (slots.get(index) === slot) slots.delete(index)
    window.dispatchEvent(new Event(EVENT))
  }
}

export function currentSlots(): Slot[] {
  return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s)
}

export function onSlotsChange(fn: () => void) {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

/** An irregular wax-seal outline, in a 100×100 box. Deterministic, so the root and the object match. */
function blob() {
  const n = 48
  const pts: string[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const r = 44 + 2.4 * Math.sin(7 * a + 0.6) + 1.4 * Math.sin(13 * a + 1.3) + 0.8 * Math.sin(19 * a)
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M${pts.join(' L')} Z`
}

export const SHAPES: Record<Shape, string> = {
  seal: blob(),
  // a page with one corner folded: the document every fact comes out of
  doc: 'M24 6 L64 6 L80 22 L80 94 L24 94 Z',
}
