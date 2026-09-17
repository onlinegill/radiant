/**
 * "Find more on Hugging Face" — the open end of the model list.
 *
 * Tony: "add a separate section in the models page that lets you search
 * hugging face for models and lets you know if they will run on your phone
 * or not and then let you download and install the model into radiant."
 *
 * Search → each result is inspected (size, architecture, quantization) and
 * gets the same three verdicts the catalogue rows get, before any download.
 * "Download" adds it to the app's own list (LocalModels.addCustom) and starts
 * the ordinary download, so progress, cancel, chat and remove all work the
 * way they do for a catalogue model. See hf.js for what is checked and why.
 */
import React, { useEffect, useRef, useState } from 'react'
import usePress from './usePress.js'
import { deviceWord } from './device.js'
import { searchModels, inspectRepo, qualify, customRow } from './hf.js'
import BrandSpinner from './BrandSpinner.jsx'
import { progressText } from './progress.js'
import { fitOf } from './fit.js'

export default function HuggingFaceSearch ({ local = {}, models = [], ramAvailable = null, onOpenChat }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])      // [{ repo, owner, name, downloads }]
  const [info, setInfo] = useState({})            // repo -> inspectRepo() result | { error }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState('')   // the query the results belong to
  const abort = useRef(null)
  const inputRef = useRef(null)

  const run = async () => {
    const query = q.trim()
    if (!query) return
    // ⚠️ PUT THE KEYBOARD AWAY BEFORE THE RESULTS ARRIVE. It covers half the
    // screen, so searching and then having to scroll past your own keyboard to
    // see what you found is the whole interaction. Tony: "when i type in a
    // search and hit the search button the keyboard stays up... very clunky."
    // blur() is what dismisses it in a web view; the plugin call is the belt
    // and braces for the cases where focus has already moved elsewhere.
    inputRef.current?.blur()
    try { window.Capacitor?.Plugins?.Keyboard?.hide?.() } catch {}
    abort.current?.abort(); abort.current = new AbortController()
    setBusy(true); setError(null); setResults([]); setInfo({}); setSearched(query)
    try {
      const rows = await searchModels(query, { limit: 20, signal: abort.current.signal })
      setResults(rows)
      // inspect a few at a time; each result gets its verdict as it arrives
      const queue = rows.slice()
      const worker = async () => {
        while (queue.length && !abort.current.signal.aborted) {
          const r = queue.shift()
          try { const i = await inspectRepo(r.repo, { signal: abort.current.signal }); setInfo(prev => ({ ...prev, [r.repo]: i })) } catch (e) { setInfo(prev => ({ ...prev, [r.repo]: { error: e.message } })) }
        }
      }
      await Promise.all([worker(), worker(), worker()])
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'The search failed.')
    } finally { setBusy(false) }
  }
  useEffect(() => () => abort.current?.abort(), [])

  const go = usePress(run, { label: 'Search Hugging Face', disabled: busy || !q.trim() })
  const byRepo = Object.fromEntries(models.filter(m => m.repo).map(m => [m.repo, m]))

  return (
    <div className="rx-section">
      <div className="rx-section-header">Find more on Hugging Face</div>
      <div className="rx-group">
        <div className="rx-hf-search">
          <input
            ref={inputRef}
            className="rx-field"
            type="search"
            placeholder="Search models — try “qwen 4bit” or “llama 3.2”"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') run() }}
            aria-label="Search Hugging Face for models"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
          />
          <button type="button" className={'rx-hf-go rx-pressable' + go.className} {...go.handlers} disabled={busy || !q.trim()}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="rx-row-blurb rx-hf-note">
          Anything in MLX format that Radiant can load. Each result is checked before you download it: whether the engine
          has a loader for it, whether its weights are what its config says, and whether it fits this {deviceWord()}.
        </div>
        {error && <div className="rx-row-blurb rx-destructive rx-hf-note">{error}</div>}
        {results.map(r => {
          const i = info[r.repo]
          const existing = byRepo[r.repo]
          const fit = i && !i.error && ramAvailable ? fitOf(i.gb, ramAvailable) : null
          const v = i && !i.error ? qualify(i, fit) : null
          return (
            <HFRow key={r.repo} r={r} info={i} verdict={v} existing={existing} local={local} onOpenChat={onOpenChat} />
          )
        })}
        {!busy && !results.length && searched && !error && <div className="rx-row-blurb rx-hf-note">Nothing found — try another word, or the model’s family name.</div>}
      </div>
    </div>
  )
}

