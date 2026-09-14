/**
 * "Send your messages to OpenAI?" — the sheet a person sees before the first
 * message goes to a cloud provider. What is sent, to whom, what is not, and a
 * choice. See consent.js for why it exists.
 */
import React, { useEffect, useState } from 'react'
import { usePress } from './usePress.js'
import { providerHost } from './consent.js'

const PRIVACY_URL = 'https://www.templetongroup.dev/showcase/radiant/privacy.html'

function openPrivacy () {
  try {
    const browser = window.Capacitor?.Plugins?.Browser
    if (browser?.open) { browser.open({ url: PRIVACY_URL }); return }
  } catch { /* fall through */ }
  window.open(PRIVACY_URL, '_blank', 'noopener')
}

export default function ConsentSheet ({ provider, onAllow, onDecline }) {
  const [p, setP] = useState(1)
  useEffect(() => { const r = requestAnimationFrame(() => setP(0)); return () => cancelAnimationFrame(r) }, [])
  const leave = cb => { setP(1); setTimeout(cb, 300) }
  const allow = usePress(() => leave(onAllow), { label: `Allow sending messages to ${provider.name}` })
  const decline = usePress(() => leave(onDecline), { label: 'Not now' })
  const policy = usePress(openPrivacy, { label: 'Read the privacy policy' })
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') leave(onDecline) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDecline])
  const host = providerHost(provider)
  return (
    <>
      <div className="rx-sheet-scrim" style={{ '--rx-sheet-p': p }} onPointerDown={() => leave(onDecline)} />
      <div className="rx-sheet" role="dialog" aria-modal="true" aria-label={`Send your messages to ${provider.name}?`} style={{ '--rx-sheet-p': p, '--rx-sheet-h': '72dvh' }}>
        <div className="rx-grabber" style={{ padding: 0 }} />
        <div className="rx-consent">
          <div className="rx-title-2 rx-l1">Send your messages to {provider.name}?</div>
          <p className="rx-body rx-l2">
            You chose a model that runs on {provider.name}&rsquo;s servers, not on this device. To answer,
            Radiant has to send the conversation there.
          </p>
          <div className="rx-consent-list">
            <div className="rx-consent-row">
              <div className="rx-subhead rx-l1">What is sent</div>
              <div className="rx-footnote rx-l2">The messages you type in a chat that uses this model, any images you attach to them, and the model&rsquo;s replies.</div>
            </div>
            <div className="rx-consent-row">
              <div className="rx-subhead rx-l1">Where it goes</div>
              <div className="rx-footnote rx-l2">Directly to {provider.name} at <span className="rx-mono">{host}</span>, using your own API key, under {provider.name}&rsquo;s privacy policy. Not to Templeton Technologies &mdash; we run no server and never see it.</div>
            </div>
            <div className="rx-consent-row">
              <div className="rx-subhead rx-l1">What is not sent</div>
              <div className="rx-footnote rx-l2">Anything else on this device &mdash; your other chats, contacts, photos you did not attach, location. Models you download run entirely on the device and send nothing.</div>
            </div>
          </div>
          <p className="rx-caption-1 rx-l3">
            You can withdraw this any time by removing the {provider.name} key in Settings &rsaquo; Providers.
            {' '}<button type="button" className={'rx-consent-link rx-pressable' + policy.className} {...policy.handlers}>Privacy policy</button>
          </p>
          <div className="rx-consent-actions">
            <button type="button" className={'rx-primary rx-pressable' + allow.className} {...allow.handlers}>Allow</button>
            <button type="button" className={'rx-consent-decline rx-pressable' + decline.className} {...decline.handlers}>Not now</button>
          </div>
        </div>
      </div>
    </>
  )
}
