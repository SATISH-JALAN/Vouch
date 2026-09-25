'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef, useState } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { D, E, motionOK } from '@/lib/motion'
import { NAV } from '@/lib/site'
import { Logo } from '@/components/brand/Logo'
import { cx } from '@/components/ui/primitives'

/**
 * Over the landing hero: transparent, on-dark, 40px below the ticker.
 * After 80vh (or on any other route): a bone bar with a 1px rule beneath.
 */
export function Nav() {
  const pathname = usePathname()
  const landing = pathname === '/'
  const [stuck, setStuck] = useState(false)
  const bar = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      setStuck(false)
      if (!landing) return
      const st = ScrollTrigger.create({
        start: () => window.innerHeight * 0.8,
        end: 'max',
        onToggle: (self) => setStuck(self.isActive),
      })
      return () => st.kill()
    },
    { dependencies: [landing] },
  )

  useGSAP(
    () => {
      if (stuck && landing && motionOK()) gsap.fromTo(bar.current, { yPercent: -100 }, { yPercent: 0, duration: D.sm, ease: E.out })
    },
    { dependencies: [stuck, landing] },
  )

  const dark = landing && !stuck

  return (
    <header
      ref={bar}
      data-band={dark ? 'shielded' : undefined}
      className={cx(
        'inset-x-0 z-50',
        landing && !stuck && 'absolute top-10 text-on-dark',
        landing && stuck && 'fixed top-0 border-b border-rule bg-bone text-ink',
        !landing && 'sticky top-0 border-b border-rule bg-bone text-ink',
      )}
    >
      <nav className="wrap flex h-16 items-center justify-between gap-3 min-[400px]:gap-6" aria-label="Primary">
        <Link href="/" data-nav-mark="" className="-ml-[3px] rounded-chip" aria-label="Vouch — home">
          <span className="hidden md:inline-flex">
            <Logo variant="horizontal" surface={dark ? 'shielded' : 'bone'} />
          </span>
          <span className="inline-flex md:hidden">
            <Logo variant="mark" surface={dark ? 'shielded' : 'bone'} />
          </span>
        </Link>
        {/* five links and the mark must fit 320px: tighter below 400px */}
        <ul className="flex items-center gap-2.5 text-[13px] min-[400px]:gap-4 min-[400px]:text-[14px] sm:gap-7">
          {NAV.map((n) => {
            const current = pathname === n.href || (n.href.startsWith('/docs') && pathname.startsWith('/docs'))
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={current ? 'page' : undefined}
                  className={cx('link-draw pb-0.5', dark ? 'text-on-dark-2 hover:text-on-dark' : 'text-ink-2 hover:text-ink', current && (dark ? 'text-on-dark' : 'text-ink'))}
                >
                  {n.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </header>
  )
}
