'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { fetchPreset, loadVerifier, verify } from '@/lib/data/verifier'
import { PRESETS } from '@/lib/data/presets'
import { DEMO_AUDIENCE } from '@/lib/data/chain'
import type { Check, Preset, PresetId, VerificationResult } from '@/lib/data/types'
import { formatInt } from '@/lib/format'
import { revealRows } from '@/lib/reveal'
import { fromBase64Url, toBase64Url } from '@/lib/pof/bytes'
import { MAGIC } from '@/lib/pof/codec'
import { downloadReceipt } from '@/lib/receipt'
import { Verdict, present } from '@/components/ui/Verdict'
import { RevealTable } from '@/components/ui/RevealTable'
import { DataTable } from '@/components/ui/DataTable'
import { Chip, cx, Panel } from '@/components/ui/primitives'
import { SourceNote } from './SourceNote'

const MAX_BYTES = 1024 * 1024
const AUDIENCE_KEY = 'vouch:verify:audience'

function isPofBinary(b: Uint8Array) {
  return b.length >= 4 && MAGIC.every((m, i) => b[i] === m)
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode: the default identifier is fine */
  }
}

export function VerifierConsole({ variant = 'full' }: { variant?: 'full' | 'landing' }) {
  const [text, setText] = useState('')
  const [audience, setAudience] = useState<string>(DEMO_AUDIENCE.id)
  const [active, setActive] = useState<PresetId | 'custom' | null>(null)
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [version, setVersion] = useState('pof-verify')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const run = useCallback(async (input: string | Uint8Array, which: PresetId | 'custom', as: string) => {
    setActive(which)
    setError(null)
    const size = typeof input === 'string' ? input.length * 0.75 : input.length
    if (size > MAX_BYTES) {
      setResult(null)
      setError(`That is ${formatInt(Math.round(size))} bytes. A proof is about 12 KB; nothing over 1 MB is checked.`)
      return
    }
    setBusy(true)
    try {
      setResult(await verify(input, as.trim()))
    } catch (err) {
      setResult(null)
      setError(`The verifier could not run: ${(err as Error).message}. Nothing was checked.`)
    } finally {
      setBusy(false)
    }
  }, [])

  // Load the WASM verifier while the visitor reads; restore the identifier; honour #p= links.
  useEffect(() => {
    const stored = readStored(AUDIENCE_KEY)
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const p = hash.get('p')
    const a = hash.get('a') ?? stored ?? DEMO_AUDIENCE.id
    setAudience(a)
    loadVerifier()
      .then((m) => {
        setReady('ready')
        setVersion(m.version())
      })
      .catch(() => setReady('failed'))
    if (p) {
      setText(p)
      void run(p, 'custom', a)
    }
  }, [run])

  const runPreset = async (p: Preset) => {
    setAudience(p.audience)
    try {
      const bytes = await fetchPreset(p.file)
      setText(toBase64Url(bytes))
      await run(bytes, p.id, p.audience)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError(`That file is ${formatInt(file.size)} bytes. A proof is about 12 KB; nothing over 1 MB is checked.`)
      return
    }
    const buf = new Uint8Array(await file.arrayBuffer())
    if (isPofBinary(buf)) {
      setText(toBase64Url(buf))
      void run(buf, 'custom', audience)
    } else {
      const t = new TextDecoder().decode(buf).trim()
      setText(t)
      void run(t, 'custom', audience)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void onFile(e.dataTransfer.files[0])
  }

  const clear = () => {
    setText('')
    setResult(null)
    setError(null)
    setActive(null)
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
  }

  const full = variant === 'full'
  const current = PRESETS.find((p) => p.id === active)

  return (
    <div className="space-y-6">
      <Panel
        label="Proof input"
        chip={<Chip status={ready === 'failed' ? 'invalid' : 'neutral'}>{ready === 'ready' ? `WASM · ${version}` : ready === 'failed' ? 'VERIFIER FAILED TO LOAD' : 'LOADING VERIFIER'}</Chip>}
      >
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
            <input ref={fileInput} type="file" accept=".pof,.txt,application/octet-stream,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
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
                  <input
                    className="field t-data"
                    value={audience}
                    onChange={(e) => {
                      setAudience(e.target.value)
                      writeStored(AUDIENCE_KEY, e.target.value)
                    }}
                    spellCheck={false}
                  />
                </label>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary" data-cursor="VERIFY" disabled={!text.trim() || busy || ready === 'failed'} onClick={() => void run(text, active && active !== 'custom' ? active : 'custom', audience)}>
                    {busy ? 'Checking…' : 'Verify'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={clear} disabled={!text && !result && !error}>
                    Clear
                  </button>
                </div>
              </div>
              <p id="paste-hint" className="t-data-sm text-ink-3">
                Try it: load a vector, change one character, verify again. Change the identifier and it will refuse.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-4 sm:px-6">
          <p className="t-eyebrow mb-3 text-ink-3">OR RUN A TEST VECTOR · REAL PROOFS</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                data-cursor="RUN"
                disabled={busy}
                onClick={() => void runPreset(p)}
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
          {current && (
            <p className="t-data-sm mt-3 text-ink-3">
              {current.note}
              {current.audience !== DEMO_AUDIENCE.id && ` Verifying as “${current.audience}”.`}
            </p>
          )}
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
          <SourceNote anchor={result.anchor} verifier={result.verifier} />
          {full && <ResultDetail result={result} text={text} audience={audience.trim()} />}
        </>
      ) : (
        <div className="rounded-panel border border-dashed border-border px-5 py-8 sm:px-8">
          <p className="t-data text-ink-3">{busy ? 'Checking…' : 'No proof checked yet. A verdict appears here: valid, invalid, or expired.'}</p>
        </div>
      )}
    </div>
  )
}

