// A model that says nothing for a long time is not "terminated".
//
// ⚠️ NODE'S fetch TIMES OUT A SILENT BODY AFTER 300 s. A local 27B loading and
// chewing a long prompt is silent longer than that, and the round threw
// `TypeError: terminated` — Tony: "why was this terminated?". This runs the
// server against a provider that is silent for longer than a SHORT timeout
// injected through UNDICI's own knobs, so the test takes seconds, and checks
// the reply arrives whole. The control run, with the default fetch, must fail
// the same way the real one did.
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

const SILENCE_MS = 2500
const prov = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'm1' }] })) }
    // headers now, then nothing at all for SILENCE_MS — the shape of a model still loading
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders()
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Slow but whole.' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
      res.write('data: [DONE]\n\n'); res.end()
    }, SILENCE_MS)
  })
})
const [pp, pr] = [await freePort(), await freePort()]
await new Promise(r => prov.listen(pp, r))

// control: Node's own fetch with a body timeout shorter than the silence dies with "terminated"
{
  const { Agent } = await import('undici')
  const short = new Agent({ headersTimeout: 1000, bodyTimeout: 1000 })
  let msg = ''
  try { const r = await fetch(`http://127.0.0.1:${pp}/v1/chat/completions`, { method: 'POST', body: '{}', dispatcher: short }); await r.text() } catch (e) { msg = `${e.name}: ${e.message} / ${e.cause?.code || ''}` }
  ok(/terminated|UND_ERR_BODY_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/.test(msg), `the control reproduces the failure: ${msg}`)
  // and the agent model calls use has both clocks switched off
  const { PATIENCE } = await import('../server/net.js')
  ok(PATIENCE.headersTimeout === 0 && PATIENCE.bodyTimeout === 0, 'model calls run with no headers or body timeout')
  const prov = fs.readFileSync('server/providers.js', 'utf8')
  ok(!/[^a-zA-Z]fetch\(`\$\{baseUrl\}\/(chat\/completions|v1\/messages)/.test(prov) && /modelFetch\(`\$\{baseUrl\}/.test(prov), 'every provider round goes through modelFetch')
  ok(/modelFetch\(url, opts\)/.test(fs.readFileSync('server/util.js', 'utf8')), 'and so does fetchRetry (the ChatGPT path)')
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-slow-'))
fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true })
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ providers: [{ id: 'slowco', name: 'SlowCo', type: 'openai', baseUrl: `http://127.0.0.1:${pp}/v1`, auth: 'key', removable: true }], keys: { slowco: 'k' }, oauth: {}, accounts: {}, activeAccount: {}, settings: { autoCompact: false } }))
// the server under the SAME short default timeouts: the patient agent in net.js must ignore them
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(pr), RADIANT_DIR: dir, UNDICI_TEST_SHORT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
try {
  let up = false
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${pr}/api/config`)).ok } catch {} if (!up) await sleep(250) }
  ok(up, 'server up')
  const s = await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'slowco', model: 'm1', useTools: false }) })).json()
  const t = await (await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, content: { text: 'hi' } }) })).text()
  const ev = t.split('\n\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)))
  ok(ev.some(e => e.type === 'text_delta' && /Slow but whole/.test(e.text)), 'the reply arrives after the silence')
  ok(!ev.some(e => e.type === 'error'), `no error: ${ev.filter(e => e.type === 'error').map(e => e.message).join(' | ')}`)
  ok(ev.some(e => e.type === 'done'), 'and the turn ends cleanly')
} finally { srv.kill(); prov.close(); await sleep(200); fs.rmSync(dir, { recursive: true, force: true }) }
console.log(`\n${pass}/${pass + fail} passed  ·  a silent model is waited for, not terminated`)
process.exit(fail ? 1 : 0)
