/**
 * A maker's shelf: a header you tap to open, and its models underneath.
 *
 * Tony: "you also need to group the models by provider with widgets to close
 * the section. not a long messy list like you have now." Forty-four rows in one
 * column is the wall the picker exists to avoid; fourteen collapsed headers is
 * a contents page. It is also the Mac's own idiom — Settings → Models puts each
 * repo behind a triangle you open.
 *
 * Shared because BOTH model screens need it and they must not drift, but
 * parameterized by `prefix` because they do not share a stylesheet: the picker
 * injects its own `rx-mp-*` rules and the settings screen uses the shared
 * `rx-*` ones from mobile.css. Structure and behavior here, appearance there.
 *
 * A real <button> with aria-expanded/aria-controls rather than a styled div, so
 * VoiceOver announces "Google, collapsed, button" and it works from a keyboard.
 */
import React from 'react'
import usePress from './usePress.js'
import { byMaker } from './makers.js'
import SF from './SF.jsx'

function Chevron () {
  return <SF name='chevron.right' size={12} />
}

export default function MakerSection ({
  maker, count, runnable, open, onToggle, prefix = 'rx', children
}) {
  const id = `${prefix}-sec-${maker.replace(/\W+/g, '-').toLowerCase()}`
  const head = usePress(onToggle, {
    label: `${maker}, ${count} model${count === 1 ? '' : 's'}`
  })
  // usePress has two shapes across this codebase — the tuple the picker uses
  // and the object the settings screen uses. Accept either rather than forcing
  // one file to change its convention for the other's benefit.
  const cls = Array.isArray(head) ? (head[0] ? ' is-pressed' : '') : (head.className || '')
  const handlers = Array.isArray(head) ? head[1] : head.handlers

  return (
    <>
      <button
        type="button"
        className={`${prefix}-makerhead${cls}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        {...handlers}
      >
        <span className={`${prefix}-maker-chev`} aria-hidden="true"><Chevron /></span>
        <span className={`${prefix}-maker-name`}>{maker}</span>
        <span className={`${prefix}-maker-meta`}>
          {count} model{count === 1 ? '' : 's'}
          {/* Only claimed once the phone has reported its memory budget. Before
              that, how many run here is unknown, and silence beats a guess. */}
          {runnable != null && (
            runnable === 0
              ? <span className={`${prefix}-maker-none`}> · none run here</span>
              : <> · {runnable} run{runnable === 1 ? 's' : ''} here</>
          )}
        </span>
      </button>
      <div id={id} hidden={!open}>{children}</div>
    </>
  )
}

export { MakerSection, byMaker }
