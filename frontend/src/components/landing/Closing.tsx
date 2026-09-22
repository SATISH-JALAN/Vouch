'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRef } from 'react'
import { useLineReveal } from '@/components/motion/hooks'
import { Accent } from '@/components/ui/primitives'

/** The last screen before the footer: one lit card above the door, a crowd watching it. */
export function Closing() {
  const title = useRef<HTMLHeadingElement>(null)
  useLineReveal(title)

  return (
    <section data-band="shielded" aria-labelledby="closing-h" className="relative isolate overflow-hidden bg-shielded text-on-dark">
      <div data-parallax="7" className="absolute inset-x-0 -inset-y-[9%] -z-10">
      <Image
        src="/visuals/closing.webp"
        alt="Oil painting: at night a crowd faces a glowing pavilion; above its door hangs a single card sealed in red wax, and every other window is curtained."
        fill
        sizes="100vw"
        className="object-cover object-[50%_0%]"
      />
      </div>
      <div className="absolute inset-0 -z-10 bg-shielded/35" aria-hidden />
      <div className="wrap flex min-h-[clamp(620px,50vw,880px)] flex-col items-center justify-between pb-[clamp(48px,5vw,80px)] pt-[clamp(56px,6vw,104px)] text-center">
        <h2 ref={title} id="closing-h" data-line-reveal="" className="t-display-l max-w-[16ch] text-on-dark lg:max-w-none">
          Prove one thing. <Accent>Keep the rest.</Accent>
        </h2>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/verify" className="btn btn-on-dark" data-cursor="VERIFY">
            Verify a proof
          </Link>
          <Link href="/request" className="btn btn-ghost-dark bg-shielded/40" data-cursor="OPEN">
            Request a proof
          </Link>
        </div>
      </div>
    </section>
  )
}
