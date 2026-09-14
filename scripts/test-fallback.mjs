// A turn that fails because the provider is down is rerun on the fallback;
// a turn that fails because of us, or that had already done work, is not.
import { isOutage, shouldFallBack, fallbackNotice } from '../server/fallback.js'
import fs from 'node:fs'
let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }
for (const m of ['503: Service Unavailable', '529 overloaded_error: Overloaded', '429: Rate limit exceeded', 'fetch failed', 'connect ECONNREFUSED 104.18.2.1:443', 'socket hang up', 'The request timed out', '502 Bad Gateway', 'stream error']) ok(isOutage(m), `outage: ${m}`)
for (const m of ['401: Authentication failed — check the API key', '402: insufficient credit', '400: invalid request', '404: model not found', 'The conversation is too long for grok-4.6', 'This API key is restricted']) ok(!isOutage(m), `not an outage: ${m}`)
const cur = { provider: 'xai', model: 'grok-4.6' }, fb = { provider: 'anthropic', model: 'claude-opus-5' }
ok(shouldFallBack({ message: '503: down', assistant: { role: 'assistant', parts: [] }, current: cur, fallback: fb }).ok, 'outage + nothing done + a fallback → rerun')
ok(shouldFallBack({ message: '503: down', assistant: { role: 'assistant', parts: [{ type: 'notice', text: 'Planning…' }] }, current: cur, fallback: fb }).ok, 'a notice is not work')
ok(!shouldFallBack({ message: '503: down', assistant: { role: 'assistant', parts: [{ type: 'tool', name: 'run_command' }] }, current: cur, fallback: fb }).ok, 'a turn that ran a tool is not redone')
ok(!shouldFallBack({ message: '503: down', assistant: { role: 'assistant', parts: [] }, current: cur, fallback: null }).ok, 'no fallback set → no rerun')
ok(!shouldFallBack({ message: '503: down', assistant: { role: 'assistant', parts: [] }, current: cur, fallback: cur }).ok, 'the same model is not a fallback')
ok(!shouldFallBack({ message: '401: Authentication failed', assistant: { role: 'assistant', parts: [] }, current: cur, fallback: fb }).ok, 'an auth failure shows the real error')
const n = fallbackNotice({ current: { ...cur, providerName: 'xAI (Grok)' }, fallback: fb, message: '503: Service Unavailable' })
ok(/grok-4\.6 on xAI \(Grok\) is not answering \(503: Service Unavailable\) — continuing on claude-opus-5/.test(n), `the notice names both models and the reason: ${n}`)
const idx = fs.readFileSync('server/index.js', 'utf8')
ok(/shouldFallBack\(\{ message: e\.message/.test(idx) && /!session\.group/.test(idx), 'the chat route reruns on the fallback, not for group chats')
ok(/fallback \(\$\{fb\.model\}\) failed too/.test(idx), 'and says so when the fallback fails as well')
ok(/If the model is not answering/.test(fs.readFileSync('src/components/Settings.jsx', 'utf8')), 'Settings offers the choice')
console.log(`\n${pass}/${pass + fail} passed  ·  an outage moves the turn to the fallback; our own mistakes do not`)
process.exit(fail ? 1 : 0)
