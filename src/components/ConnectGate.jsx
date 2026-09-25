import React, { useState } from 'react'
import { getServer, setServer, testServer, servedByRadiant } from '../api.js'

// Shown when the app can't reach its Radiant server.
//
// Two quite different situations land here, and they don't deserve the same
// form. On a phone the page was served BY the shared server, so the address is
// simply this origin and the only missing piece is the token — asking someone
// to thumb in an IP they are already connected to is busywork. In the desktop
// app there is no origin to borrow, so the address is a real question.
export default function ConnectGate ({ error }) {
  const cur = getServer()
  const here = servedByRadiant()
  // In the iPhone app the UI is bundled, so there is no origin to borrow — the
  // address field is the only way in. A build can prefill it (VITE_RADIANT_SERVER)
  // so the app opens knowing which Mac to talk to and only asks for the token.
  const [base, setBase] = useState(cur.base || import.meta.env.VITE_RADIANT_SERVER || '')
  const [token, setToken] = useState(cur.token || '')
  const [manual, setManual] = useState(!here)   // native shell => always manual
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const connect = async e => {
    e?.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (manual) {
        let url = base.trim()
        if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url
        await testServer(url, token.trim())
        setServer({ base: url, token: token.trim() })
      } else {
        await testServer(location.origin, token.trim())
        setServer({ base: '', token: token.trim() })
      }
      location.reload()
    } catch (e) { setMsg(e.message); setBusy(false) }
  }
  const useLocal = () => { setServer(null); location.reload() }

  const canSubmit = token.trim() && (!manual || base.trim())

  return (
    <div className='app'>
      <form className='connect-gate' onSubmit={connect}>
        <div className='logo-mark big-mark' aria-hidden />
        <h2 className='connect-title'>Connect to Radiant</h2>
        <p className='connect-sub'>
          {here
            ? <>Enter the access token from the host — <strong>Settings&nbsp;→&nbsp;Devices&nbsp;&amp;&nbsp;sharing</strong>. This device stays signed in afterward.</>
            : (error || "Couldn't reach a Radiant server.")}
        </p>

        {manual && (
          <label className='connect-field'>
            <span className='connect-label'>Server address</span>
            <input
              className='text-input' value={base} onChange={e => setBase(e.target.value)}
              placeholder='100.x.y.z:5834 or host.tail-net.ts.net:5834'
              autoCapitalize='off' autoCorrect='off' spellCheck='false' inputMode='url'
            />
          </label>
        )}

        <label className='connect-field'>
          <span className='connect-label'>Access token</span>
          <input
            className='text-input' type='password' value={token} onChange={e => setToken(e.target.value)}
            placeholder='Paste the token from the host'
            autoCapitalize='off' autoCorrect='off' spellCheck='false' autoComplete='one-time-code'
          />
        </label>

        {msg && <div className='error-note connect-error'>⚠ {msg}</div>}

        <button className='small-btn primary connect-go' type='submit' disabled={busy || !canSubmit}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>

        <div className='connect-alt'>
          {here
            ? <button type='button' className='link-btn' onClick={() => setManual(m => !m)}>
                {manual ? 'Use this server' : 'Connect to a different computer'}
              </button>
            : <button type='button' className='link-btn' onClick={useLocal}>Use this device's own server</button>}
        </div>
      </form>
    </div>
  )
}
