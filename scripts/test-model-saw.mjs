#!/usr/bin/env node
/**
 * "What the model saw" — the per-round record beside every reply, and the
 * scrubbed environment under every command the model runs.
 *
 * A stub Anthropic provider answers a tool call on round one and text on
 * round two, so the transcript ends up with two records that have to agree
 * with what was actually sent: same system hash (the cache survives), message
 * count grown by exactly one, the tools it was handed, the provider's usage,
 * and nothing of it leaking into the model's own messages.
 */
import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { runTurn } = await import('../server/providers.js')
const { scrubbedEnv } = await import('../server/ollama.js')
let pass = 0, fail = 0
const ok = (n, c, extra = '') => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${extra ? ' — ' + extra : ''}`)) }
const dir = mkdtempSync(join(tmpdir(), 'rx-saw-'))
writeFileSync(join(dir, 'a.txt'), 'hello')

const bodies = []
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c
  bodies.push(JSON.parse(body))
  const n = bodies.length
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const ev = (type, o) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`)
  ev('message_start', { message: { usage: { input_tokens: 1000 * n, cache_read_input_tokens: n === 2 ? 900 : 0, cache_creation_input_tokens: n === 1 ? 800 : 0 } } })
  if (n === 1) {
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 't1', name: 'read_file' } })
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ path: 'a.txt' }) } })
    ev('content_block_stop', { index: 0 })
    ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } })
  } else {
    ev('content_block_start', { index: 0, content_block: { type: 'text' } })
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'done' } })
    ev('content_block_stop', { index: 0 })
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } })
  }
  ev('message_stop', {}); res.end()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const session = { id: 's1', cwd: dir, messages: [{ role: 'user', text: 'read a.txt' }] }
await runTurn({
  provider: { id: 'anthropic', type: 'anthropic', baseUrl: `http://127.0.0.1:${server.address().port}` },
  model: 'claude-opus-5', apiKey: 'x', session,
  useTools: true, computerControl: false, skills: [], persona: 'You are helpful.',
  emit: () => {}, requestApproval: null, signal: new AbortController().signal
})
server.close()

const a = session.messages[session.messages.length - 1]
const sent = a.sent || []
ok('two rounds, two records', sent.length === 2, `${sent.length}`)
ok('the records are not parts (the model never sees them)', !a.parts.some(p => p.type === 'sent' || p.sent))
ok('the model was sent nothing but messages', !JSON.stringify(bodies).includes('systemSha'))
ok('same system hash both rounds — the cache can carry over', sent[0]?.systemSha === sent[1]?.systemSha)
// rounds add PARTS to the one assistant message, so it is the item count that must grow
ok('the conversation grew (appended, not rewritten)', sent[1]?.items > sent[0]?.items && sent[1]?.messages === sent[0]?.messages, `${sent[0]?.items} → ${sent[1]?.items} items`)
ok('the tools it was handed are named', sent[0]?.tools.includes('read_file'))
// input is the whole prompt: fresh + cache write on round one, fresh + cache read on two
ok('the provider usage landed on the round that sent it', sent[0]?.input === 1800 && sent[1]?.input === 2900, `${sent[0]?.input}, ${sent[1]?.input}`)
ok('cache write on round one, cache read on round two', sent[0]?.cacheWrite === 800 && sent[1]?.cacheRead === 900)
ok('output tokens per round', sent[0]?.output === 20 && sent[1]?.output === 3)
ok('the full system text is kept once, on round one', typeof sent[0]?.systemText === 'string' && sent[0].systemText.includes('helpful') && !sent[1]?.systemText)
ok('the model and api are recorded', sent[0]?.model === 'claude-opus-5' && sent[0]?.api === 'messages')

// ── the scrub ──────────────────────────────────────────────────────────────
const e = scrubbedEnv({ PATH: '/x', OPENAI_API_KEY: 'k', GH_TOKEN: 't', MY_SECRET: 's', DB_PASSWORD: 'p', AWS_CREDENTIALS: 'c', SSH_AUTH_SOCK: '/s', HOME: '/h', TERM: 'xterm' })
ok('credential-looking names are gone', !('OPENAI_API_KEY' in e) && !('GH_TOKEN' in e) && !('MY_SECRET' in e) && !('DB_PASSWORD' in e) && !('AWS_CREDENTIALS' in e))
ok('PATH, HOME, TERM and the ssh agent socket stay', e.PATH === '/x' && e.HOME === '/h' && e.TERM === 'xterm' && e.SSH_AUTH_SOCK === '/s')

console.log(`${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
