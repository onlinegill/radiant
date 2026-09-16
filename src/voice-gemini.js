/**
 * A spoken conversation over a Radiant chat, on Gemini Live.
 *
 * ⚠️ SAME INTERFACE AS src/voice.js, DELIBERATELY. Same constructor options
 * (sessionId, onState, onCaption, onDelegate, onError, onEnd), same methods
 * (start, stop, thinking, commentary, instructions), same row shape and the
 * same state names. App.jsx picks the class and knows nothing else about which
 * provider is in front — that is the whole point of adding this rather than
 * replacing GPT-Live, and it is what lets the cheaper per-minute rate be a
 * setting instead of a rewrite.
 *
 * ⚠️ THE TRANSPORT IS NOT WEBRTC. GPT-Live negotiates media tracks and the
 * browser owns the microphone and the speaker. Gemini is a plain WebSocket
 * carrying base64 PCM, so this file does by hand what WebRTC did for free:
 * capture at whatever rate the machine gives us, resample to 16 kHz signed
 * 16-bit, send; and on the way back, queue 24 kHz frames and play them
 * gaplessly. Those two rates are not interchangeable and are not negotiable —
 * they are what the API accepts and emits.
 *
 * ⚠️ AND DELEGATION IS A TOOL CALL. Gemini has no delegation event, so the
 * server gives it exactly one function, ask_radiant (see server/voice-gemini.js).
 * A toolCall therefore means what a delegation means on the other side, and is
 * raised through the same onDelegate. Unlike GPT-Live's delegation, this one
 * ARRIVES WITH THE WORDS IN IT, so no transcript reconstruction is needed.
 */
import { apiUrl, authHeaders } from './api.js'
import { addFragment } from '../server/voice-text.js'

const IN_RATE = 16000        // what the API accepts
const OUT_RATE = 24000       // what the API emits
const FRAME = 2048           // samples per send; ~128 ms, small enough to feel live
const APPEND_MAX = 1800

