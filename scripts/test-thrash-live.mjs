// A turn that cannot get a command to succeed is stopped early, not at 12M tokens.
//
// ⚠️ Tony watched an agent spend 194 rounds and 12M tokens fighting a Vitest/Vite
// version mismatch — varying the command every round (install, reinstall,
// downgrade, trace) so the identical-call breaker never fired, and failing every
// time. Only the per-turn token ceiling stopped it. This drives failing commands
// through the real server and asserts the thrash-breaker halts the turn long
// before that, with a message a person can act on.
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

let script = [], seen = []
const toolCall = (id, name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] })
const prov = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'm1' }] })) }
    const b = JSON.parse(body); seen.push(b)
    // only the session model is scripted; a housekeeping model call gets benign text
    if (b.model !== 'm1') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`); res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`); res.write('data: [DONE]\n\n'); return res.end() }
    const step = script.shift() || { text: 'Done.' }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
    if (step.tool) { chunk(toolCall(step.id, step.tool, step.args)); chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) }
    else { chunk({ choices: [{ delta: { content: step.text } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) }
    chunk({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 5 } })
    res.write('data: [DONE]\n\n'); res.end()
  })
})
const [pp, pr] = [await freePort(), await freePort()]
await new Promise(r => prov.listen(pp, r))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-thrash-'))
fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true })
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-ws-'))
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ providers: [{ id: 'fakeco', name: 'FakeCo', type: 'openai', baseUrl: `http://127.0.0.1:${pp}/v1`, auth: 'key', removable: true }], keys: { fakeco: 'k' }, oauth: {}, accounts: {}, activeAccount: {}, settings: { autoCompact: false, approvalMode: 'off', fastLane: false, routing: false } }))
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(pr), RADIANT_DIR: dir, OPENROUTER_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
srv.stderr.on('data', d => { const t = String(d); if (/Error|error:|throw|at /.test(t)) process.stderr.write('  [server] ' + t) })
const turn = async text => {
  const s = await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'fakeco', model: 'm1', useTools: true, cwd: ws }) })).json()
  const t = await (await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, content: { text } }) })).text()
  const events = t.split('\n\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)))
  const saved = await (await fetch(`http://127.0.0.1:${pr}/api/sessions/${s.id}`)).json()
  return { events, saved, last: saved.messages[saved.messages.length - 1] }
}
try {
  let up = false
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${pr}/api/config`)).ok } catch {} if (!up) await sleep(250) }
  ok(up, 'server up')

  // ── 30 varying, always-failing commands; the breaker should stop it near 16 ──
  script = Array.from({ length: 30 }, (_, i) => ({ tool: 'run_command', id: 'c' + i, args: { command: `echo attempt ${i} && exit 1` } }))
    .concat([{ text: 'somehow done' }])
  const r = await turn('fix the build')
  const halt = r.events.find(e => e.type === 'halt' && e.reason === 'stuck')
  ok(halt, 'a run of failing commands halts the turn as stuck')
  ok(halt && /mostly failed/.test(halt.text), `the halt explains it was failing commands, not a repeated call (${(halt?.text || '').slice(0, 70)})`)
  const ran = r.last.parts.filter(p => p.type === 'tool' && p.name === 'run_command').length
  ok(ran <= 17, `it stopped near the window, not after all 30 (ran ${ran})`)
  ok(ran >= 13, `and only after enough failures to be sure, not on the first stumble (ran ${ran})`)
  // the earlier one-time reminder reached the model
  const nudged = r.events.some(e => e.type === 'tool_result' && /recent commands keep failing/.test(String(e.result || '')))
  ok(nudged, 'a reminder is given before the halt')
  ok(r.events.some(e => e.type === 'done'), 'the stream still ends cleanly')
  ok(r.last.parts.some(p => p.type === 'halt'), 'the halt is saved in the transcript for Continue')

  // ── a healthy turn is NOT stopped: commands that succeed never trip it ───────
  script = Array.from({ length: 20 }, (_, i) => ({ tool: 'run_command', id: 'g' + i, args: { command: `echo ok ${i}` } }))
    .concat([{ text: 'all good' }])
  const r2 = await turn('do a lot of real work')
  ok(!r2.events.some(e => e.type === 'halt' && e.reason === 'stuck'), 'twenty succeeding commands are never called a thrash')
  ok(r2.events.some(e => e.type === 'text_delta' && /all good/.test(e.text)), 'and the turn finishes normally')

  // ── a few failures among successes is normal work, not a thrash ──────────────
  script = Array.from({ length: 18 }, (_, i) => ({ tool: 'run_command', id: 'm' + i, args: { command: i % 4 === 0 ? `echo oops ${i} && exit 1` : `echo ok ${i}` } }))
    .concat([{ text: 'finished with a couple of retries' }])
  const r3 = await turn('build with the odd failure')
  ok(!r3.events.some(e => e.type === 'halt' && e.reason === 'stuck'), 'occasional failures among successes do not halt')
  ok(r3.events.some(e => e.type === 'text_delta' && /finished/.test(e.text)), 'that turn finishes too')
} finally {
  srv.kill(); prov.close(); await sleep(200)
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(ws, { recursive: true, force: true })
}
console.log(`\n${pass}/${pass + fail} passed  ·  a turn that cannot get a command to work is stopped early, not at the token ceiling`)
process.exit(fail ? 1 : 0)