function HFRow ({ r, info, verdict, existing, local, onOpenChat }) {
  const state = existing ? (local.jobs?.[existing.id] || (existing.downloaded ? 'ready' : 'idle')) : 'idle'
  // ⚠️ progress[id] IS AN OBJECT — { pct, done, total } — NOT A NUMBER. This
  // read it as a number and multiplied it, so `object * 100` gave NaN and the
  // row said "Downloading… NaN%". Tony: "i got Downloadin: NaN or something
  // like that." progressText is the formatter the catalogue rows already use;
  // it takes the object, prefers a percent, falls back to megabytes, and
  // returns null rather than inventing a number.
  const shown = existing ? progressText(local.progress?.[existing.id]) : null
  const act = async () => {
    if (!verdict?.ok && !existing) return
    if (existing?.downloaded) { onOpenChat?.(existing.id); return }
    if (state === 'downloading') { local.cancel?.(existing.id); return }
    const row = customRow(info)
    const id = existing?.id || await local.addCustom?.(row)
    if (id) local.download?.(id)
  }
  const press = usePress(act, { label: existing?.downloaded ? `Chat with ${r.name}` : state === 'downloading' ? `Stop downloading ${r.name}` : `Download ${r.name}`, disabled: !existing && !verdict?.ok })
  const removeIt = usePress(() => local.removeCustom?.(existing.id), { label: `Remove ${r.name}`, disabled: !existing || state === 'downloading' })
  const tone = verdict ? verdict.tone : null
  return (
    <div className="rx-row rx-hf-row">
      {/* The same turning swirl the catalogue rows use while a download runs —
          Tony: "not the spinning swirl like it should". One download UI, not
          two that drift apart. */}
      {(state === 'downloading' || state === 'preparing') && (
        <span className="rx-row-lead"><BrandSpinner size={29} /></span>
      )}
      <div className="rx-row-text">
        <div className="rx-headline">{r.name}</div>
        <div className="rx-row-blurb">{r.owner} · {fmtCount(r.downloads)} downloads{info && !info.error && info.gb ? ` · ${info.gb.toFixed(1)} GB` : ''}</div>
        {!info && <div className="rx-row-blurb rx-l3">Checking…</div>}
        {info?.error && <div className="rx-row-blurb rx-destructive">{info.error}</div>}
        {verdict && <div className={'rx-row-blurb rx-hf-verdict is-' + tone}><span className={'rx-fit ' + (tone === 'positive' ? 'is-well' : tone === 'caution' ? 'is-tight' : 'is-no')}>{verdict.label}</span> {verdict.why}</div>}
        {state === 'downloading' && <div className="rx-row-blurb rx-tabular">{shown ? `Downloading… ${shown}` : 'Downloading…'}</div>}
        {state === 'preparing' && <div className="rx-row-blurb">Preparing…</div>}
        {existing && local.failures?.[existing.id] && <div className="rx-row-blurb rx-destructive">{local.failures[existing.id]}</div>}
      </div>
      <div className="rx-hf-actions">
        <button type="button" className={'rx-hf-btn rx-pressable' + press.className} {...press.handlers} disabled={!existing && !verdict?.ok}>
          {existing?.downloaded ? 'Chat' : state === 'downloading' ? 'Stop' : state === 'preparing' ? '…' : 'Download'}
        </button>
        {existing && state !== 'downloading' && (
          <button type="button" className={'rx-hf-btn is-quiet rx-pressable' + removeIt.className} {...removeIt.handlers}>Remove</button>
        )}
      </div>
    </div>
  )
}

function fmtCount (n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0) }
