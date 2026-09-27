'use client'

import type { RefObject } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { EASE, IRIS, MQ } from '@/lib/motion'
import { onMeaningfulResize } from '@/lib/resize'
import { HERO_PORTRAIT, HERO_WIDE, HERO_WIDE_MQ } from '@/lib/heroArt'
import { registerSlot } from '@/lib/through'

/**
 * The iris handoff (MOTION.md §5.1). The whole scene narrows to one sealed fact.
 * A pinned, scrubbed stage: the copy lifts away, the painting closes like an aperture onto the wax
 * seal while it pushes in on it (never past IRIS.pushMax: the source is soft beyond that), and the
 * ground behind turns from shielded to paper, so the hero hands over into the page below.
 *
 * Markup, inside the section passed in (whose own background is the ground):
 *   [data-iris]         the frame that is clipped
 *   [data-iris-plate]   the painting's plate, laid out here by hand so the seal's screen position is known
 *   [data-iris-detail]  optional sharper crop on the plate, faded in as it pushes in
 *   [data-iris-video]   the loop; held (faded out, paused) while the still does the work
 *   [data-iris-scrim]   the flat scrim, lifted with the copy
 *   [data-iris-lift]    copy that lifts away first, in DOM order
 *   [data-iris-slot]    placed over the end circle: the through-line object's first slot. As the
 *                       circle closes, the painted circle hands over to the vector seal there
 * The section's data-band follows the ground, so the header and cursor read it as paper once it is.
 * Built only once `ready` (the preloader has handed off). Reduced motion: nothing runs, the hero
 * stays exactly as authored and nothing pins.
 */
export function useIris(ref: RefObject<HTMLElement | null>, ready: boolean) {
  useGSAP(
    () => {
      const section = ref.current
      if (!ready || !section) return
      const mm = gsap.matchMedia()
      mm.add({ desktop: `${MQ.desktop} and ${MQ.motion}`, mobile: `${MQ.mobile} and ${MQ.motion}` }, (mctx) => {
        const desktop = !!mctx.conditions?.desktop
        let stage = build(section, desktop)
        const off = onMeaningfulResize(() => {
          stage.revert()
          stage = build(section, desktop)
          ScrollTrigger.sort()
          ScrollTrigger.refresh()
        })
        ScrollTrigger.sort()
        ScrollTrigger.refresh()
        return () => {
          off()
          stage.revert()
        }
      })
      return () => mm.revert()
    },
    { scope: ref, dependencies: [ready] },
  )
}

const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v))
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