function ResultDetail({ result, text, audience }: { result: VerificationResult; text: string; audience: string }) {
  const tone = present(result.verdict, result.now).tone
  const failColor = tone === 'expired' ? 'text-expired' : tone === 'invalid' ? 'text-invalid' : 'text-ink'
  const [copied, setCopied] = useState<string | null>(null)

  const bytes = useMemo(() => (text ? fromBase64Url(text.trim()) : null), [text])
  const downloadHref = useMemo(() => {
    if (!bytes || !isPofBinary(bytes) || typeof window === 'undefined') return null
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  }, [bytes])
  useEffect(() => () => void (downloadHref && URL.revokeObjectURL(downloadHref)), [downloadHref])

  const copy = async (what: string, value: string) => {
    await navigator.clipboard.writeText(value).catch(() => {})
    setCopied(what)
    setTimeout(() => setCopied(null), 600)
  }
  const link = () => `${window.location.origin}/verify#p=${text.trim()}&a=${encodeURIComponent(audience)}`

  return (
    <div className="space-y-12 pt-6">
      <section aria-labelledby="checks-h">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 id="checks-h" className="t-eyebrow text-ink-3">
            THE SIX CHECKS · CHEAPEST FIRST · STOPS AT THE FIRST FAILURE
          </h3>
          <button type="button" className="btn btn-sm btn-secondary" data-cursor="OPEN" onClick={() => downloadReceipt(result, audience)}>
            Download receipt
          </button>
        </div>
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
            { key: 'detail', header: 'Detail', className: 'text-ink-2', cell: (c) => c.detail },
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
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm btn-secondary" data-cursor="COPY" onClick={() => void copy('text', text.trim())}>
                <span className={copied === 'text' ? 'text-valid' : undefined}>{copied === 'text' ? 'Copied' : 'Copy'}</span>
              </button>
              <button type="button" className="btn btn-sm btn-secondary" data-cursor="COPY" onClick={() => void copy('link', link())}>
                <span className={copied === 'link' ? 'text-valid' : undefined}>{copied === 'link' ? 'Copied' : 'Copy verify link'}</span>
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
          <p className="t-data-sm mt-3 text-ink-3">The verify link carries the proof after the #, which browsers never send to a server.</p>
        </section>
      )}
    </div>
  )
}
