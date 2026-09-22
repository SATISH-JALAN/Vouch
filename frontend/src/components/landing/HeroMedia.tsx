'use client'

import { getImageProps } from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { motionOK } from '@/lib/motion'

const ALT = 'Oil painting: in a gaslit iron-and-glass hall, a notary raises a single card sealed in red wax while a crowd watches. Everything else in the hall is covered.'

type Clip = 'hero' | 'hero-mobile'

/**
 * The painting is the base layer and the LCP: art-directed (portrait below 768px), prioritised.
 * The video loop is added client-side only when motion is allowed and data saver is off,
 * fades in once it is actually playing, and pauses whenever the hero is off-screen.
 */
export function HeroMedia() {
  const [clip, setClip] = useState<Clip | null>(null)
  const [playing, setPlaying] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  const common = { alt: ALT, sizes: '100vw', priority: true, quality: 80 }
  const { props: { srcSet: wide } } = getImageProps({ ...common, src: '/visuals/hero.webp', width: 1536, height: 1024 })
  const { props: portrait } = getImageProps({ ...common, src: '/visuals/hero-mobile.webp', width: 1122, height: 1402 })

  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    if (!motionOK() || saveData) return
    setClip(window.matchMedia('(min-width: 768px)').matches ? 'hero' : 'hero-mobile')
  }, [])

  useEffect(() => {
    const el = video.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => (e?.isIntersecting ? el.play().catch(() => {}) : el.pause()), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [clip])

  return (
    <div className="absolute inset-0 overflow-hidden" data-band="shielded">
      <picture>
        <source media="(min-width: 768px)" srcSet={wide} sizes="100vw" />
        <img {...portrait} alt={ALT} className="h-full w-full object-cover object-[50%_30%] md:object-[50%_40%]" />
      </picture>

      {clip && (
        <video
          ref={video}
          key={clip}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${playing ? 'opacity-100' : 'opacity-0'}`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={`/visuals/${clip}-poster.webp`}
          onPlaying={() => setPlaying(true)}
          aria-hidden
        >
          <source src={`/visuals/${clip}.webm`} type="video/webm" />
          <source src={`/visuals/${clip}.mp4`} type="video/mp4" />
        </video>
      )}

      {/* a flat scrim, not a gradient: the painting's dark side does most of the work */}
      <div className="absolute inset-0 bg-shielded/45 md:bg-shielded/30" aria-hidden />
    </div>
  )
}
