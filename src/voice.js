/**
 * A spoken conversation over a Radiant chat: GPT-Live in front, Radiant behind.
 *
 * GPT-Live (OpenAI's full-duplex voice model) listens and speaks. It does not
 * think: whenever the person asks for anything real it raises a DELEGATION,
 * and this class turns that into an ordinary Radiant turn — same tools, same
 * approvals, whichever model the chat uses — and hands the answer back to be
 * spoken. Radiant's proposition does not change; a mouth and ears are added.
 *
 * ⚠️ OPT-IN, AND IT SAYS WHERE THE AUDIO GOES. Nothing here runs unless
 * settings.voice.enabled is on and the person presses the voice button. Audio
 * travels to OpenAI at their per-minute rate; the composer shows that while a
 * session is up. (Tony: "ok build it in. but make it optional.")
 *
 * Transport is WebRTC from the renderer: the browser owns the microphone and
 * the speaker, media goes on negotiated tracks, and a data channel named
 * "oai-events" carries JSON. The session is CREATED by Radiant's server, which
 * holds the OpenAI key — the renderer only ever sees an SDP answer. This
 * mirrors OpenAI's own browser example and their rule that the key stays on a
 * trusted server.
 *
 * ⚠️ THE HTTP REQUEST STARTS THE SESSION. Do not send session.start on the
 * channel. Wait for session.started before sending anything else.
 *
 * ⚠️ session.delegation.created CARRIES NO WORDS. It is an id and a target.
 * The request is assembled from the input-transcript deltas collected since
 * the previous delegation (see voice-text.js). A transcript can be wrong; the
 * backend prompt says so.
 */
import { apiUrl, authHeaders } from './api.js'
import { utteranceFrom } from './voice-text.js'

const ICE_TIMEOUT_MS = 10_000
const CLOSE_TIMEOUT_MS = 15_000
const APPEND_MAX = 1800   // characters; the API caps an append at 500 tokens

export class VoiceSession {
  constructor ({ sessionId, onState, onCaption, onDelegate, onError }) {
    this.sessionId = sessionId
    this.onState = onState || (() => {})
    this.onCaption = onCaption || (() => {})
    this.onDelegate = onDelegate || (() => {})
    this.onError = onError || (() => {})
    this.state = 'off'
    this.liveId = null
    this.peer = null
    this.events = null
    this.mic = null
    this.audio = null
    this.inFragments = []       // { text, startMs, endMs }
    this.lastDelegationMs = -1
    this.userCaption = ''
    this.assistantCaption = ''
    this.finalized = false
    this.closeTimer = null
    this.usage = null
  }

  setState (s) { this.state = s; this.onState(s, { seconds: this.usage?.seconds ?? null }) }

