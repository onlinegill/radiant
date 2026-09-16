// Gemini Live as a second voice: the words cross correctly, the key stays
// home, and refusals say why.
//
// ⚠️ THE TWO PROVIDERS MUST BE INTERCHANGEABLE TO THE APP. App.jsx picks a
// class and knows nothing else, so GeminiVoiceSession has to expose exactly
// what VoiceSession does. A missing method there is not a type error in this
// codebase — it is a voice call that half works at runtime.
import { readFileSync } from 'node:fs'
import {
  geminiVoiceKey, checkGeminiVoiceRequest, geminiSetupFrame, geminiLiveModel,
  tokenRequestBody, mintEphemeralToken, ASK_RADIANT,
  GEMINI_LIVE_MODELS, GEMINI_LIVE_DEFAULT, GEMINI_WS_URL
} from '../server/voice-gemini.js'

let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }

// ── the key: its own slot first, then the chats', never invented ───────────
ok(geminiVoiceKey({ keys: { 'gemini-voice': 'g1', gemini: 'g2' } }) === 'g1', 'the dedicated voice slot wins')
ok(geminiVoiceKey({ keys: { gemini: 'g2' } }) === 'g2', 'a chat key serves if there is no dedicated one')
ok(geminiVoiceKey({ keys: {}, accounts: { gemini: [{ key: 'g3' }] } }) === 'g3', 'a key on the account roster serves too')
ok(geminiVoiceKey({ keys: {} }) === null, 'and nothing is invented when there is no key')
ok(geminiVoiceKey({ keys: { 'openai-voice': 'sk-1' } }) === null, 'an OpenAI key is NOT a Gemini key')

// ── refusals are sentences, and name the thing to do ───────────────────────
const off = checkGeminiVoiceRequest({ settings: { voice: { enabled: false } }, apiKey: 'g' })
ok(off?.status === 403 && /Settings → Voice/.test(off.error), 'voice off is refused, pointing at the setting')
const noKey = checkGeminiVoiceRequest({ settings: { voice: { enabled: true } }, apiKey: null })
ok(noKey?.status === 400 && /Google AI Studio/.test(noKey.error) && /separate/.test(noKey.error),
   'a missing key says WHICH key and that it is separate from the others')
ok(checkGeminiVoiceRequest({ settings: { voice: { enabled: true } }, apiKey: 'g' }) === null, 'and an enabled session with a key passes')

// ── the model is from the list, never free text ────────────────────────────
ok(geminiLiveModel({ voice: { geminiModel: 'gemini-3.8-live-extended-thinking' } }) === 'gemini-3.8-live-extended-thinking', 'a listed model is honoured')
ok(geminiLiveModel({ voice: { geminiModel: 'gpt-4' } }) === GEMINI_LIVE_DEFAULT, 'an unlisted model falls back to the default')
ok(geminiLiveModel({}) === GEMINI_LIVE_DEFAULT, 'and so does no setting at all')
ok(GEMINI_LIVE_MODELS.includes(GEMINI_LIVE_DEFAULT), 'the default is one of the listed models')

