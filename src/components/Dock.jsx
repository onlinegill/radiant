import React, { useRef, useState } from 'react'
import { Icon } from './Icons.jsx'

// ⚠️ PROTOTYPE. A macOS-style dock for the sidebar's mode switcher, after
// Tony sent reactbits.dev/components/dock: icons that swell toward the
// pointer with the neighbours easing aside, the name floating up over the
// hovered one, a dot under the one that is on. Written here rather than
// pulled in — the original needs framer-motion for one control, and this is
// sixty lines of CSS transitions that also fall still under
// prefers-reduced-motion. `localStorage.dock = '1'` (then reload) shows it in
// place of the two pill switches; unset, nothing changes.
//
// Deliberately NOT on the composer bar: that row already grows each icon
// into its word on hover, and a bar clicked fifty times a day must not move
// its targets under the cursor.

const BASE = 22, MAX = 34, REACH = 90   // px: resting icon, peak icon, falloff distance

export default function Dock ({ items, activeId, onPick }) {
  const wrap = useRef(null)
  const [mouseX, setMouseX] = useState(null)
  const centres = useRef([])

  const measure = () => {
    if (!wrap.current) return
    const r = wrap.current.getBoundingClientRect()
    centres.current = [...wrap.current.querySelectorAll('.dock-item')].map(el => { const b = el.getBoundingClientRect(); return b.left - r.left + b.width / 2 })
  }
  const onMove = e => { if (!centres.current.length) measure(); setMouseX(e.clientX - wrap.current.getBoundingClientRect().left) }

  return (
    <div
      ref={wrap}
      className='dock'
      role='tablist'
      onMouseEnter={measure}
      onMouseMove={onMove}
      onMouseLeave={() => setMouseX(null)}
    >
      {(() => {
        const ts = items.map((_, i) => { const c = centres.current[i] ?? 0; const d = mouseX == null ? REACH : Math.abs(mouseX - c); return Math.max(0, 1 - d / REACH) })
        const nearest = mouseX == null ? -1 : ts.indexOf(Math.max(...ts))
        return items.map((it, i) => {
        const t = ts[i]                                   // 1 under the pointer, 0 at REACH
        const size = BASE + (MAX - BASE) * (t * t * (3 - 2 * t))   // smoothstep
        const Ico = Icon[it.icon]
        const on = it.id === activeId
        return (
          <button
            key={it.id}
            className={'dock-item' + (on ? ' is-on' : '') + (i === nearest && t > 0.3 ? ' is-near' : '')}
            role='tab'
            aria-selected={on}
            aria-label={it.label}
            onClick={() => onPick(it.id)}
            style={{ '--dock-size': size + 'px', '--dock-lift': (size - BASE) / 2 + 'px' }}
          >
            <span className='dock-label' aria-hidden>{it.label}</span>
            <span className='dock-glyph'>{Ico ? <Ico size={size} /> : null}</span>
            <span className='dock-dot' aria-hidden />
          </button>
        )
        })
      })()}
    </div>
  )
}
