// Voice conversations: what crosses between GPT-Live and a Radiant turn.
//
// The audio path needs a microphone and OpenAI; none of that runs here. What
// runs here is everything that can be wrong without them: the request that is
// assembled from transcript fragments, the spoken text made from an answer,
// the session body sent to OpenAI, and the refusals when voice is off or the
// key is missing.
import { utteranceFrom, spokenFrom, deMarkdown, progressLine, liveInstructions, seedFrom } from '../src/voice-text.js'
import { checkVoiceRequest, liveSessionBody, createLiveSession, voiceKey, VOICE_ADDENDUM } from '../server/voice.js'

let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }

// ── the words come from the transcript, not the delegation ──────────────────
const frags = [
  { text: 'What is', startMs: 1000, endMs: 1200 }, { text: ' the status', startMs: 1200, endMs: 1500 }, { text: ' of the tests', startMs: 1500, endMs: 1900 }
]
ok(utteranceFrom(frags) === 'What is the status of the tests', 'fragments join in order, exactly as received')
ok(utteranceFrom(frags, 1200) === 'the status of the tests', 'only fragments after the last delegation count')
ok(utteranceFrom([]) === '', 'no fragments, no request')
ok(utteranceFrom([{ text: '   ' }]) === '', 'silence is not a request')

