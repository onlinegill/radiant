/**
 * What carries a cache breakpoint, and what must never carry one.
 *
 * ⚠️ THE FIRST VERSION OF THIS FEATURE WOULD HAVE COST MONEY AND SAVED NOTHING.
 * Prompt caching matches on an exact byte prefix. The breakpoint was placed on a
 * system prefix that included retrieved memory facts — which memory.js scores
 * against the CURRENT turn's text, so they differ almost every turn. Every
 * request would have written a fresh cache at 1.25x and read none of it back:
 * strictly worse than shipping no caching at all, for exactly the users it was
 * meant to help. It was caught in review rather than in a bill.
 *
 * That failure is invisible from the outside — the feature "works", requests
 * succeed, and the only symptom is a number nobody is looking at. So it is
 * pinned here as a property of the request we send: the volatile half sits
 * AFTER the marked block and is never marked itself.
 */
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { runTurn } = await import('../server/providers.js')
let pass = 0, fail = 0
const results = []
const ok = (n, c, extra = '') => { c ? pass++ : (fail++, results.push(`  FAIL ${n}${extra ? ' — ' + extra : ''}`)) }
const dir = mkdtempSync(join(tmpdir(), 'rx-cache-'))

/** Run one turn against a stub and hand back the request body it sent. */
async function capture ({ type, providerId, model, cachingEnabled, cacheTtl, memory }) {
  let sent = null, headers = null
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c
    if (!sent) { sent = JSON.parse(body); headers = req.headers }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (type === 'anthropic') {
      res.write('event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 5 } } }) + '\n\n')
      res.write('event: content_block_start\ndata: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }) + '\n\n')
      res.write('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) + '\n\n')
      res.write('event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n')
    } else {
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }) + '\n\n')
    }
    res.write('data: [DONE]\n\n'); res.end()
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  await runTurn({
    provider: { id: providerId, type, baseUrl: `http://127.0.0.1:${server.address().port}` },
    model, apiKey: 'x',
    session: { cwd: dir, messages: [{ role: 'user', text: 'go' }] },
    useTools: true, computerControl: false, skills: [], persona: 'You are helpful.',
    memory: memory || null, cachingEnabled, cacheTtl,
    emit: () => {}, requestApproval: null, signal: new AbortController().signal
  })
  server.close()
  return { body: sent, headers }
}

const marks = o => JSON.stringify(o || {}).split('"cache_control"').length - 1

// ── the Anthropic path ──────────────────────────────────────────────────────
const FACTS = ['Tony prefers tabs over spaces', 'Tony ships Radiant from a Mac']
const { body: an } = await capture({ type: 'anthropic', providerId: 'anthropic', model: 'claude-opus-5', memory: FACTS })
ok('the system prompt is sent as blocks, not a bare string', Array.isArray(an.system))
ok('caching is on by default', marks(an.system) >= 1)

const marked = an.system.filter(b => b.cache_control)
ok('exactly one system block carries the breakpoint', marked.length === 1, `${marked.length} marked`)

// ⚠️ THE BUG THIS FEATURE ALMOST SHIPPED WITH.
const volatileBlocks = an.system.filter(b => FACTS.some(f => (b.text || '').includes(f)))
ok('the remembered facts are in the request at all', volatileBlocks.length === 1)
ok('...but NOT in the marked block — they change every turn, so a breakpoint there caches nothing',
   !FACTS.some(f => marked[0].text.includes(f)))
ok('...and they sit AFTER it, so their churn cannot reach the cached prefix',
   an.system.indexOf(volatileBlocks[0]) > an.system.indexOf(marked[0]))

ok('the message tail is cached by the documented top-level field', !!an.cache_control)

const { body: anOff } = await capture({ type: 'anthropic', providerId: 'anthropic', model: 'claude-opus-5', cachingEnabled: false, memory: FACTS })
ok('turning caching off marks nothing at all', marks(anOff.system) === 0 && !anOff.cache_control)
ok('and the prompt still carries everything it did before',
   FACTS.every(f => JSON.stringify(anOff.system).includes(f)))

const { headers: h1 } = await capture({ type: 'anthropic', providerId: 'anthropic', model: 'claude-opus-5', cacheTtl: '1h' })
ok('a one-hour cache asks for the beta header that enables it',
   (h1['anthropic-beta'] || '').includes('extended-cache-ttl'))
const { headers: h5 } = await capture({ type: 'anthropic', providerId: 'anthropic', model: 'claude-opus-5' })
ok('and the five-minute default does not', !(h5['anthropic-beta'] || '').includes('extended-cache-ttl'))

