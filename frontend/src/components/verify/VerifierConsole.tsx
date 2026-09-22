'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { source } from '@/lib/data/adapter'
import type { Check, Preset, PresetId, VerificationResult } from '@/lib/data/types'
import { formatInt } from '@/lib/format'
import { revealRows } from '@/lib/reveal'
import { fromBase64Url, toBase64Url } from '@/lib/pof/bytes'
import { MAGIC } from '@/lib/pof/codec'
import { Verdict, present } from '@/components/ui/Verdict'
import { RevealTable } from '@/components/ui/RevealTable'
import { DataTable } from '@/components/ui/DataTable'
import { Chip, cx, Panel } from '@/components/ui/primitives'
import { SourceNote } from './SourceNote'

const PRESET_NOTE: Record<PresetId, string> = {
  valid: 'Holds ≥ 500 ZEC, made for the demo pool, 7-day expiry.',
  tampered: 'The same proof with one byte of evidence flipped, then re-sealed.',
  expired: 'A proof whose expiry passed three days ago.',
}

function isPofBinary(b: Uint8Array) {
  return b.length >= 4 && MAGIC.every((m, i) => b[i] === m)
}

export function VerifierConsole({ variant = 'full' }: { variant?: 'full' | 'landing' }) {
  const [presets, setPresets] = useState<Preset[]>([])
  const [text, setText] = useState('')
  const [audience, setAudience] = useState(source.defaultAudience)
  const [active, setActive] = useState<PresetId | 'custom' | null>(null)
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Vectors depend on today's date, so they are built on the client only.
  useEffect(() => setPresets(source.presets()), [])

  const run = useCallback(
    async (input: string | Uint8Array, which: PresetId | 'custom') => {
      setActive(which)
      setError(null)
      setBusy(true)
      try {
        setResult(await source.verify(input, { audience: audience.trim() }))
      } catch (err) {
        setResult(null)
        setError(`The verifier failed to load: ${(err as Error).message}. Nothing was checked.`)
      } finally {
        setBusy(false)
      }
    },
    [audience],
  )

  const runPreset = (p: Preset) => {
    setText(p.encoded)
    run(p.encoded, p.id)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const buf = new Uint8Array(await file.arrayBuffer())
    if (isPofBinary(buf)) {
      setText(toBase64Url(buf))
      run(buf, 'custom')
    } else {
      const t = new TextDecoder().decode(buf).trim()
      setText(t)
      run(t, 'custom')
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    onFile(e.dataTransfer.files[0])
  }

  const downloadHref = useMemo(() => {
    if (!text || typeof window === 'undefined') return null
    const bytes = fromBase64Url(text)
    return bytes && isPofBinary(bytes) ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' })) : null
  }, [text])
  useEffect(() => () => void (downloadHref && URL.revokeObjectURL(downloadHref)), [downloadHref])

  const full = variant === 'full'
  const verifierName = source.kind === 'wasm' ? 'WASM VERIFIER' : 'FIXTURE VERIFIER'

  return (
    <div className="space-y-6">
      <Panel label="Proof input" chip={<Chip>{verifierName}</Chip>}>
        <div className={cx('grid gap-6 p-5 sm:p-6', full && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]')}>
          {/* dropzone */}
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-cursor="OPEN"
            className={cx(
              'flex min-h-[168px] flex-col items-start justify-between gap-6 rounded-panel border border-dashed p-5 transition-colors duration-200 hover:border-ink hover:bg-bone-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-seal',
              dragging ? 'border-ink bg-bone-2' : 'border-border',
            )}
          >
            <span className="t-eyebrow text-ink-3">DROP A .POF FILE</span>
            <span>
              <span className="t-title block">Drop a proof here, or choose a file.</span>
              <span className="t-small mt-1 block text-ink-2">Binary .pof or base64url text. It is read in this browser and never uploaded.</span>
            </span>
            <input ref={fileInput} type="file" accept=".pof,.txt,application/octet-stream,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>

          {full && (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="t-eyebrow text-ink-3">OR PASTE BASE64URL</span>
                <textarea
                  className="field t-data-sm min-h-[108px] break-all"
                  spellCheck={false}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    setActive('custom')
                  }}
                  placeholder="UE9GMQEA…"
                  aria-describedby="paste-hint"
                />
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex flex-1 flex-col gap-2">
                  <span className="t-eyebrow text-ink-3">VERIFYING AS</span>
                  <input className="field t-data" value={audience} onChange={(e) => setAudience(e.target.value)} spellCheck={false} />
                </label>
                <button type="button" className="btn btn-primary" data-cursor="VERIFY" disabled={!text.trim() || busy} onClick={() => run(text, active === 'custom' || !active ? 'custom' : active)}>
                  Verify
                </button>
              </div>
              <p id="paste-hint" className="t-data-sm text-ink-3">
                Try it: load a preset, change one character, verify again. Change the identifier and it will refuse.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-4 sm:px-6">
          <p className="t-eyebrow mb-3 text-ink-3">OR RUN A TEST VECTOR</p>
          <div className="flex flex-wrap gap-2">
            {(presets.length ? presets : PLACEHOLDER_PRESETS).map((p) => (
              <button
                key={p.id}
                type="button"
                data-cursor="RUN"
                disabled={!presets.length}
                onClick={() => runPreset(p)}
                aria-pressed={active === p.id}
                className={cx(
                  'btn btn-sm border transition-[transform,border-color,background-color] duration-200 hover:-translate-y-px hover:border-ink',
                  active === p.id ? 'border-ink bg-bone-2' : 'border-border',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {active && active !== 'custom' && <p className="t-data-sm mt-3 text-ink-3">{PRESET_NOTE[active]}</p>}
        </div>
      </Panel>

      {error && (
        <div role="alert" className="t-data rounded-panel border border-invalid px-5 py-4 text-invalid">
          {error}
        </div>
      )}

      {result ? (
        <>
          <Verdict result={result} audienceId={audience.trim()} />
          <SourceNote kind={result.source} />
          {full && <ResultDetail result={result} text={text} downloadHref={downloadHref} />}
        </>
      ) : (
        <div className="rounded-panel border border-dashed border-border px-5 py-8 sm:px-8">
          <p className="t-data text-ink-3">{busy ? 'Checking…' : 'No proof checked yet. A verdict appears here: valid, invalid, or expired.'}</p>
        </div>
      )}
    </div>
  )
}

const PLACEHOLDER_PRESETS: Preset[] = [
  { id: 'valid', label: 'A valid proof', encoded: '' },
  { id: 'tampered', label: 'A tampered proof', encoded: '' },
  { id: 'expired', label: 'An expired proof', encoded: '' },
]

function ResultDetail({ result, text, downloadHref }: { result: VerificationResult; text: string; downloadHref: string | null }) {
  const tone = present(result.verdict, result.now).tone
  const failColor = tone === 'expired' ? 'text-expired' : tone === 'invalid' ? 'text-invalid' : 'text-ink'
  const [copied, setCopied] = useState(false)

  return (
    <div className="space-y-12 pt-6">
      <section aria-labelledby="checks-h">
        <h3 id="checks-h" className="t-eyebrow mb-4 text-ink-3">
          THE SIX CHECKS · CHEAPEST FIRST · STOPS AT THE FIRST FAILURE
        </h3>
        <DataTable<Check>
          caption="Verifier checks"
          rowKey={(c) => c.id}
          rows={result.checks}
          columns={[
            { key: 'n', header: '#', className: 'w-10 text-ink-3', cell: (c) => String(result.checks.indexOf(c) + 1).padStart(2, '0') },
            { key: 'label', header: 'Check', className: 'w-[30%] text-ink', cell: (c) => c.label },
            {
              key: 'status',
              header: 'Result',
              className: 'w-32',
              cell: (c) => (
                <span className={cx('inline-flex items-center gap-2 uppercase tracking-[0.06em]', c.status === 'pass' ? 'text-ink' : c.status === 'fail' ? failColor : 'text-ink-3')}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current transition-transform duration-200 group-hover:scale-[1.4]" aria-hidden />
                  {c.status === 'not-run' ? 'not run' : c.status}
                </span>
              ),
            },
            {
              key: 'detail',
              header: 'Detail',
              className: 'text-ink-2',
              cell: (c) => (
                <>
                  {c.detail}
                  {c.fixture && <span className="t-data-sm ml-2 whitespace-nowrap uppercase tracking-[0.1em] text-ink-3">· fixture</span>}
                </>
              ),
            },
          ]}
        />
      </section>

      {result.envelope && (
        <section aria-labelledby="reveal-h">
          <h3 id="reveal-h" className="t-eyebrow mb-4 text-ink-3">
            WHAT THIS PROOF DISCLOSED
          </h3>
          <RevealTable {...revealRows(result.envelope, result.verdict)} />
        </section>
      )}

      {text && (
        <section aria-labelledby="raw-h">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 id="raw-h" className="t-eyebrow text-ink-3">
              THE FILE · {formatInt(result.sizeBytes)} BYTES · BASE64URL
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                data-cursor="COPY"
                onClick={async () => {
                  await navigator.clipboard.writeText(text).catch(() => {})
                  setCopied(true)
                  setTimeout(() => setCopied(false), 600)
                }}
              >
                <span className={copied ? 'text-valid' : undefined}>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              {downloadHref && (
                <a className="btn btn-sm btn-secondary" href={downloadHref} download="proof.pof" data-cursor="OPEN">
                  Download .pof
                </a>
              )}
            </div>
          </div>
          <pre className="t-data-sm max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-panel border border-border bg-bone-2 p-4 text-ink-2" data-lenis-prevent="">
            {text}
          </pre>
        </section>
      )}
    </div>
  )
}