// ── the answer is handed over as prose, short ────────────────────────────────
const parts = [
  { type: 'tool', name: 'read_file', result: 'x'.repeat(5000) },
  { type: 'text', text: '## Result\n\nAll **12** tests pass. Here is the diff:\n\n```js\nconst a = 1\n```\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSee [the docs](https://x.y).' }
]
const said = spokenFrom(parts)
ok(!/x{50}/.test(said), 'tool results are not spoken')
ok(!/```|\*\*|##|\[the docs\]\(/.test(said), `markdown is stripped: ${said.slice(0, 80)}`)
ok(/code block in the chat/.test(said), 'code is named, not read')
ok(/All 12 tests pass/.test(said), 'the sentence survives')
ok(/1, 2\./.test(said), 'a table row becomes a sentence')
const long = spokenFrom([{ type: 'text', text: ('This is a sentence about the build. ').repeat(80) }])
ok(long.length < 1500 && /The rest of the answer is in the chat\.$/.test(long), `a long answer is cut at a sentence and says so (${long.length} chars)`)
ok(/\. The rest/.test(long), 'cut lands after a full stop')
ok(spokenFrom([]) === '', 'nothing to say is empty, so the caller can choose a fallback')
ok(deMarkdown('> quoted\n1. first\n2) second') === 'quoted first second', 'quotes and numbered lists become prose')

// ── quiet progress lines ─────────────────────────────────────────────────────
ok(progressLine('read_file', { path: '/a/b/c.js' }) === 'Reading c.js.', 'read_file names the file')
ok(progressLine('run_command', { command: 'npm test' }) === 'Running: npm test.', 'run_command names the command')
ok(progressLine('mcp__linear__save_issue') === 'Using linear.', 'an MCP tool names its server')
ok(progressLine('browser_click') === 'Working in the browser.', 'browser tools are one phrase')

// ── the session body ─────────────────────────────────────────────────────────
const session = { title: 'Fix the tests', model: 'claude-opus-5', messages: [{ role: 'user', text: 'run the tests' }, { role: 'assistant', parts: [{ type: 'text', text: '**3** failed.' }] }] }
const body = liveSessionBody({ session, settings: { voice: { enabled: true, voice: 'gleam' } }, host: 'Tony’s MBP', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0' })
ok(body.session.model === 'gpt-live-1', 'the live model')
ok(body.session.delegation?.type === 'client', 'client delegation — the thinking stays with Radiant')
ok(body.session.audio?.output?.voice === 'gleam', 'the chosen voice')
ok(body.transport.type === 'webrtc' && /^v=0/.test(body.transport.sdp), 'the offer rides in transport')
ok(/Delegate to the backend/.test(body.session.instructions) && /Fix the tests/.test(body.session.instructions), 'instructions say when to delegate and name the chat')
ok(body.session.input.length === 1 && body.session.input[0].role === 'developer' && /User: run the tests/.test(body.session.input[0].content[0].text) && /3 failed/.test(body.session.input[0].content[0].text), 'recent chat is seeded as a developer message, as prose')
const unknownVoice = liveSessionBody({ session: null, settings: { voice: { enabled: true, voice: 'nope' } }, sdp: 'v=0' })
ok(unknownVoice.session.audio.output.voice === 'marin' && unknownVoice.session.input.length === 0, 'an unknown voice falls back; an empty chat seeds nothing')
ok(liveInstructions({}).length < 1200, 'the live prompt is short — the task prompt is the backend\'s')
ok(seedFrom([]) === '', 'no history, no seed')

// ── refusals say what is missing ─────────────────────────────────────────────
ok(checkVoiceRequest({ settings: {}, apiKey: 'k', sdp: 'v=0' })?.status === 403, 'voice off → refused')
ok(/Settings/.test(checkVoiceRequest({ settings: {}, apiKey: 'k', sdp: 'v=0' }).error), '…and says where to turn it on')
ok(checkVoiceRequest({ settings: { voice: { enabled: true } }, apiKey: '', sdp: 'v=0' })?.status === 400, 'no key → refused')
ok(/OpenAI API key/.test(checkVoiceRequest({ settings: { voice: { enabled: true } }, apiKey: '', sdp: 'v=0' }).error), '…and names the key')
ok(checkVoiceRequest({ settings: { voice: { enabled: true } }, apiKey: 'k', sdp: 'hello' })?.status === 400, 'not an SDP → refused')
ok(checkVoiceRequest({ settings: { voice: { enabled: true } }, apiKey: 'k', sdp: 'v=0\r\n' }) === null, 'all present → allowed')
ok(/ChatGPT sign-in does not cover/.test(checkVoiceRequest({ settings: { voice: { enabled: true } }, apiKey: '', sdp: 'v=0', signedIn: true }).error), 'a subscription-only account is told a sign-in is not a key')
// ⚠️ THE ACTIVE OPENAI ACCOUNT IS A SIGN-IN ON TONY'S MAC. keys.openai is empty
// then, and the key that serves voice is a second account on the roster.
ok(voiceKey({ keys: { openai: 'sk-active' } }) === 'sk-active', 'an active key wins')
ok(voiceKey({ keys: {}, oauth: { openai: {} }, accounts: { openai: [{ id: 'a', oauth: {} }, { id: 'b', key: 'sk-roster' }] } }) === 'sk-roster', 'otherwise any key on the roster serves voice')
ok(voiceKey({ keys: {}, accounts: { openai: [{ id: 'a', oauth: {} }] } }) === null, 'a roster with only sign-ins has no key')

// ── the OpenAI call, with a fake fetch ───────────────────────────────────────
const calls = []
const fake = (status, json) => async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) } }
const good = await createLiveSession({ apiKey: 'sk-test', body, fetchImpl: fake(201, { session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'v=0 answer' } }) })
ok(good.session.id === 'live_1' && good.transport.sdp === 'v=0 answer', 'a 201 returns the id and the answer')
ok(calls[0].url === 'https://api.openai.com/v1/live/sessions', 'POST /v1/live/sessions')
ok(calls[0].init.headers.authorization === 'Bearer sk-test', 'the key goes in the header, on the server')
ok(JSON.parse(calls[0].init.body).session.delegation.type === 'client', 'the body is the one built above')
for (const [status, re] of [[401, /rejected the API key/], [403, /access to GPT-Live/], [429, /rate-limiting/], [500, /refused the voice session \(500\)/]]) {
  let msg = ''
  try { await createLiveSession({ apiKey: 'k', body, fetchImpl: fake(status, { error: { message: 'detail here' } }) }) } catch (e) { msg = e.message }
  ok(re.test(msg) && /detail here/.test(msg), `${status} → a sentence plus OpenAI's detail: ${msg}`)
}
let noSdp = ''
try { await createLiveSession({ apiKey: 'k', body, fetchImpl: fake(201, { session: { id: 'x' } }) }) } catch (e) { noSdp = e.message }
ok(/without an audio answer/.test(noSdp), 'a 201 with no SDP is an error, not a hang')

// ── the backend is told it was spoken to ─────────────────────────────────────
ok(/SPOKEN/.test(VOICE_ADDENDUM) && /two or three plain sentences/.test(VOICE_ADDENDUM) && /Never say an action happened/.test(VOICE_ADDENDUM), 'the addendum asks for a spoken lead and forbids invented success')

console.log(`\n${pass}/${pass + fail} passed  ·  voice: the words cross correctly, the key stays home, refusals say why`)
process.exit(fail ? 1 : 0)