// ── the OpenAI-shaped paths ─────────────────────────────────────────────────
// OpenRouter passes Anthropic breakpoints through to Claude models. Nothing
// else on this path does, and an unrecognised field can be rejected outright.
const or = await capture({ type: 'openai', providerId: 'openrouter', model: 'anthropic/claude-opus-5' })
ok('OpenRouter Claude models are marked', marks(or.body.messages) >= 1)

const orPlain = await capture({ type: 'openai', providerId: 'openrouter', model: 'openai/gpt-5' })
ok('a non-Claude model on OpenRouter is not', marks(orPlain.body.messages) === 0)

const other = await capture({ type: 'openai', providerId: 'together', model: 'claude-opus-5' })
ok('and neither is a Claude-shaped name on some other provider', marks(other.body.messages) === 0)

// ⚠️ ONE SWITCH, EVERY PATH IT NAMES. Settings calls it "Prompt caching (Claude
// models)", and OpenRouter's Claude models are Claude models. Reading the flag
// in anthropicRound alone left this path caching after the user turned caching
// off — a switch that governs one provider and silently not another is worse
// than no switch, because you cannot tell which half you got.
const orOff = await capture({ type: 'openai', providerId: 'openrouter', model: 'anthropic/claude-opus-5', cachingEnabled: false })
ok('turning caching off reaches OpenRouter too, not just the Anthropic path',
   marks(orOff.body.messages) === 0)

// ── the ChatGPT sign-in path ────────────────────────────────────────────────
// ⚠️ THE CACHE WAS NEVER HIT HERE, AND NOTHING SAID SO. OpenAI routes a request
// to its prompt cache by prompt_cache_key and the session_id header. This path
// sent a fresh random session_id on every round and no key at all — a 17k-token
// prefix identical from round to round was billed in full every time, and the
// usage event did not carry cached_tokens, so the "% cached" readout could not
// reveal it. Found by the harness benchmark: 286k input tokens, 0 cached, on a
// 13-round task. Two rounds through a stub, same key both times.
{
  const seen = []
  const stub = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c
    seen.push({ body: JSON.parse(body), headers: req.headers })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (seen.length === 1) {
      // round 1: ask for a tool, so a round 2 happens
      res.write('data: ' + JSON.stringify({ type: 'response.output_item.added', item: { id: 'i1', type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '' } }) + '\n\n')
      res.write('data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'i1', delta: JSON.stringify({ path: 'README.md' }) }) + '\n\n')
      res.write('data: ' + JSON.stringify({ type: 'response.output_item.done', item: { id: 'i1', type: 'function_call', call_id: 'c1', name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) } }) + '\n\n')
      res.write('data: ' + JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 17508, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20 } } }) + '\n\n')
    } else {
      res.write('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'done' }) + '\n\n')
      res.write('data: ' + JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 17816, input_tokens_details: { cached_tokens: 17408 }, output_tokens: 5 } } }) + '\n\n')
    }
    res.end()
  })
  await new Promise(r => stub.listen(0, '127.0.0.1', r))
  process.env.RADIANT_CHATGPT_BASE = `http://127.0.0.1:${stub.address().port}`
  const { runTurn: runTurn2 } = await import('../server/providers.js?chatgpt')
  const session = { id: 'sess-123', cwd: dir, messages: [{ role: 'user', text: 'go' }] }
  const usage = []
  await runTurn2({
    provider: { id: 'openai', type: 'openai', baseUrl: 'https://api.openai.com/v1' },
    model: 'gpt-5.6-sol', apiKey: null, getAccessToken: async () => 'tok', getAccountId: () => 'acct',
    session, useTools: true, computerControl: false, skills: [], persona: '',
    emit: ev => { if (ev.type === 'usage') usage.push(ev) }, requestApproval: null, signal: new AbortController().signal
  })
  stub.close()
  ok('the ChatGPT path made two rounds through the stub', seen.length === 2, `${seen.length}`)
  ok('every round names the SAME prompt_cache_key', seen.length === 2 && seen[0].body.prompt_cache_key === 'sess-123' && seen[1].body.prompt_cache_key === 'sess-123')
  ok('and the SAME session_id header — a fresh one per round is a cache miss per round',
     seen.length === 2 && seen[0].headers.session_id === seen[1].headers.session_id && seen[0].headers.session_id === 'sess-123')
  const cached = usage.filter(u => u.cacheRead)
  ok('the cached share reaches the usage event', cached.length === 1 && cached[0].cacheRead === 17408, JSON.stringify(usage))
  ok('so the session counts it', session.stats?.cachedIn === 17408, JSON.stringify(session.stats))
}

