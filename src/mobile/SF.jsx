/**
 * An SF Symbol, drawn the way iOS draws it.
 *
 * ⚠️ THE PHONE USED TO IMITATE THESE BY HAND. Chevrons, the ellipsis circle,
 * the download arrow, four attempts at a gear that Tony called "still awful" —
 * each traced by eye against Apple's, and each a little off in weight or
 * proportion, which is exactly the kind of thing an iPhone user notices
 * without being able to say why. These are the real symbols, rendered by the
 * system (scripts/sf-symbols.sh) and tinted with the surrounding text colour,
 * so they match every other icon on the phone at whatever size and weight the
 * Human Interface Guidelines use for that role.
 *
 * Sizing follows the symbol's own layout box, as UIKit does: `size` is the
 * point size of the box's height; width follows the symbol's proportions, so
 * a chevron is narrow and a photo is wide without anyone measuring.
 *
 * Decorative by default (aria-hidden): the control around it carries the
 * label. Pass `label` for a symbol that stands alone.
 */
import React from 'react'
import { SF_SYMBOLS } from '../sf-symbols.js'

export default function SF ({ name, size = 22, label, className = '', style }) {
  const s = SF_SYMBOLS[name]
  if (!s) return null
  const h = size
  const w = Math.round((size * s.w / s.h) * 100) / 100
  return (
    <span
      className={('rx-sf ' + className).trim()}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        display: 'inline-block', width: w, height: h, flex: 'none',
        backgroundColor: 'currentColor',
        WebkitMaskImage: `url(${s.src})`, maskImage: `url(${s.src})`,
        WebkitMaskSize: 'contain', maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center', maskPosition: 'center',
        ...style
      }}
    />
  )
}

export { SF }