// ── the setup frame: the contract Google documents, not something close ────
const setup = geminiSetupFrame({
  session: { title: 'Ship the thing', model: 'claude-opus-5', messages: [{ role: 'user', text: 'hello there' }] },
  settings: { voice: { enabled: true, geminiVoice: 'Puck' } },
  host: 'Dev-MBP'
}).setup
ok(setup.model === `models/${GEMINI_LIVE_DEFAULT}`, `the model is prefixed with models/ (${setup.model})`)
ok(setup.generationConfig.responseModalities.join() === 'AUDIO', 'it asks for audio back')
ok(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Puck', 'the chosen voice reaches the nested speechConfig')
ok(geminiSetupFrame({ settings: { voice: { geminiVoice: 'NotAVoice' } } }).setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Kore',
   'an unknown voice falls back rather than being sent')
// ⚠️ BOTH TRANSCRIPTIONS, or the saved transcript is empty and the call
// leaves nothing behind — the bug the GPT-Live side already shipped once.
ok(setup.inputAudioTranscription && setup.outputAudioTranscription, 'both transcriptions are switched on')
ok(/Ship the thing/.test(setup.systemInstruction.parts[0].text), 'the chat title reaches the instructions')
ok(/claude-opus-5/.test(setup.systemInstruction.parts[0].text), 'and the backend model is named')
ok(/hello there/.test(setup.systemInstruction.parts[0].text), 'recent chat is seeded in')

// ── the delegation is a tool, and it is the ONLY one ───────────────────────
const fns = setup.tools[0].functionDeclarations
ok(fns.length === 1 && fns[0].name === 'ask_radiant', 'exactly one function is offered, and it is ask_radiant')
ok(fns[0].parameters.required.includes('request'), 'it requires the request text')
ok(/almost everything/.test(ASK_RADIANT.description), 'and it is described widely enough that the model actually uses it')

// ── the token: one use, and the two expiries do different jobs ─────────────
const body = tokenRequestBody({ model: GEMINI_LIVE_DEFAULT, minutes: 30 })
ok(body.uses === 1, 'a token opens one session, so a leaked one cannot open another')
ok(body.liveConnectConstraints.model === `models/${GEMINI_LIVE_DEFAULT}`, 'the token is pinned to the model')
const newSession = Date.parse(body.newSessionExpireTime)
const expire = Date.parse(body.expireTime)
ok(Number.isFinite(newSession) && Number.isFinite(expire), 'both timestamps parse')
// ⚠️ THE ORDER MATTERS. newSessionExpireTime is how long there is to OPEN the
// socket; expireTime is how long the call may run. Swapped, the call connects
// and dies a minute later.
ok(expire > newSession, 'the call may run for longer than the window to start it')
ok(expire - Date.now() > 20 * 60_000, 'and a call gets a useful length, not a minute')

// ── minting: failures are readable, and the key never travels onward ───────
const mintWith = async (status, payload) => {
  let seen = null
  try {
    return await mintEphemeralToken({
      apiKey: 'KEY', model: GEMINI_LIVE_DEFAULT,
      fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: status === 200, status, json: async () => payload } }
    })
  } catch (e) { return { error: e.message, seen } } finally { globalThis.__seen = seen }
}
const good = await mintWith(200, { name: 'auth_tokens/abc123' })
ok(good === 'auth_tokens/abc123', 'a minted token comes back by name')
ok(globalThis.__seen.opts.headers['x-goog-api-key'] === 'KEY', 'the key is sent as x-goog-api-key')
ok(/\/v1beta\/auth_tokens$/.test(globalThis.__seen.url), 'to the documented auth_tokens endpoint')
ok((await mintWith(401, {})).error === 'Google refused that API key for voice. Check it in Settings → Voice.', 'a bad key says so and where to fix it')
ok(/rate-limiting/.test((await mintWith(429, {})).error), 'a rate limit is named as one')
ok(/no voice token/.test((await mintWith(200, {})).error), 'a missing token is an error, not a silent undefined')

// ── the two sessions must be interchangeable to the app ────────────────────
const gem = readFileSync('src/voice-gemini.js', 'utf8')
const oai = readFileSync('src/voice.js', 'utf8')
const methods = ['start', 'stop', 'thinking', 'commentary', 'instructions', 'cleanup', 'setState']
for (const m of methods) {
  ok(new RegExp(`\\n  (?:async )?${m} \\(`).test(gem), `GeminiVoiceSession has ${m}()`)
  ok(new RegExp(`\\n  (?:async )?${m} \\(`).test(oai), `VoiceSession has ${m}() — the interface both implement`)
}
for (const cb of ['onState', 'onCaption', 'onDelegate', 'onError', 'onEnd']) {
  ok(gem.includes(`this.${cb}`), `GeminiVoiceSession raises ${cb}`)
}
ok(/sessionId, onState, onCaption, onDelegate, onError, onEnd/.test(gem), 'it takes the same constructor options')

// ── the key must never reach the renderer ──────────────────────────────────
ok(!/x-goog-api-key/.test(gem), 'the renderer never sends an API key')
ok(/access_token=/.test(gem), 'it connects with the short-lived token instead')
ok(/\/api\/voice\/gemini\/session/.test(gem), 'and asks this server for it')

// ── audio rates are the API's, and the capture resamples ───────────────────
ok(/IN_RATE = 16000/.test(gem) && /OUT_RATE = 24000/.test(gem), '16 kHz in and 24 kHz out, as the API documents')
// ⚠️ An AudioContext runs at the device rate; sending those samples labelled
// 16 kHz is the bug that makes every voice a chipmunk.
ok(/ctx\.sampleRate \/ IN_RATE/.test(gem), 'capture resamples from the device rate rather than assuming it')
ok(/audio\/pcm;rate=/.test(gem), 'and labels the mime type with the rate it actually sent')

// ── a barge-in stops the speaker ───────────────────────────────────────────
ok(/sc\.interrupted/.test(gem) && /stopPlayback/.test(gem), 'an interruption drops the queued audio instead of talking over the user')

// ── the server route exists and is gated ───────────────────────────────────
const srv = readFileSync('server/index.js', 'utf8')
ok(/app\.post\('\/api\/voice\/gemini\/session'/.test(srv), 'the session route exists')
ok(/checkGeminiVoiceRequest/.test(srv), 'and is gated on the setting and the key')
ok(/GEMINI_WS_URL/.test(srv) && GEMINI_WS_URL.startsWith('wss://'), 'the socket URL is handed over, and is wss')
ok(/gemini-voice/.test(srv), 'the key has its own slot')

console.log(`\n${pass}/${pass + fail} passed  ·  a second voice, same interface, key still at home`)
process.exit(fail ? 1 : 0)
