import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DOCS, getDoc } from '@/lib/docs'
import { DocView } from '@/components/docs/DocView'

export const dynamicParams = false

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: [d.slug] }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params
  const doc = getDoc(slug.join('/'))
  return doc ? { title: doc.title, description: doc.lede } : {}
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const doc = getDoc(slug.join('/'))
  if (!doc) notFound()
  return <DocView doc={doc} docs={DOCS.map(({ slug, title }) => ({ slug, title }))} />
}