function build(section: HTMLElement, desktop: boolean) {
  return gsap.context(() => {
    const frame = section.querySelector<HTMLElement>('[data-iris]')
    const plate = section.querySelector<HTMLElement>('[data-iris-plate]')
    if (!frame || !plate) return
    const scrim = section.querySelector('[data-iris-scrim]')
    const lifts = gsap.utils.toArray<HTMLElement>('[data-iris-lift]', section)
    const details = section.querySelectorAll('[data-iris-detail]')
    const art = window.matchMedia(HERO_WIDE_MQ).matches ? HERO_WIDE : HERO_PORTRAIT

    // lay the painting out by hand, at exactly the framing object-cover gave it at rest
    const W = frame.clientWidth
    const H = frame.clientHeight
    const s = Math.max(W / art.w, H / art.h)
    const rw = art.w * s
    const rh = art.h * s
    const ox = (W - rw) * art.position[0]
    const oy = (H - rh) * art.position[1]
    const px = art.seal[0] * rw
    const py = art.seal[1] * rh
    gsap.set(plate, { left: ox, top: oy, width: rw, height: rh, right: 'auto', bottom: 'auto', transformOrigin: `${px}px ${py}px` })

    const sx = ox + px
    const sy = oy + py
    const rMax = Math.hypot(Math.max(sx, W - sx), Math.max(sy, H - sy)) + 4
    const z = desktop ? IRIS.pushMax : IRIS.pushMobile
    const rEnd = clamp(desktop ? IRIS.endMin : IRIS.endMinMobile, IRIS.endMax, art.card * s * z * IRIS.endFrame)
    const circle = (r: number) => `circle(${r.toFixed(1)}px at ${sx.toFixed(1)}px ${sy.toFixed(1)}px)`
    const slot = section.querySelector<HTMLElement>('[data-iris-slot]')
    if (slot) gsap.set(slot, { left: sx - rEnd, top: sy - rEnd, width: rEnd * 2, height: rEnd * 2 })

    const tl = gsap.timeline({ defaults: { ease: EASE.scrub } })
    tl.to(lifts, { y: -48, autoAlpha: 0, duration: 0.9, stagger: 0.12, ease: EASE.leave }, 0)
      .to(scrim, { opacity: 0, duration: 1.2 }, 0.2)
      .fromTo(frame, { clipPath: circle(rMax) }, { clipPath: circle(rEnd), duration: 3.6, ease: EASE.camera }, 0.4)
      .fromTo(plate, { scale: 1 }, { scale: z, duration: 3.8, ease: 'power2.inOut' }, 0.4)
      .to(details, { opacity: 1, duration: 1.2 }, 1.6)
      // late, and quick: shielded to paper behind the iris. No hold after it: the pin lets go as the
      // ground lands, so the next section is already rising while the circle carries on
      .fromTo(section, { backgroundColor: token('--color-shielded') }, { backgroundColor: token('--color-bone'), duration: 0.5, ease: 'power2.inOut' }, 3.6)
    const GROUND_AT = 3.85 // the switch's midpoint: from here the section reads as paper
    const HANDOVER = 3.7 // from here to the end, the painted circle becomes the vector seal

    let paper = false
    const setGround = (p: boolean) => {
      if (p === paper) return
      paper = p
      section.dataset.band = p ? 'paper' : 'shielded'
      window.dispatchEvent(new Event('vouch:ground'))
    }
    // the scrubbed playhead lags the scroll, so follow the timeline, not the trigger
    tl.eventCallback('onUpdate', () => setGround(tl.time() >= GROUND_AT))

    // the loop is framed differently from the still: hand over to the still as the pin starts
    const video = () => section.querySelector<HTMLVideoElement>('[data-iris-video]')
    const hold = (on: boolean) => {
      const v = video()
      if (!v) return
      gsap.set(v, { transition: 'none' })
      if (on) {
        v.dataset.held = '1'
        gsap.to(v, { opacity: 0, duration: IRIS.videoFade, ease: 'none', overwrite: true, onComplete: () => v.pause() })
      } else {
        delete v.dataset.held
        void v.play().catch(() => {})
        gsap.to(v, { opacity: 1, duration: IRIS.videoFade, ease: 'none', overwrite: true })
      }
    }

    const st = ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: desktop ? IRIS.pinDesktop : IRIS.pinMobile,
      pin: true,
      scrub: IRIS.scrub,
      anticipatePin: 1,
      animation: tl,
      onEnter: () => hold(true),
      onLeaveBack: () => hold(false),
    })
    // layers only while the stage can be seen (§8): the hero is on screen from the first paint, so they
    // are promoted from the start (creating them as the pin began cost a frame). They are released
    // once the hero has scrolled fully away: dropping them as the pin let go re-rasterised the painting
    // in the same frame as the unpin
    const promote = (on: boolean) => gsap.set([frame, plate], { willChange: on ? 'transform, clip-path' : 'auto' })
    promote(true)
    ScrollTrigger.create({ start: () => st.end + window.innerHeight, onEnter: () => promote(false), onLeaveBack: () => promote(true) })
    // the pin's first frames must not wait on a decode: it is the LCP image, so this is normally a no-op
    void plate.querySelector('img')?.decode().catch(() => {})

    const unslot = slot
      ? registerSlot(0, {
          el: slot,
          shape: 'seal',
          range: () => [st.start + (st.end - st.start) * (HANDOVER / tl.duration()), st.end],
          crossfade: (v) => gsap.set(frame, { opacity: 1 - v }),
        })
      : null

    return () => {
      unslot?.()
      gsap.set(frame, { clearProps: 'opacity' })
      setGround(false)
      const v = video()
      if (v) {
        delete v.dataset.held
        gsap.set(v, { clearProps: 'opacity,transition' })
      }
    }
  }, section)
}
