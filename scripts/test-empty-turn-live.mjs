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
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'm1' }] })) }
    const b = JSON.parse(body); seen.push(b)
    const kind = script.shift() || 'text'
    // A model that errors outright — the local case Tony keeps hitting: Ollama
    // 500s, or the chat template breaks on the tool results. The turn THROWS.
    if (kind === 'boom') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'the model exploded' } })) }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
    if (kind === 'empty') chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    if (kind === 'text') { chunk({ choices: [{ delta: { content: 'All done.' } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) }
    if (kind === 'length') { chunk({ choices: [{ delta: { content: 'This reply is cut off mid' } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'length' }] }) }
    if (kind === 'tool') { chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) }
    if (kind === 'inline') { chunk({ choices: [{ delta: { content: 'Reading it:\n<tool_call>\n{"name":"read_file","arguments":{"path":"README.md"}}\n</tool_call>' } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) }
    chunk({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 5 } })
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
  ok(/empty\. Continue the work/.test(JSON.stringify(seen[2]?.messages?.[0] || seen[2])), 'the nudge reaches the model in the next request')
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
} finally {
  srv.kill(); prov.close(); await sleep(200)
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(ws, { recursive: true, force: true })
}
console.log(`\n${pass}/${pass + fail} passed  ·  a model that goes quiet is nudged, then explained, never silent`)
process.exit(fail ? 1 : 0)
