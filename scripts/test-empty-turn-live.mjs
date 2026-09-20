// A model that goes quiet mid-turn must not end the chat in silence.
//
// ⚠️ Tony, with the press reviewing the product: "models just failing silently
// and stopping mid chat." A fake OpenAI-compatible provider plays the four
// shapes a local model actually produces; the server must, for each, leave a
// sentence in the transcript instead of nothing.
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { parseInlineToolCalls } from '../server/providers.js'
let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })

// pure: inline tool calls in text
const inline = parseInlineToolCalls('Now the workers module:\n<tool_call>\n{"name":"write_file","arguments":{"path":"a.js","content":"x"}}\n</tool_call>')
ok(inline.length === 1 && inline[0].name === 'write_file' && JSON.parse(inline[0].args).path === 'a.js', 'a <tool_call> block in text becomes a call')
ok(parseInlineToolCalls('no calls here').length === 0, 'plain text has none')

// the fake provider: a script of rounds, each either 'empty', 'text', 'length', 'tool', 'inline'
let script = [], seen = []
const prov = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm1-mini' }] })) }
    const b = JSON.parse(body); seen.push(b)
    // ⚠️ HOUSEKEEPING RUNS ON THE CHEAP MODEL AND HITS THIS SAME PROVIDER. Title,
    // memory and skill-idea calls pick m1-mini (a utility hint) and, with no
    // OpenRouter key, land here too. If they shift() the shared script they eat
    // the turn's scripted responses — which is exactly the fixture bug that made
    // this whole test read as a product regression. Only the SESSION model (m1)
    // is scripted; anything else gets benign text and leaves the script alone.
    if (b.model !== 'm1') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 1 } })}\n\n`)
      res.write('data: [DONE]\n\n'); return res.end()
    }
    const kind = script.shift() || 'text'
    // A model that errors outright — the local case Tony keeps hitting: Ollama
    // 500s, or the chat template breaks on the tool results. The turn THROWS.
    if (kind === 'boom') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'the model exploded' } })) }
    // A round that never finishes, so a turn can be interrupted mid-stream the
    // way a closed window or a dropped network interrupts a real one.
    if (kind === 'hang') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'thinking' } }] })}\n\n`)
      return  // deliberately never ends
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
    if (kind === 'empty') chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    if (kind === 'text') { chunk({ choices: [{ delta: { content: 'All done.' } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) }
    if (kind === 'length') { chunk({ choices: [{ delta: { content: 'This reply is cut off mid' } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'length' }] }) }
    if (kind === 'tool') { chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) }
    if (kind === 'inline') { chunk({ choices: [{ delta: { content: 'Reading it:\n<tool_call>\n{"name":"read_file","arguments":{"path":"README.md"}}\n</tool_call>' } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) }
    chunk({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } } })
    res.write('data: [DONE]\n\n'); res.end()
  })
})
const [pp, pr] = [await freePort(), await freePort()]
await new Promise(r => prov.listen(pp, r))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-empty-'))
fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true })
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-ws-')); fs.writeFileSync(path.join(ws, 'README.md'), 'hello')
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ providers: [{ id: 'fakeco', name: 'FakeCo', type: 'openai', baseUrl: `http://127.0.0.1:${pp}/v1`, auth: 'key', removable: true }], keys: { fakeco: 'k' }, oauth: {}, accounts: {}, activeAccount: {}, settings: { autoCompact: false, approvalMode: 'off' } }))
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(pr), RADIANT_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
// ⚠️ SURFACE THE SERVER'S OWN CRASH. A test that only sees ECONNREFUSED from
// its next request cannot say WHY the server went away, and that is the most
// useful line in the run.
srv.stderr.on('data', d => { const t = String(d); if (/Error|error:|throw|at /.test(t)) process.stderr.write('  [server] ' + t) })
srv.on('exit', (code, sig) => process.stderr.write(`  [server] EXITED code=${code} sig=${sig}\n`))
const turn = async (text, useTools = true) => {
  const s = await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'fakeco', model: 'm1', useTools, cwd: ws }) })).json()
  const t = await (await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, content: { text } }) })).text()
  const events = t.split('\n\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)))
  const saved = await (await fetch(`http://127.0.0.1:${pr}/api/sessions/${s.id}`)).json()
  return { events, last: saved.messages[saved.messages.length - 1] }
}
try {
  let up = false
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${pr}/api/config`)).ok } catch {} if (!up) await sleep(250) }
  ok(up, 'server up')

  // 1. tool round, then the model goes quiet once, then finishes when nudged
  script = ['tool', 'empty', 'text']; seen = []
  let r = await turn('do the thing')
  ok(r.events.some(e => e.type === 'notice' && /returned nothing — asked it to continue/.test(e.text)), 'one empty round → a nudge, said in the chat')
  // Housekeeping (m1-mini) also lands in `seen`, so index-by-position is wrong;
  // look across the turn's own (m1) requests for the nudge.
  ok(seen.some(b => b.model === 'm1' && /empty\. Continue the work/.test(JSON.stringify(b.messages))), 'the nudge reaches the model in the next request')
  ok(r.events.some(e => e.type === 'text_delta' && /All done/.test(e.text)), 'and the turn finishes')
  ok(!r.events.some(e => e.type === 'halt'), 'no halt when the nudge works')

  // 2. quiet twice → a halt that explains, in the transcript
  script = ['tool', 'empty', 'empty']
  r = await turn('do the thing')
  const halt = r.events.find(e => e.type === 'halt')
  ok(halt && halt.reason === 'empty' && /returned nothing twice/.test(halt.text), `two empty rounds → halt: ${halt?.text?.slice(0, 80)}`)
  ok(r.last.role === 'assistant' && r.last.parts.some(p => p.type === 'halt'), 'the halt is saved in the message, not only streamed')
  ok(r.events.some(e => e.type === 'done'), 'the stream still ends cleanly')

  // 3. cut off by the output cap
  script = ['length']
  r = await turn('say something long')
  ok(r.events.some(e => e.type === 'notice' && /hit its output limit/.test(e.text)), 'finish_reason=length → the chat is told the reply is incomplete')

  // 4. the tool call written as text runs anyway
  script = ['inline', 'text']
  r = await turn('read the readme')
  ok(r.events.some(e => e.type === 'tool_start' && e.name === 'read_file'), 'an inline <tool_call> runs as a tool')
  ok(r.last.parts.some(p => p.type === 'tool' && /hello/.test(String(p.result))), 'and its result lands in the transcript')

  // 5. usage was requested on the stream
  ok(seen.every(b => b.stream_options?.include_usage === true), 'every request asks for usage on the stream')

  // 6. THE SILENT-DEATH BUG. A turn that throws must leave its reason IN the
  // transcript, not only in a transient banner the next reload wipes. Before
  // the fix the saved assistant message had zero parts and the chat looked like
  // it died for no reason.
  script = ['boom']
  r = await turn('build me something')
  ok(r.events.some(e => e.type === 'halt' && e.reason === 'error' && /exploded/.test(e.text)), 'a thrown turn emits a halt that names the reason')
  ok(r.last.role === 'assistant' && r.last.parts.some(p => p.type === 'halt' && /exploded/.test(p.text)),
     `the reason is SAVED in the message, so a reload still shows it (parts: ${JSON.stringify(r.last.parts.map(p => p.type))})`)
  ok(r.events.some(e => e.type === 'closed'), 'the stream still closes cleanly')

  // 7. THE BILL MUST BE READABLE. An agentic turn re-sends the conversation
  // every round, so input tokens climb into the millions on a chat of a few
  // hundred thousand — that is the loop working. The only thing that says
  // whether it is EXPENSIVE is how much the provider served from its prompt
  // cache, and that number was read off the stream and thrown away, leaving a
  // frightening total the app could not explain. Tony: "that will kill this
  // product if its burning tokens for no reason."
  script = ['text']
  r = await turn('count something')
  ok(r.events.some(e => e.type === 'usage' && e.cacheRead === 80), 'a cache read on the stream reaches the client')
  {
    const st = r.events.filter(e => e.type === 'stats').pop()
    ok(st && st.stats.cachedIn >= 80, `and is summed into the session stats (cachedIn: ${st?.stats?.cachedIn})`)
    ok(st && st.stats.inTokens >= st.stats.cachedIn, 'cached can never exceed total input')
  }

  // 8. HOUSEKEEPING RUNS CHEAP, AND IS COUNTED. Naming the chat, extracting
  // facts and drafting a skill idea are three or four extra model calls per
  // turn. They ran on the CHAT'S model at flagship prices and their usage was
  // dropped, so it was spend nobody could see. Tony: "yes do it."
  {
    script = ['text']; seen = []
    const s3 = await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'fakeco', model: 'm1', useTools: false, cwd: ws }) })).json()
    await (await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s3.id, content: { text: 'make me a thing' } }) })).text()
    await sleep(1200)   // housekeeping runs after the reply
    const used = seen.map(b => b.model)
    ok(used.includes('m1'), `the chat itself used the chosen model (models used: ${JSON.stringify(used)})`)
    ok(used.includes('m1-mini'), 'and the housekeeping used the cheap one from the same provider')
    const saved = await (await fetch(`http://127.0.0.1:${pr}/api/sessions/${s3.id}`)).json()
    ok((saved.stats.bgIn || 0) > 0, `background tokens are counted, not invisible (bgIn: ${saved.stats?.bgIn}, calls: ${saved.stats?.bgCalls})`)
  }

  // 9. THE OTHER HALF OF THE SILENT DEATH. A turn killed by the connection going
  // away threw nothing, and its 'stopped' event is not one of the two the emit
  // wrapper persists — so it saved an assistant message with ZERO parts and the
  // chat showed an empty reply. Same symptom as the thrown-error case, different
  // route; session e0b6fae9 had three of them.
  script = ['hang']
  {
    const s2 = await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'fakeco', model: 'm1', useTools: false, cwd: ws }) })).json()
    const ac = new AbortController()
    // Read the stream until tokens are actually flowing, THEN cut the
    // connection — that is the moment a real window closing interrupts a turn,
    // and it is deterministic where a fixed delay is a race.
    const res2 = await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s2.id, content: { text: 'start something long' } }), signal: ac.signal })
    const reader = res2.body.getReader()
    let flowing = false
    for (let i = 0; i < 40 && !flowing; i++) {
      const { value, done } = await reader.read()
      if (done) break
      if (/"type":"(text_delta|round_start)"/.test(new TextDecoder().decode(value))) flowing = true
    }
    ok(flowing, 'the turn was underway before it was interrupted')
    ac.abort()               // the window closes / the network goes away
    await reader.cancel().catch(() => {})
    await sleep(900)         // let the server's finally write the session
    const saved = await (await fetch(`http://127.0.0.1:${pr}/api/sessions/${s2.id}`)).json()
    const last = saved.messages[saved.messages.length - 1]
    ok(last.role === 'assistant', 'the interrupted turn left an assistant message')
    ok((last.parts || []).length > 0, `and it is NOT empty (parts: ${JSON.stringify((last.parts || []).map(x => x.type))})`)
    const h = (last.parts || []).find(x => x.type === 'halt')
    ok(h && h.reason === 'dropped' && /connection to this turn dropped/.test(h.text), 'it says the connection dropped, and can be continued')
  }
} finally {
  srv.kill(); prov.close(); await sleep(200)
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(ws, { recursive: true, force: true })
}
console.log(`\n${pass}/${pass + fail} passed  ·  a model that goes quiet is nudged, then explained, never silent`)
process.exit(fail ? 1 : 0)