  async start () {
    if (this.state !== 'off') return
    this.setState('connecting')
    try {
      const peer = new RTCPeerConnection()
      this.peer = peer
      this.audio = new Audio()
      this.audio.autoplay = true
      peer.addEventListener('track', ev => {
        this.audio.srcObject = new MediaStream([ev.track])
        this.audio.play().catch(() => {})
      })
      // macOS asks about the microphone through the app, not the page; a
      // refusal there is a sentence a person can act on, not "Permission denied".
      if (window.radiantNative?.askMicrophone) {
        const allowed = await window.radiantNative.askMicrophone()
        if (!allowed) throw new Error('Radiant is not allowed to use the microphone. Allow it under System Settings → Privacy & Security → Microphone, then try again.')
      }
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (e) {
        throw new Error(/notallowed|denied|permission/i.test(`${e?.name} ${e?.message}`) ? 'The microphone was not allowed. Radiant needs it for a voice conversation — allow it under System Settings → Privacy & Security → Microphone.' : `The microphone could not be opened: ${e?.message || e}`)
      }
      for (const track of this.mic.getAudioTracks()) peer.addTrack(track, this.mic)

      // The channel and its listeners exist before the offer, per the doc.
      const events = peer.createDataChannel('oai-events')
      this.events = events
      events.addEventListener('message', ({ data }) => this.handle(data))
      events.addEventListener('close', () => {
        if (!this.finalized && this.state !== 'off') {
          this.onError('The voice connection dropped.')
          this.cleanup()
        }
      })

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      if (peer.iceGatheringState !== 'complete') {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', on); reject(new Error('Timed out setting up the audio connection.')) }, ICE_TIMEOUT_MS)
          const on = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(t); peer.removeEventListener('icegatheringstatechange', on); resolve() } }
          peer.addEventListener('icegatheringstatechange', on)
          on()
        })
      }
      const sdp = peer.localDescription?.sdp
      if (!sdp) throw new Error('No audio offer was produced.')

      const res = await fetch(apiUrl('/api/voice/session'), {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ sdp, sessionId: this.sessionId })
      })
      if (!res.ok) {
        let msg = `Voice session failed (${res.status})`
        try { msg = (await res.json()).error || msg } catch {}
        throw new Error(msg)
      }
      const result = await res.json()
      this.liveId = result.session?.id || null
      await peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp })
      // session.started arrives on the channel and flips the state to listening
    } catch (e) {
      this.onError(e.message || String(e))
      this.cleanup()
    }
  }

  handle (raw) {
    let ev
    try { ev = JSON.parse(raw) } catch { return }
    switch (ev.type) {
      case 'session.started':
        this.setState('listening')
        break
      case 'session.closed':
        this.finalized = true
        this.usage = ev.usage || null
        this.cleanup()
        break
      case 'session.input_transcript.delta': {
        const f = { text: ev.delta || '', startMs: ev.start_ms ?? Date.now(), endMs: ev.end_ms ?? ev.start_ms ?? Date.now() }
        this.inFragments.push(f)
        if (this.inFragments.length > 400) this.inFragments.splice(0, this.inFragments.length - 400)
        this.userCaption = utteranceFrom(this.inFragments, this.lastDelegationMs)
        this.onCaption({ who: 'you', text: this.userCaption })
        break
      }
      case 'session.output_transcript.delta':
        this.assistantCaption = (this.assistantCaption + (ev.delta || '')).slice(-600)
        this.onCaption({ who: 'radiant', text: this.assistantCaption })
        break
      case 'session.delegation.created': {
        const id = ev.delegation?.id
        if (!id) break
        const text = utteranceFrom(this.inFragments, this.lastDelegationMs)
        const last = this.inFragments[this.inFragments.length - 1]
        this.lastDelegationMs = last ? (last.endMs ?? last.startMs) : Date.now()
        this.assistantCaption = ''
        this.setState('working')
        this.onDelegate({ id, text })
        break
      }
      case 'session.usage.updated':
        // Snapshots of cumulative seconds, not increments — show the latest.
        this.usage = ev.usage || this.usage
        this.onState(this.state, { seconds: ev.usage?.seconds ?? null })
        break
      case 'error':
        // A rejected command names the event it rejects; a moderation cut-off
        // does not end the session. Neither is a reason to hang up.
        this.onError(ev.error?.message || ev.message || 'The voice service reported an error.')
        break
      default: break
    }
  }

  send (msg) {
    if (!this.events || this.events.readyState !== 'open') return false
    try { this.events.send(JSON.stringify(msg)); return true } catch { return false }
  }

  // Quiet context — not spoken, but usable.
  thinking (content, delegationId = null) {
    return this.send({ type: 'session.thinking.append', event_id: `t_${Date.now()}`, delegation_id: delegationId, content: String(content).slice(0, APPEND_MAX) })
  }

  // Said aloud, paraphrased.
  commentary (content, delegationId = null) {
    if (this.state === 'working') this.setState('listening')
    return this.send({ type: 'session.commentary.append', event_id: `c_${Date.now()}`, delegation_id: delegationId, content: String(content).slice(0, APPEND_MAX) })
  }

  // A direction for the live model itself.
  instructions (content) {
    return this.send({ type: 'session.instructions.append', event_id: `i_${Date.now()}`, delegation_id: null, content: String(content).slice(0, APPEND_MAX) })
  }

  /** Ask for a graceful end; usage arrives in session.closed. */
  stop () {
    if (this.state === 'off') return
    if (this.events && this.events.readyState === 'open') {
      this.setState('closing')
      this.send({ type: 'session.close' })
      this.closeTimer = setTimeout(() => this.cleanup(), CLOSE_TIMEOUT_MS)
    } else {
      this.cleanup()
    }
  }

  cleanup () {
    clearTimeout(this.closeTimer)
    try { this.mic?.getTracks().forEach(t => t.stop()) } catch {}
    try { this.events?.close() } catch {}
    try { this.peer?.close() } catch {}
    if (this.audio) { this.audio.srcObject = null }
    this.mic = null; this.events = null; this.peer = null
    if (this.state !== 'off') this.setState('off')
  }
}
