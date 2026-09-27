'use client'

import { Fragment, useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { MQ, READ } from '@/lib/motion'

type Kind = 'open' | 'never' | 'fact' | 'plain'
interface Token {
  word: string
  kind: Kind
  /** punctuation that follows the word outside its bar */
  tail: string
}

/**
 * Parses the sentence: [[the disclosed fact]] and {{a withheld word}}; everything else is open.
 * Punctuation stays outside the bars, so a withheld noun's comma still reads.
 */
function parse(text: string): Token[] {
  const out: Token[] = []
  const re = /\[\[(.+?)\]\]|\{\{(.+?)\}\}|([^\s[{]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[1]) m[1].split(/\s+/).forEach((w) => out.push({ word: w, kind: 'fact', tail: '' }))
    else if (m[2]) out.push({ word: m[2], kind: 'never', tail: '' })
    else {
      const w = m[3]!
      // a bare punctuation run belongs to the word before it (after a withheld noun, say);
      // a dash is a pause in the sentence, not a word: it never carries a bar
      if (/^[,.;:!?]+$/.test(w) && out.length) out[out.length - 1]!.tail += w
      else out.push({ word: w, kind: /^[—–-]+$/.test(w) ? 'plain' : 'open', tail: '' })
    }
  }
  return out
}

/**
 * The redaction read (MOTION.md §5.4): the product, read as a sentence. Every word starts under an
 * ink bar; scrolling lifts the open words in reading order, at reading pace. The withheld words
 * stay shut for good: their bars never animate, have no hover, and carry no text underneath. Last,
 * after a pause, the fact's bars lift and it turns seal red, underlined. A readout keeps count.
 * Pinned and scrubbed, so it reads backwards too. Without JS or with reduced motion it renders
 * finished: the open words and the fact readable, the withheld ones barred.
 */
export function RedactionRead({ text, className }: { text: string; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const tokens = parse(text)
  const plain = text.replace(/\[\[|\]\]|\{\{|\}\}/g, '')
  const never = tokens.filter((t) => t.kind === 'never').length

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ desktop: `${MQ.desktop} and ${MQ.motion}`, mobile: `${MQ.mobile} and ${MQ.motion}` }, (ctx) => {
        const el = root.current!
        const bar = (w: Element) => w.querySelector('[data-rbar]')!
        const open = gsap.utils.toArray<HTMLElement>('[data-rw="open"]', el)
        const fact = gsap.utils.toArray<HTMLElement>('[data-rw="fact"]', el)
        const readN = el.querySelector<HTMLElement>('[data-read]')!
        const sealN = el.querySelector<HTMLElement>('[data-disclosed]')!
        const seal = getComputedStyle(document.documentElement).getPropertyValue('--color-seal').trim()
        const ink = getComputedStyle(el).color

        gsap.set([...open, ...fact].map(bar), { scaleX: 1 })
        gsap.set(fact.map((w) => w.querySelector('[data-rt]')), { color: ink })
        gsap.set(el.querySelector('[data-ru]'), { scaleX: 0 })
        readN.textContent = '0'
        sealN.textContent = '0'

        const tl = gsap.timeline({ defaults: { ease: 'none' } })
        tl.to(open.map(bar), { scaleX: 0, duration: READ.word, stagger: READ.each, ease: 'power2.inOut' }, 0.2)
        const tEnd = 0.2 + READ.each * (open.length - 1) + READ.word
        const tFact = tEnd + READ.pause
        tl.to(fact.map(bar), { scaleX: 0, duration: 0.8, stagger: 0.07, ease: 'power3.inOut' }, tFact)
          // late and fast: a slow fade into red goes muddy
          .to(fact.map((w) => w.querySelector('[data-rt]')), { color: seal, duration: 0.2, stagger: 0.04 }, tFact + 0.55)
          .to(el.querySelector('[data-ru]'), { scaleX: 1, duration: 0.9, ease: 'power3.out' }, tFact + 0.9)
          .to({}, { duration: 1 })

        const sealAt = tFact + 0.6
        let lastRead = -1
        let lastSeal = -1
        tl.eventCallback('onUpdate', () => {
          const t = tl.time()
          const read = Math.round(gsap.utils.clamp(0, 1, (t - 0.2) / (tEnd - 0.2)) * open.length)
          const sealed = t >= sealAt ? 1 : 0
          if (read !== lastRead) readN.textContent = String((lastRead = read))
          if (sealed !== lastSeal) sealN.textContent = String((lastSeal = sealed))
        })

        gsap.timeline({
          scrollTrigger: {
            trigger: el,
            start: 'top top',
            end: ctx.conditions?.desktop ? READ.pinDesktop : READ.pinMobile,
            pin: true,
            scrub: READ.scrub,
            anticipatePin: 1,
          },
        }).add(tl)
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  // the fact's words travel as one group, so its underline runs under all of them
  type Seg = { fact: false; t: Token } | { fact: true; words: Token[]; tail: string }
  const segs: Seg[] = []
  for (const t of tokens) {
    const last = segs[segs.length - 1]
    if (t.kind === 'fact' && last?.fact) {
      last.words.push(t)
      last.tail = t.tail
    } else if (t.kind === 'fact') segs.push({ fact: true, words: [t], tail: t.tail })
    else segs.push({ fact: false, t })
  }

  return (
    <div ref={root} className={className} data-redaction-read="">
      <p className="sr-only">{plain}</p>
      <p aria-hidden className="rr-text">
        {segs.map((seg, i) => (
          <Fragment key={i}>
            {seg.fact ? (
              <span className="rr-fact">
                {seg.words.map((w, j) => (
                  <Fragment key={j}>
                    {j > 0 && ' '}
                    <Word t={w} />
                  </Fragment>
                ))}
                <span data-ru="" className="rr-u" />
              </span>
            ) : seg.t.kind === 'plain' ? (
              seg.t.word
            ) : (
              <Word t={seg.t} />
            )}
            {seg.fact ? seg.tail : seg.t.tail}
            {i < segs.length - 1 && ' '}
          </Fragment>
        ))}
      </p>
      <p aria-hidden className="rr-readout t-data-sm">
        <span>
          <b data-read="">{tokens.filter((t) => t.kind === 'open').length}</b> words read
        </span>
        <span>
          <b>{never}</b> facts withheld
        </span>
        <span>
          <b data-disclosed="" className="text-seal">
            1
          </b>{' '}
          of 1 disclosed
        </span>
      </p>
    </div>
  )
}

function Word({ t }: { t: Token }) {
  return (
    <span className="rr-w" data-rw={t.kind}>
      <span data-rt="" className="rr-t">
        {t.word}
      </span>
      <span data-rbar="" className="rr-bar" />
    </span>
  )
}
