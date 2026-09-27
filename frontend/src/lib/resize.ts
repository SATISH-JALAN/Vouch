'use client'

import { RESIZE } from './motion'

/**
 * Calls `rebuild` after a meaningful resize only (MOTION.md §8): a width change over RESIZE.dx or a
 * height change over RESIZE.dy. A phone's address bar showing and hiding is not one. Returns the cleanup.
 */
export function onMeaningfulResize(rebuild: () => void, delay = 200): () => void {
  let w = window.innerWidth
  let h = window.innerHeight
  let timer: ReturnType<typeof setTimeout> | undefined
  const onResize = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (Math.abs(window.innerWidth - w) < RESIZE.dx && Math.abs(window.innerHeight - h) < RESIZE.dy) return
      w = window.innerWidth
      h = window.innerHeight
      rebuild()
    }, delay)
  }
  window.addEventListener('resize', onResize)
  return () => {
    clearTimeout(timer)
    window.removeEventListener('resize', onResize)
  }
}
