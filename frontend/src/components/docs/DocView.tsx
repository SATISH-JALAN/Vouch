'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Doc } from '@/lib/docs'
import { scrollToTarget } from '@/lib/lenis'
import { useLineReveal } from '@/components/motion/hooks'
import { cx, Eyebrow, Rule } from '@/components/ui/primitives'

/** Specimen layout: a wide prose column, a sticky contents rail on the right. `docs` is the index, passed in so
 * the client bundle does not carry every other document's body. */
export function DocView({ doc, docs }: { doc: Doc; docs: { slug: string; title: string }[] }) {
  const title = useRef<HTMLHeadingElement>(null)
  const [active, setActive] = useState(doc.sections[0]?.id)
  useLineReveal(title, 'top 95%')

  useEffect(() => {
    const els = doc.sections.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id)
      },
      { rootMargin: '-20% 0px -65% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [doc])

  return (
    <>
      <header className="wrap pb-[clamp(48px,5.5vw,80px)] pt-[clamp(56px,6.667vw,96px)]">
        <div className="section-head">
          <Eyebrow>{doc.eyebrow}</Eyebrow>
          <h1 ref={title} data-line-reveal="" className="t-display-l max-w-[18ch] text-ink">
            {doc.title}
          </h1>
        </div>
        <p className="t-prose mt-8 text-ink-2">{doc.lede}</p>
      </header>
      <Rule />
      <div className="wrap grid-12 pb-[var(--s-end)] pt-[clamp(40px,4.4vw,64px)]">
        <article className="col-span-12 lg:col-span-8">
          {doc.sections.map((s, i) => (
            <section key={s.id} id={s.id} className={cx('scroll-mt-24', i > 0 && 'mt-16 border-t border-rule pt-12')}>
              <p className="t-data-sm text-ink-3">{String(i + 1).padStart(2, '0')}</p>
              <h2 className="t-display-m mt-3 text-ink">{s.title}</h2>
              <div className="t-prose mt-6 space-y-5 text-ink-2 [&_strong]:font-medium [&_strong]:text-ink">{s.body}</div>
            </section>
          ))}
        </article>

        <aside className="col-span-12 row-start-1 mb-12 lg:col-span-3 lg:col-start-10 lg:row-start-auto lg:mb-0">
          <div className="lg:sticky lg:top-28">
            <p className="t-eyebrow text-ink-3">ON THIS PAGE</p>
            <ol className="t-data mt-4 space-y-2 border-l border-border">
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    data-no-transition=""
                    onClick={(e) => {
                      e.preventDefault()
                      scrollToTarget(`#${s.id}`)
                      history.replaceState(null, '', `#${s.id}`)
                    }}
                    className={cx('-ml-px block border-l py-0.5 pl-4 transition-colors duration-200', active === s.id ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink')}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
            <p className="t-eyebrow mt-10 text-ink-3">DOCUMENTS</p>
            <ul className="t-data mt-4 space-y-2">
              {docs.map((d) => (
                <li key={d.slug}>
                  <Link href={`/docs/${d.slug}`} className={cx('link-draw', d.slug === doc.slug ? 'text-ink' : 'text-ink-3 hover:text-ink')} aria-current={d.slug === doc.slug ? 'page' : undefined}>
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  )
}
