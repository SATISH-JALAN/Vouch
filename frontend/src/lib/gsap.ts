'use client'

// Plugin registration, exactly once, client only.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { useGSAP } from '@gsap/react'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin, ScrambleTextPlugin, useGSAP)
  gsap.defaults({ ease: 'power3.out' })
}

export { gsap, ScrollTrigger, SplitText, DrawSVGPlugin, useGSAP }
