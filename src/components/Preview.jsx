import React, { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from './Markdown.jsx'
import { api, apiUrl, authHeaders } from '../api.js'
import { Icon } from './Icons.jsx'

// ⚠️ A WINDOW ON THE RESULT, NOT ON THE WORK. The Activity tab shows what the
// agent ran; nothing showed what it MADE. OpenHarness pairs every chat with a
// live viewer of the output — the board, the part, the game — and it is the
// one idea from it Tony asked for. This tab shows the newest thing worth
// looking at: a dev server the agent started (any localhost URL it printed),
// or a file it wrote that a browser can draw (html, markdown, svg, images,
// pdf). Files are re-read when they change on disk; a dev server reloads
// itself. The address field takes anything — a URL or a path — so it is
// also just a viewer.
//
// Files come through /api/preview (read-only, home or a chat's folder only),
// which is what makes this work from a paired phone as well as the Mac.

const FILE_RX = /\.(html?|md|markdown|svg|png|jpe?g|gif|webp|pdf|txt|json|csv)$/i
const URL_RX = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s"'<>)\]]*)?/g

/** Newest first: every previewable thing the conversation produced. */
export function previewCandidates (messages = []) {
  const out = []
  const seen = new Set()
  const add = (kind, value, at) => { const k = kind + value; if (!seen.has(k)) { seen.add(k); out.push({ kind, value, at }) } }
  messages.forEach((m, mi) => {
    for (const p of (m.parts || [])) {
      if (p.type !== 'tool' || p.denied) continue
      if ((p.name === 'write_file' || p.name === 'edit_file') && p.args?.path && FILE_RX.test(p.args.path) && p.result && !/^Error/i.test(String(p.result))) add('file', p.args.path, mi)
      if (p.name === 'run_command') {
        const hay = `${p.args?.command || ''}\n${p.result || ''}`
        for (const u of hay.match(URL_RX) || []) add('url', u.replace(/0\.0\.0\.0|\[::1\]/, 'localhost').replace(/[.,;:]+$/, ''), mi)
      }
    }
  })
  return out.reverse()
}

export default function Preview ({ session, visible }) {
  const cands = useMemo(() => previewCandidates(session?.messages), [session?.messages])
  const [pinned, setPinned] = useState(null)        // what the user chose; null = follow the newest
  const [address, setAddress] = useState('')
  const [nonce, setNonce] = useState(0)             // bump to reload the frame
  const [md, setMd] = useState(null)
  const [err, setErr] = useState(null)
  const stamp = useRef(null)
  const target = pinned || cands[0] || null

  useEffect(() => { setAddress(target ? target.value : '') }, [target?.kind, target?.value])

  const isFile = target?.kind === 'file'
  const isMd = isFile && /\.(md|markdown)$/i.test(target.value)
  const src = !target ? '' : isFile ? apiUrl(`/api/preview?path=${encodeURIComponent(target.value)}&n=${nonce}`) : target.value

  // a file that changed on disk is shown again; a dev server takes care of itself
  useEffect(() => {
    if (!visible || !isFile) return
    let stop = false
    const tick = async () => {
      try {
        const r = await fetch(apiUrl(`/api/preview?path=${encodeURIComponent(target.value)}`), { method: 'HEAD', headers: authHeaders() })
        if (!r.ok) { setErr(r.status === 403 ? 'Radiant only previews files in your home folder or a chat’s working folder.' : 'That file is not there.'); return }
        setErr(null)
        const tag = r.headers.get('etag')
        if (stamp.current && tag && tag !== stamp.current) { stamp.current = tag; setNonce(n => n + 1) }
        if (!stamp.current) stamp.current = tag
      } catch {}
    }
    tick()
    const t = setInterval(() => { if (!stop) tick() }, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [visible, isFile, target?.value])

  useEffect(() => { stamp.current = null; setErr(null) }, [target?.value])

  useEffect(() => {
    if (!isMd) { setMd(null); return }
    let gone = false
    fetch(apiUrl(`/api/preview?path=${encodeURIComponent(target.value)}&n=${nonce}`), { headers: authHeaders() })
      .then(r => r.ok ? r.text() : Promise.reject(new Error(String(r.status))))
      .then(t => { if (!gone) setMd(t) })
      .catch(() => { if (!gone) setMd(null) })
    return () => { gone = true }
  }, [isMd, target?.value, nonce])

  const go = () => {
    const v = address.trim()
    if (!v) return
    if (/^https?:\/\//i.test(v)) setPinned({ kind: 'url', value: v })
    else setPinned({ kind: 'file', value: v })
    setNonce(n => n + 1)
  }
  const openOutside = () => {
    if (!target) return
    if (isFile) api.openFile(target.value).catch(() => {})
    else window.open(target.value, '_blank', 'noopener')
  }

  return (
    <div className='preview'>
      <div className='preview-bar'>
        <input
          className='preview-address'
          value={address}
          onChange={e => setAddress(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') go() }}
          placeholder='A localhost URL, or a file the agent wrote'
          spellCheck={false}
        />
        <button className='icon-btn' title='Reload' onClick={() => setNonce(n => n + 1)}><Icon.sparkle size={14} /></button>
        <button className='icon-btn' title={isFile ? 'Open in its own app' : 'Open in the browser'} onClick={openOutside} disabled={!target}><Icon.arrowUp size={14} /></button>
      </div>
      {cands.length > 1 && (
        <div className='preview-cands'>
          {cands.slice(0, 6).map(c => (
            <button key={c.kind + c.value} className={'preview-cand' + (target && target.value === c.value ? ' on' : '')} title={c.value} onClick={() => { setPinned(c); setNonce(n => n + 1) }}>
              {c.kind === 'url' ? c.value.replace(/^https?:\/\//, '') : c.value.split('/').pop()}
            </button>
          ))}
          {pinned && <button className='preview-cand follow' onClick={() => setPinned(null)} title='Show the newest thing the agent makes'>newest</button>}
        </div>
      )}
      <div className='preview-body'>
        {!target && <div className='activity-empty'>When the agent starts a dev server or writes a page, an image, a document or a diagram, it shows here. Or type an address above.</div>}
        {err && <div className='activity-empty'>{err}</div>}
        {target && !err && isMd && <div className='preview-md'>{md == null ? <span className='shimmer'>Reading…</span> : <Markdown text={md} />}</div>}
        {target && !err && !isMd && (
          <iframe key={src} className='preview-frame' src={src} title='Preview' sandbox='allow-scripts allow-same-origin allow-forms allow-popups' />
        )}
      </div>
    </div>
  )
}
