/**
 * Creating a GPT-Live session for a chat — the server's half of src/voice.js.
 *
 * The renderer sends an SDP offer; this posts it to OpenAI with the project key
 * and returns the answer. The key never reaches the renderer, which is OpenAI's
 * own rule for browser clients and Radiant's rule for every key it holds.
 *
 * ⚠️ CLIENT DELEGATION, ALWAYS. The other mode has OpenAI run a Responses
 * model as the backend, which would put the thinking on OpenAI regardless of
 * which model the chat uses. Client mode hands every real request back to
 * Radiant's own turn — same tools, approvals, and model as typing would get.
 *
 * ⚠️ OPTIONAL. This refuses unless settings.voice.enabled is true, so a person
 * who never turned it on cannot be billed by a stray button, and it says what
 * is missing (the setting, the key) in a sentence rather than a 4xx.
 */
import { liveInstructions, seedFrom } from '../src/voice-text.js'

export const LIVE_MODEL = 'gpt-live-1'
export const LIVE_VOICES = ['marin', 'quartz', 'ripple', 'vesper', 'willow', 'stone', 'gleam', 'meridian', 'beacon', 'delta', 'cinder']
export const LIVE_RATE_PER_MINUTE = 0.05   // USD, from the launch post; shown in Settings, not used for billing

/**
 * The OpenAI key for voice: ANY key on the OpenAI account roster, not only the
 * active credential. Tony's active OpenAI account is a ChatGPT sign-in
 * (OAuth), which serves the chat models on the subscription — and GPT-Live is
 * API-only, a sign-in cannot open it. A key added as a second OpenAI account
 * serves voice without switching every OpenAI chat over to pay-per-token.
 */
export function voiceKey (config) {
  if (config?.keys?.openai) return config.keys.openai
  const roster = config?.accounts?.openai || []
  const withKey = roster.find(a => a && a.key)
  return withKey?.key || null
}

/** Validate a request; returns { error, status } or null. */
export function checkVoiceRequest ({ settings, apiKey, sdp, signedIn = false }) {
  if (!settings?.voice?.enabled) return { status: 403, error: 'Voice conversations are off. Turn them on in Settings → Providers, under OpenAI.' }
  if (!apiKey) return { status: 400, error: signedIn ? 'Voice needs an OpenAI API key — the ChatGPT sign-in does not cover it. Add a key from platform.openai.com as a second OpenAI account in Settings → Providers.' : 'Voice needs an OpenAI API key — add one in Settings → Providers.' }
  if (typeof sdp !== 'string' || !sdp.trim() || !/^v=0/m.test(sdp)) return { status: 400, error: 'No audio offer arrived from the app.' }
  return null
}

/** The session body OpenAI is asked for, from the chat and the settings. */
export function liveSessionBody ({ session, settings, host, sdp }) {
  const voice = LIVE_VOICES.includes(settings?.voice?.voice) ? settings.voice.voice : 'marin'
  const seed = seedFrom(session?.messages || [])
  const input = seed
    ? [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: `Recent chat, for context:\n${seed}` }] }]
    : []
  return {
    session: {
      model: LIVE_MODEL,
      instructions: liveInstructions({ title: session?.title, model: session?.model, host }),
      delegation: { type: 'client' },
      audio: { output: { voice } },
      input
    },
    transport: { type: 'webrtc', sdp }
  }
}

/** POST the offer to OpenAI. Returns { session:{id}, transport:{sdp} } or throws with a readable message. */
export async function createLiveSession ({ apiKey, body, baseUrl = 'https://api.openai.com/v1', fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/live/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) {
    let detail = ''
    try { const j = await res.json(); detail = j.error?.message || JSON.stringify(j).slice(0, 200) } catch { try { detail = (await res.text()).slice(0, 200) } catch {} }
    const why = res.status === 401 ? 'OpenAI rejected the API key.'
      : res.status === 403 ? 'This OpenAI project does not have access to GPT-Live.'
        : res.status === 429 ? 'OpenAI is rate-limiting voice sessions right now.'
          : `OpenAI refused the voice session (${res.status}).`
    throw new Error(detail ? `${why} ${detail}` : why)
  }
  const result = await res.json()
  if (!result?.transport?.sdp) throw new Error('OpenAI answered without an audio answer.')
  return { session: { id: result.session?.id || null }, transport: { type: 'webrtc', sdp: result.transport.sdp } }
}

/**
 * What the backend turn is told when the message came by voice. Per OpenAI's
 * guide: keep task instructions with the backend, adapt the ones that assume a
 * text chat. Volatile (per turn), so it rides in planAddendum, not persona.
 */
export const VOICE_ADDENDUM = [
  '[This message was SPOKEN in a live voice conversation; a voice assistant will read your reply aloud, paraphrasing it.',
  'Transcripts can contain mistakes, unfinished phrases and later corrections — use the latest wording and ask one short question if a needed detail is unclear.',
  'Lead with the answer in two or three plain sentences a person can follow by ear. Put code, commands, tables and long detail after that; they stay in the chat.',
  'Do the work as usual with your tools. Never say an action happened unless it did.]'
].join(' ')
