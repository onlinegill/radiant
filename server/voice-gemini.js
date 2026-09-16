/**
 * Gemini Live as a second voice for a chat — the server's half of
 * src/voice-gemini.js, and the twin of server/voice.js.
 *
 * Tony asked whether Google's real-time audio is a better option than GPT-Live
 * and then said "add it now". It is not a swap: the two APIs share nothing.
 *
 *   GPT-Live   WebRTC from the renderer, an SDP offer traded for an answer,
 *              JSON on a data channel, and a first-class DELEGATION event that
 *              hands every real request back to Radiant.
 *   Gemini     A stateful WebSocket, raw PCM in and out, and no delegation
 *              concept at all.
 *
 * ⚠️ SO THE DELEGATION IS BUILT OUT OF A TOOL. Radiant's whole proposition for
 * voice is that the live model does the talking and Radiant's own turn does the
 * thinking — same model, same tools, same approvals as typing. Gemini has no
 * delegation, so it is given exactly ONE function, ask_radiant, and told that
 * anything real goes through it. A toolCall then means the same thing a
 * delegation means, and src/voice-gemini.js raises it through the same
 * onDelegate callback. Gemini's function calling is asynchronous, so it can
 * keep speaking while Radiant works, which is the one thing this buys us.
 *
 * ⚠️ THE KEY STAYS ON THIS SERVER. A browser must not hold a Gemini API key,
 * so the key mints a short-lived EPHEMERAL TOKEN (POST /v1beta/auth_tokens)
 * and only that reaches the renderer — Google's own rule for client-to-server
 * use, and Radiant's rule for every key it holds.
 *
 * ⚠️ OPTIONAL, like the other one. Nothing here runs unless
 * settings.voice.enabled is on, and a missing key is a sentence rather than a
 * 4xx.
 */
import { liveInstructions, seedFrom } from './voice-text.js'

// From the model list, not the blog post. 3.8 Live is Google's recommended
// default; the extended-thinking variant trades latency for reasoning.
export const GEMINI_LIVE_MODELS = ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking']
export const GEMINI_LIVE_DEFAULT = 'gemini-3.8-live'
// Google's published half-duplex voices for the Live API.
export const GEMINI_LIVE_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr']
// USD per minute, from the launch post. Shown in Settings so the cost of
// leaving a call open is visible; never used for billing.
export const GEMINI_RATE_IN_PER_MINUTE = 0.005
export const GEMINI_RATE_OUT_PER_MINUTE = 0.018

export const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
const AUTH_TOKENS_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens'

/** The one tool Gemini gets. Calling it IS a delegation to Radiant's own turn. */
export const ASK_RADIANT = {
  name: 'ask_radiant',
  description: 'Hand a request to Radiant, the assistant running on the user\'s computer. Use it for anything involving their files, code, commands, the web, earlier conversations, or facts you are not certain of — which is almost everything. Radiant answers with the real result.',
  parameters: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        description: 'What the user asked, in your own words, as a complete instruction. Include anything from earlier in the conversation that is needed to act on it.'
      }
    },
    required: ['request']
  }
}

/**
 * The Gemini key for voice: its own slot first, then whatever the chats use.
 * Mirrors voiceKey() in voice.js — a dedicated slot means turning on voice
 * never forces a provider change on the chats.
 */
export function geminiVoiceKey (config) {
  if (config?.keys?.['gemini-voice']) return config.keys['gemini-voice']
  if (config?.keys?.gemini) return config.keys.gemini
  const roster = config?.accounts?.gemini || []
  const withKey = (roster || []).find(a => a && a.key)
  return withKey?.key || null
}

/** Validate a request; returns { error, status } or null. */
export function checkGeminiVoiceRequest ({ settings, apiKey }) {
  if (!settings?.voice?.enabled) return { status: 403, error: 'Voice conversations are off. Turn them on in Settings → Voice.' }
  if (!apiKey) return { status: 400, error: 'Gemini voice needs a Google AI Studio API key — paste one in Settings → Voice. It is separate from any other provider you have added.' }
  return null
}

/** Which live model to use, from the setting, never a free-text value. */
export function geminiLiveModel (settings) {
  const m = settings?.voice?.geminiModel
  return GEMINI_LIVE_MODELS.includes(m) ? m : GEMINI_LIVE_DEFAULT
}

/**
 * The setup frame the renderer sends first, built here so the prompt, the tool
 * and the transcription flags are identical to what GPT-Live is told.
 *
 * ⚠️ BOTH TRANSCRIPTIONS ON. The chat saves what was said as a message when
 * the call ends, and without inputAudioTranscription/outputAudioTranscription
 * the socket carries audio and nothing readable — the transcript would be
 * empty, which is the bug the GPT-Live side already had once.
 */
export function geminiSetupFrame ({ session, settings, host }) {
  const voice = GEMINI_LIVE_VOICES.includes(settings?.voice?.geminiVoice) ? settings.voice.geminiVoice : 'Kore'
  const seed = seedFrom(session?.messages || [])
  const base = liveInstructions({ title: session?.title, model: session?.model, host })
  const instructions = [
    base,
    'Call ask_radiant for anything real. Do not answer from your own knowledge when the question is about their work.',
    seed ? `Recent chat, for context:\n${seed}` : ''
  ].filter(Boolean).join('\n\n')
  return {
    setup: {
      model: `models/${geminiLiveModel(settings)}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
      },
      systemInstruction: { parts: [{ text: instructions }] },
      tools: [{ functionDeclarations: [ASK_RADIANT] }],
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    }
  }
}

/**
 * Mint a short-lived token the renderer may hold.
 *
 * ⚠️ ONE SESSION, MINUTES LONG. `uses: 1` so a leaked token cannot open a
 * second call, and the two expiry fields do different jobs: newSessionExpireTime
 * is how long the renderer has to OPEN the socket, expireTime is how long the
 * call may then run. Getting these the wrong way round gives you a token that
 * connects and dies a minute later.
 */
export function tokenRequestBody ({ model, minutes = 30 }) {
  const now = Date.now()
  return {
    uses: 1,
    newSessionExpireTime: new Date(now + 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    expireTime: new Date(now + minutes * 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    liveConnectConstraints: {
      model: `models/${model}`,
      config: { responseModalities: ['AUDIO'] }
    }
  }
}

/** POST for the ephemeral token. Returns its name, or throws a readable message. */
export async function mintEphemeralToken ({ apiKey, model, minutes = 30, fetchImpl = fetch }) {
  let res
  try {
    res = await fetchImpl(AUTH_TOKENS_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(tokenRequestBody({ model, minutes }))
    })
  } catch (e) {
    throw new Error(`Google could not be reached for a voice token: ${e.message}`)
  }
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.error?.message || '' } catch {}
    if (res.status === 401 || res.status === 403) throw new Error('Google refused that API key for voice. Check it in Settings → Voice.')
    if (res.status === 429) throw new Error('Google is rate-limiting voice sessions right now.')
    throw new Error(detail || `Google answered ${res.status} when opening a voice session.`)
  }
  const body = await res.json()
  const name = body?.name || body?.token?.name
  if (!name) throw new Error('Google returned no voice token.')
  return name
}