const b64 = buf => {
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = str => {
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export class GeminiVoiceSession {
  constructor ({ sessionId, onState, onCaption, onDelegate, onError, onEnd }) {
    this.sessionId = sessionId
    this.onState = onState || (() => {})
    this.onCaption = onCaption || (() => {})
    this.onDelegate = onDelegate || (() => {})
    this.onError = onError || (() => {})
    this.onEnd = onEnd || (() => {})
    this.rows = []
    this.state = 'off'
    this.ws = null
    this.mic = null
    this.ctxIn = null
    this.ctxOut = null
    this.node = null
    this.playAt = 0
    this.startedAt = 0
    this.finalized = false
    this.ended = false
    this.pending = new Map()   // toolCall id -> function name, so a response can be matched
  }

  setState (s) { this.state = s; this.onState(s, { seconds: this.seconds() }) }

  seconds () { return this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : null }

  async start () {
    if (this.state !== 'off') return
    this.setState('connecting')
    try {
      // The key never comes here — the server mints a short-lived token.
      const res = await fetch(apiUrl('/api/voice/gemini/session'), {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ sessionId: this.sessionId })
      })
      if (!res.ok) {
        let msg = `Voice session failed (${res.status})`
        try { msg = (await res.json()).error || msg } catch {}
        throw new Error(msg)
      }
      const { token, wsUrl, setup } = await res.json()

      // macOS asks about the microphone through the app, not the page; a
      // refusal there is a sentence a person can act on.
      if (window.radiantNative?.askMicrophone) {
        const allowed = await window.radiantNative.askMicrophone()
        if (!allowed) throw new Error('Radiant is not allowed to use the microphone. Allow it under System Settings → Privacy & Security → Microphone, then try again.')
      }
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      } catch (e) {
        throw new Error(/notallowed|denied|permission/i.test(`${e?.name} ${e?.message}`)
          ? 'The microphone was not allowed. Radiant needs it for a voice conversation — allow it under System Settings → Privacy & Security → Microphone.'
          : `The microphone could not be opened: ${e?.message || e}`)
      }

      await this.openSocket(wsUrl, token, setup)
      this.startCapture()
      this.startedAt = Date.now()
      this.setState('listening')
    } catch (e) {
      this.onError(e.message || String(e))
      this.cleanup()
    }
  }

  openSocket (wsUrl, token, setup) {
    return new Promise((resolve, reject) => {
      // The token rides in the query string — Google accepts it there or as an
      // Authorization header, and a browser WebSocket cannot set headers.
      const ws = new WebSocket(`${wsUrl}?access_token=${encodeURIComponent(token)}`)
      ws.binaryType = 'arraybuffer'
      this.ws = ws
      const failFast = () => reject(new Error('The voice connection could not be opened.'))
      ws.addEventListener('error', failFast, { once: true })
      ws.addEventListener('open', () => {
        ws.removeEventListener('error', failFast)
        ws.send(JSON.stringify(setup))
        resolve()
      }, { once: true })
      ws.addEventListener('message', ev => this.handle(ev.data))
      ws.addEventListener('close', () => {
        if (!this.finalized && this.state !== 'off') {
          this.onError('The voice connection dropped.')
          this.cleanup()
        }
      })
    })
  }

  /**
   * Microphone → 16 kHz PCM16 → the socket.
   *
   * ⚠️ RESAMPLE, DO NOT ASSUME. An AudioContext runs at the device rate (often
   * 44.1 or 48 kHz); sending those samples labelled 16 kHz is the classic bug
   * that makes every voice sound like a chipmunk and the transcript nonsense.
   */
  startCapture () {
    const ctx = new AudioContext()
    this.ctxIn = ctx
    const src = ctx.createMediaStreamSource(this.mic)
    const node = ctx.createScriptProcessor(FRAME, 1, 1)
    this.node = node
    node.onaudioprocess = e => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      const input = e.inputBuffer.getChannelData(0)
      const ratio = ctx.sampleRate / IN_RATE
      const outLen = Math.floor(input.length / ratio)
      const pcm = new Int16Array(outLen)
      for (let i = 0; i < outLen; i++) {
        const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]))
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      this.send({ realtimeInput: { audio: { data: b64(pcm.buffer), mimeType: `audio/pcm;rate=${IN_RATE}` } } })
    }
    src.connect(node)
    // ScriptProcessor only runs while connected to a destination; a zero gain
    // keeps the loopback silent so the user does not hear themselves.
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(mute)
    mute.connect(ctx.destination)
  }

  /** 24 kHz frames, queued so they play back to back instead of overlapping. */
  play (bytes) {
    if (!this.ctxOut) this.ctxOut = new AudioContext({ sampleRate: OUT_RATE })
    const ctx = this.ctxOut
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
    const buf = ctx.createBuffer(1, pcm.length, OUT_RATE)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
    const node = ctx.createBufferSource()
    node.buffer = buf
    node.connect(ctx.destination)
    const now = ctx.currentTime
    this.playAt = Math.max(this.playAt, now)
    node.start(this.playAt)
    this.playAt += buf.duration
  }

  async handle (raw) {
    let ev
    try {
      const text = raw instanceof Blob ? await raw.text() : (typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
      ev = JSON.parse(text)
    } catch { return }

    const sc = ev.serverContent
    if (sc) {
      // ⚠️ A BARGE-IN MUST STOP THE SPEAKER. Gemini says the user interrupted;
      // without dropping the queued audio it keeps talking over them, which is
      // the single most obvious way a voice app feels broken.
      if (sc.interrupted) { this.stopPlayback() }
      const inTx = sc.inputTranscription?.text
      if (inTx) {
        addFragment(this.rows, 'you', { text: inTx, startMs: Date.now(), endMs: Date.now() })
        this.onCaption(this.rows.map(r => ({ ...r })))
      }
      const outTx = sc.outputTranscription?.text
      if (outTx) {
        addFragment(this.rows, 'radiant', { text: outTx, startMs: Date.now(), endMs: Date.now() })
        this.onCaption(this.rows.map(r => ({ ...r })))
      }
      for (const part of sc.modelTurn?.parts || []) {
        const d = part.inlineData
        if (d?.data && /audio\/pcm/i.test(d.mimeType || '')) this.play(unb64(d.data))
      }
    }

    // A tool call IS the delegation — and unlike GPT-Live's, it carries the words.
    for (const call of ev.toolCall?.functionCalls || []) {
      if (call.name !== 'ask_radiant') continue
      const id = call.id || `c_${Date.now()}`
      this.pending.set(id, call.name)
      this.setState('working')
      this.onDelegate({ id, text: String(call.args?.request || '').trim() })
    }

    if (ev.goAway || ev.sessionResumptionUpdate?.resumable === false) {
      // Google is closing the session; end cleanly rather than as a drop.
      this.finalized = true
      this.cleanup()
    }
  }

  send (msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try { this.ws.send(JSON.stringify(msg)); return true } catch { return false }
  }

  /**
   * Answer the outstanding ask_radiant.
   *
   * ⚠️ ONE RESPONSE PER CALL, MATCHED BY ID, or Gemini waits forever and the
   * conversation quietly dies mid-sentence. thinking() and commentary() both
   * land here because on this API there is no separate quiet channel: the
   * difference on the GPT-Live side is whether the words are spoken, and the
   * honest equivalent is to answer the call once, with the words that matter.
   */
  respond (content, delegationId) {
    const id = delegationId || [...this.pending.keys()].pop()
    if (!id) return false
    this.pending.delete(id)
    if (this.state === 'working') this.setState('listening')
    return this.send({
      toolResponse: {
        functionResponses: [{ id, name: 'ask_radiant', response: { result: String(content).slice(0, APPEND_MAX) } }]
      }
    })
  }

  // Quiet context on GPT-Live; here it is progress on the open call, so it is
  // held rather than sent — answering early would end the call's turn.
  thinking (content, delegationId = null) {
    this.progress = String(content || '').slice(0, APPEND_MAX)
    return Boolean(delegationId || this.pending.size)
  }

  // Said aloud: the answer to the outstanding request.
  commentary (content, delegationId = null) {
    return this.respond(content, delegationId)
  }

  // A direction for the live model itself, mid-call.
  instructions (content) {
    return this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: String(content).slice(0, APPEND_MAX) }] }], turnComplete: false } })
  }

  stopPlayback () {
    try { this.ctxOut?.close() } catch {}
    this.ctxOut = null
    this.playAt = 0
  }

  stop () {
    if (this.state === 'off') return
    this.finalized = true
    this.setState('closing')
    this.send({ realtimeInput: { audioStreamEnd: true } })
    this.cleanup()
  }

  cleanup () {
    // The transcript outlives the call, handed over once however it ended.
    if (!this.ended) {
      this.ended = true
      const rows = this.rows.filter(r => r.text && r.text.trim())
      if (rows.length) this.onEnd({ rows, seconds: this.seconds() })
    }
    try { this.mic?.getTracks().forEach(t => t.stop()) } catch {}
    try { this.node?.disconnect() } catch {}
    try { this.ctxIn?.close() } catch {}
    this.stopPlayback()
    try { this.ws?.close() } catch {}
    this.ws = null; this.mic = null; this.node = null; this.ctxIn = null
    if (this.state !== 'off') this.setState('off')
  }
}
