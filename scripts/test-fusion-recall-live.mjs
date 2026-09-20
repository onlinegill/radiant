// Two SoL-Pi mechanisms (arXiv 2609.20519), driven through the real server
// against a scripted provider.
//
// Action Fusion: an edit that carries a `then` command comes back as ONE tool
// result holding both the write and the command's output — one model round,
// not two. ObservationPack: a result over 10 KiB is kept on disk in full; the
// model can read the exact original back with recall, by page or by search,
// and once the result is old enough to be folded, the fold says so instead of
// "run it again".
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
    const step = script.shift() || { text: 'Done.' }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
    if (step.tool) { chunk(toolCall(step.id, step.tool, typeof step.args === 'function' ? step.args() : step.args)); chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) }
    else { chunk({ choices: [{ delta: { content: step.text } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) }
    chunk({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 7 } })
    res.write('data: [DONE]\n\n'); res.end()
  })
})
const [pp, pr] = [await freePort(), await freePort()]
await new Promise(r => prov.listen(pp, r))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-fusion-'))
fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true })
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-ws-'))
fs.writeFileSync(path.join(ws, 'app.js'), 'const answer = 41\nconsole.log("answer", answer)\n')
// a script whose output is well over 10 KiB, with a needle near the middle
fs.writeFileSync(path.join(ws, 'big.sh'), 'for i in $(seq 1 600); do if [ $i -eq 300 ]; then echo "line $i NEEDLE here"; else echo "line $i of a long log ......................................"; fi; done\n')
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ providers: [{ id: 'fakeco', name: 'FakeCo', type: 'openai', baseUrl: `http://127.0.0.1:${pp}/v1`, auth: 'key', removable: true }], keys: { fakeco: 'k' }, oauth: {}, accounts: {}, activeAccount: {}, settings: { autoCompact: false, approvalMode: 'off', fastLane: false, routing: false } }))
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(pr), RADIANT_DIR: dir, OPENROUTER_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
srv.stderr.on('data', d => { const t = String(d); if (/Error|error:|throw|at /.test(t)) process.stderr.write('  [server] ' + t) })
const turn = async (text, sessionId) => {
  const s = sessionId ? { id: sessionId } : await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'fakeco', model: 'm1', useTools: true, cwd: ws }) })).json()
  const t = await (await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, content: { text } }) })).text()
  const events = t.split('\n\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)))
  const saved = await (await fetch(`http://127.0.0.1:${pr}/api/sessions/${s.id}`)).json()
  return { id: s.id, events, saved, last: saved.messages[saved.messages.length - 1] }
}
try {
  let up = false
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${pr}/api/config`)).ok } catch {} if (!up) await sleep(250) }
  ok(up, 'server up')

  // ── Action Fusion ─────────────────────────────────────────────────────────
  script = [
    { tool: 'edit_file', id: 'e1', args: { path: 'app.js', old_string: '41', new_string: '42', then: 'node app.js' } },
    { text: 'Fixed and verified.' }
  ]
  seen = []
  let r = await turn('fix the answer and run it')
  const part = r.last.parts.find(p => p.type === 'tool' && p.name === 'edit_file')
  ok(part && /Replaced 1 occurrence/.test(part.result), 'the edit happened')
  ok(part && /--- then: node app\.js ---/.test(part.result) && /answer 42/.test(part.result), `and the command ran with the edit, in the same result (${(part?.result || '').slice(0, 120).replace(/\n/g, ' ')})`)
  // Housekeeping (title, memory) also runs on m1 here, without tools; count the turn's own requests.
  const turnReqs = seen.filter(b => (b.tools || []).length)
  ok(turnReqs.length === 2, `edit + check + reply took two model requests, not three (${turnReqs.length})`)
  ok(seen[0].tools.find(t => t.function.name === 'edit_file').function.parameters.properties.then, 'the model is told edit_file takes `then`')
  ok(/pass it as that edit.s `then`/.test(JSON.stringify(seen[0].messages[0])), 'and the instructions suggest it')

  // a failed edit does not run its command
  script = [
    { tool: 'edit_file', id: 'e2', args: { path: 'app.js', old_string: 'NOT THERE', new_string: 'x', then: 'echo SHOULD-NOT-RUN' } },
    { text: 'ok' }
  ]
  r = await turn('bad edit')
  const bad = r.last.parts.find(p => p.type === 'tool' && p.name === 'edit_file')
  ok(bad && /^Error: old_string not found/.test(bad.result) && !/SHOULD-NOT-RUN/.test(bad.result), 'a failed edit does not run its `then`')

  // ── ObservationPack: archive + recall ─────────────────────────────────────
  let handle = null
  script = [
    { tool: 'run_command', id: 'c1', args: { command: 'bash big.sh' } },
    { text: 'That is a lot of output.' }
  ]
  r = await turn('run the big script')
  const big = r.last.parts.find(p => p.type === 'tool' && p.name === 'run_command')
  ok(big && big.archive && /^obs_[0-9a-f]{8}$/.test(big.archive.id) && big.archive.lines >= 600, `a result over 10 KiB is archived with a handle (${JSON.stringify(big?.archive)})`)
  handle = big?.archive?.id
  ok(big && /NEEDLE/.test(big.result), 'the first time, the model still sees the whole thing (under the 40k cap)')

  // recall by find, and by page, in the same session
  script = [
    { tool: 'recall', id: 'r1', args: () => ({ id: handle, find: 'needle' }) },
    { tool: 'recall', id: 'r2', args: () => ({ id: handle, page: 3 }) },
    { tool: 'recall', id: 'r3', args: { id: 'obs_00000000' } },
    { text: 'Found it.' }
  ]
  r = await turn('find the needle', r.id)
  const rc = r.last.parts.filter(p => p.type === 'tool' && p.name === 'recall')
  ok(rc[0] && /1 line\(s\) in obs_[0-9a-f]+ match "needle"/.test(rc[0].result) && /300\tline 300 NEEDLE here/.test(rc[0].result) && /298\t/.test(rc[0].result), `find returns the matching line with context (${(rc[0]?.result || '').slice(0, 80)})`)
  ok(rc[1] && /page 3 of 4/.test(rc[1].result) && /^401\t/m.test(rc[1].result) && /600\tline 600/.test(rc[1].result) && !/601\t/.test(rc[1].result), `a page is 200 numbered lines (${(rc[1]?.result || '').slice(0, 60)})`)
  ok(rc[2] && /Error: nothing is kept under obs_00000000/.test(rc[2].result), 'an unknown handle says so')

  // ── the fold points at the archive, not at "run it again" ─────────────────
  // Results fold by ROUND inside a turn: the big result at round 0, then nine
  // small rounds, and by the last request round 0 is outside the rounds kept
  // whole.
  script = [{ tool: 'run_command', id: 'b2', args: { command: 'bash big.sh' } }]
    .concat(Array.from({ length: 9 }, (_, i) => ({ tool: 'run_command', id: 'f' + i, args: { command: `echo round ${i}` } })))
    .concat([{ text: 'done' }])
  seen = []
  r = await turn('big then many small')
  const lastReq = seen.filter(b => (b.tools || []).length).pop()
  const sent = JSON.stringify(lastReq.messages)
  ok(/recall\(id: \\"obs_[0-9a-f]+\\"\) reads it back/.test(sent), 'once folded, the conversation carries the handle instead of "run it again"')
  ok(!/Run it again if you need the rest/.test(sent), 'and the old wording is gone for an archived result')
  ok(/line 1 of a long log/.test(sent) && /line 600 of a long log/.test(sent), 'the fold keeps the TAIL as well as the head')
  ok(!/line 300 NEEDLE/.test(sent), 'and the middle is what was dropped')
} finally {
  srv.kill(); prov.close(); await sleep(200)
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(ws, { recursive: true, force: true })
}
console.log(`\n${pass}/${pass + fail} passed  ·  an edit carries its check, and a big result is sent once and recalled exactly`)
process.exit(fail ? 1 : 0)
