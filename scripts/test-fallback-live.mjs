// The chat route, end to end: the chat's provider answers 503, the fallback
// answers — the turn continues on the fallback and the chat is told.
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })

// two fake OpenAI-compatible providers: one dead, one alive
const fake = (alive) => http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'm1' }] })) }
    if (!alive) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Service Unavailable' } })) }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
    chunk({ choices: [{ delta: { content: 'Hello from the fallback.' } }] })
    chunk({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })
    res.write('data: [DONE]\n\n'); res.end()
  })
})
const dead = fake(false), live = fake(true)
const [pd, pl, pr] = [await freePort(), await freePort(), await freePort()]
await new Promise(r => dead.listen(pd, r)); await new Promise(r => live.listen(pl, r))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-fallback-'))
fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true })
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  providers: [
    { id: 'deadco', name: 'DeadCo', type: 'openai', baseUrl: `http://127.0.0.1:${pd}/v1`, auth: 'key', removable: true },
    { id: 'liveco', name: 'LiveCo', type: 'openai', baseUrl: `http://127.0.0.1:${pl}/v1`, auth: 'key', removable: true }
  ],
  keys: { deadco: 'k', liveco: 'k' }, oauth: {}, accounts: {}, activeAccount: {},
  settings: { fallback: { provider: 'liveco', model: 'm1' }, autoCompact: false }
}))
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(pr), RADIANT_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
try {
  let up = false
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${pr}/api/config`)).ok } catch {} if (!up) await sleep(250) }
  ok(up, 'the server starts on a fresh folder with two fake providers')
  const s = await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'deadco', model: 'm1', useTools: false }) })).json()
  const res = await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, content: { text: 'hi' } }) })
  const text = await res.text()
  const events = text.split('\n\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)))
  const notice = events.find(e => e.type === 'notice' && /not answering/.test(e.text))
  ok(notice, `the chat is told the model is not answering: ${notice?.text}`)
  ok(/continuing on m1/.test(notice?.text || ''), 'and which model took over')
  ok(events.some(e => e.type === 'text_delta' && /Hello from the fallback/.test(e.text)), 'the fallback answered')
  ok(!events.some(e => e.type === 'error'), 'no error reached the chat')
  const saved = await (await fetch(`http://127.0.0.1:${pr}/api/sessions/${s.id}`)).json()
  const last = saved.messages[saved.messages.length - 1]
  ok(last.role === 'assistant' && last.model === 'm1' && saved.messages.filter(m => m.role === 'assistant').length === 1, `one assistant message, on the fallback model (${last.model})`)
  // the dead provider is our own mistake this time: a 401 must not fall back
  const s2 = await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'deadco', model: 'm1', useTools: false }) })).json()
  dead.removeAllListeners('request'); dead.on('request', (req, res) => { res.writeHead(401); res.end('{"error":{"message":"bad key"}}') })
  const t2 = await (await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s2.id, content: { text: 'hi' } }) })).text()
  const ev2 = t2.split('\n\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)))
  ok(ev2.some(e => e.type === 'error' && /401/.test(e.message)) && !ev2.some(e => e.type === 'notice' && /not answering/.test(e.text)), 'a 401 shows the real error and does not fall back')
} finally {
  srv.kill(); dead.close(); live.close(); await sleep(200)
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${pass}/${pass + fail} passed  ·  a dead provider hands the turn to the fallback, live`)
process.exit(fail ? 1 : 0)
