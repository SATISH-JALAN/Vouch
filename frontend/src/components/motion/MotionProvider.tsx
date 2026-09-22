'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { gsap, ScrollTrigger } from '@/lib/gsap'
import { startLenis, stopLenis, getLenis } from '@/lib/lenis'
import { motionOK } from '@/lib/motion'
import { pageEffects } from '@/lib/effects'

declare global {
  interface Window {
    __vouchReady?: boolean
  }
}

/**
 * Runs before first paint (inline in <head>). Decides, once:
 *  - js-ready: motion is allowed, so pre-animation states may apply
 *  - preload:  first visit to the landing page this session → show the preloader
 * If the app has not hydrated in 4s, both are removed so nothing stays hidden.
 */
export const HEAD_SCRIPT = `(function(){var d=document.documentElement;try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches){d.classList.add('js-ready');if(location.pathname==='/'&&!sessionStorage.getItem('vouch:intro')){d.classList.add('preload')}}}catch(e){}setTimeout(function(){if(!window.__vouchReady){d.classList.remove('js-ready','preload')}},4000)})();`

export function MotionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  useEffect(() => {
    window.__vouchReady = true
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || !motionOK()) {
      // Fully static. Anything that still tweens finishes effectively instantly.
      gsap.globalTimeline.timeScale(100)
      stopLenis()
    } else {
      startLenis()
    }
    // Masks and triggers must measure against the real fonts, not fallback metrics.
    document.fonts?.ready.then(() => ScrollTrigger.refresh())
    return () => stopLenis()
  }, [])

  useEffect(() => {
    getLenis()?.scrollTo(0, { immediate: true, force: true })
    // after the page's own triggers (children's effects run first), so refresh order stays top to bottom
    const kill = motionOK() ? pageEffects() : undefined
    // new route, new layout: recompute trigger positions after paint
    const id = requestAnimationFrame(() => ScrollTrigger.refresh())
    return () => {
      cancelAnimationFrame(id)
      kill?.()
    }
  }, [pathname])

  return <>{children}</>
}
