/**
 * "Radiant is a Templeton Technologies product." — and now it goes somewhere.
 *
 * ⚠️ IT WAS DEAD TEXT IN FOUR PLACES. The byline is on the welcome screen, at
 * the foot of Home, under the Read me and under About, and in every one of them
 * it named the company and gave no way to find it. Tony, 2026-09-17: it "should
 * be clickable and take people to the templetontech.com website."
 *
 * One component for all four, so the next screen that carries the byline cannot
 * get a different URL, a different tap target, or no link at all.
 *
 * ⚠️ THE WHOLE SENTENCE IS THE TARGET, NOT THE TWO WORDS. "Templeton
 * Technologies" inside a caption-sized line is a target a few millimetres tall;
 * Apple's own floor is 44pt and a caption is not close. The line takes the tap
 * and the company name is what is tinted, so the affordance reads where the
 * eye expects it and the finger still has somewhere to land.
 */
import React from 'react'
import usePress from './usePress.js'

export const COMPANY_URL = 'https://templetontech.com'

/**
 * Open in the system browser.
 *
 * ⚠️ `window.open(url, '_blank')` IS THE MECHANISM, NOT A FALLBACK. Capacitor's
 * WebViewDelegationHandler answers createWebViewWith by calling
 * UIApplication.shared.open — so a new-window navigation leaves the web view
 * and lands in Safari, which is what we want: the address bar is what tells
 * someone whose site they are on. @capacitor/browser is NOT a dependency of
 * this app (see apps/ios/package.json), so anything that reaches for
 * Plugins.Browser first is reaching for something that has never existed here.
 */
export function openExternal (url) {
  try { window.open(url, '_blank', 'noopener') } catch { /* nothing to do */ }
}

export default function CompanyLine ({ className = '' }) {
  const press = usePress(() => openExternal(COMPANY_URL), {
    role: 'link',
    haptic: 'LIGHT',
    label: 'Radiant is a Templeton Technologies product. Opens templetontech.com.'
  })
  return (
    <p className={(className + ' rx-byline').trim() + press.className} {...press.handlers}>
      Radiant is a <span className="rx-byline-co">Templeton&nbsp;Technologies</span> product.
    </p>
  )
}

export { CompanyLine }