// ── the Anthropic path reports the split, not just the total ───────────────
{
  const stub = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 100, cache_creation_input_tokens: 2000, cache_read_input_tokens: 15000 } } }) + '\n\n')
    res.write('event: content_block_start\ndata: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }) + '\n\n')
    res.write('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) + '\n\n')
    res.write('event: message_stop\ndata: ' + JSON.stringify({ type: 'message_stop' }) + '\n\n')
    res.end()
  })
  await new Promise(r => stub.listen(0, '127.0.0.1', r))
  const session = { cwd: dir, messages: [{ role: 'user', text: 'go' }] }
  const usage = []
  await runTurn({
    provider: { id: 'anthropic', type: 'anthropic', baseUrl: `http://127.0.0.1:${stub.address().port}` },
    model: 'claude-sonnet-5', apiKey: 'x', session, useTools: true, computerControl: false, skills: [], persona: '',
    emit: ev => { if (ev.type === 'usage') usage.push(ev) }, requestApproval: null, signal: new AbortController().signal
  })
  stub.close()
  const u = usage.find(x => x.input)
  ok('Anthropic usage still reports the whole prompt as input (the gauge needs it)', u?.input === 17100, JSON.stringify(u))
  ok('...and the cached read separately — a Claude subscription showed no "% cached" without it', u?.cacheRead === 15000)
  ok('...and the cache write, which is billed at 1.25x and cannot be priced from the total', u?.cacheWrite === 2000)
  // (>=: the turn's housekeeping call hits the same stub and counts too)
  ok('the session keeps both', session.stats?.cachedIn >= 15000 && session.stats?.cacheWrite >= 2000, JSON.stringify(session.stats))
}

// ── each round's request is the previous one plus a tail ────────────────────
// ⚠️ THE CONVERSATION WAS REWRITTEN EVERY ROUND. Every tool call of a turn was
// folded into ONE assistant message, so round three sent assistant:[A, B]
// where round two had sent assistant:[A] — a different block at the same
// position, and the cache matched nothing past the system prompt. Measured:
// 7% cached on a Claude subscription against Claude Code's 93%, and four times
// the cost for the same answers. Three rounds through a stub; every request
// must begin with the whole of the one before it.
{
  const seen = []
  const stub = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c
    const b = JSON.parse(body); seen.push(b)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const w = ev => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
    w({ type: 'message_start', message: { usage: { input_tokens: 5 } } })
    const n = seen.length
    if (n <= 2) {
      // round 1 asks for one read; round 2 asks for TWO in parallel
      const calls = n === 1 ? ['r1'] : ['r2a', 'r2b']
      calls.forEach((id, i) => {
        w({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id, name: 'read_file' } })
        w({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ path: id + '.txt' }) } })
        w({ type: 'content_block_stop', index: i })
      })
      w({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } })
    } else {
      w({ type: 'content_block_start', index: 0, content_block: { type: 'text' } })
      w({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } })
      w({ type: 'content_block_stop', index: 0 })
      w({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })
    }
    w({ type: 'message_stop' }); res.end()
  })
  await new Promise(r => stub.listen(0, '127.0.0.1', r))
  const session = { cwd: dir, messages: [{ role: 'user', text: 'read things' }] }
  await runTurn({
    provider: { id: 'anthropic', type: 'anthropic', baseUrl: `http://127.0.0.1:${stub.address().port}` },
    model: 'claude-sonnet-5', apiKey: 'x', session, useTools: true, computerControl: false, skills: [], persona: '',
    emit: () => {}, requestApproval: null, signal: new AbortController().signal
  })
  stub.close()
  const rounds = seen.filter(b => Array.isArray(b.tools) && b.tools.length)   // the turn's own calls, not the housekeeping after it
  ok('three rounds reached the stub', rounds.length === 3, JSON.stringify(rounds.map(b => ({ model: b.model, msgs: b.messages.length, tools: (b.tools || []).length, last: JSON.stringify(b.messages.at(-1)).slice(0, 120) }))))
  const msgs = rounds.map(b => b.messages)
  ok('round two carries round one\'s call as its own assistant message, then its result',
     msgs[1]?.length === 3 && msgs[1][1].role === 'assistant' && msgs[1][1].content.filter(c => c.type === 'tool_use').length === 1 && msgs[1][2].role === 'user')
  ok('round three begins with EXACTLY what round two sent — a prefix the cache can match',
     msgs[2] && JSON.stringify(msgs[2].slice(0, msgs[1].length)) === JSON.stringify(msgs[1]), JSON.stringify(msgs[2]?.slice(0, 3)).slice(0, 300))
  ok('and adds the second round as new messages after it', msgs[2]?.length === 5)
  ok('two calls made in the same round stay together in one assistant message',
     msgs[2]?.[3]?.content.filter(c => c.type === 'tool_use').length === 2 && msgs[2]?.[4]?.content.filter(c => c.type === 'tool_result').length === 2)
}

console.log(results.join('\n'))
console.log(`\n${pass}/${pass + fail} passed  ·  the cached half never moves, and the switch reaches every path`)
process.exit(fail ? 1 : 0)
