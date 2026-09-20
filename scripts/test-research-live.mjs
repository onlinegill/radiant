// Read-only research subagents (the `research` tool, TG-514), driven through
// the real server against a scripted provider.
//
// What must hold: the main model sees a `research` tool; each question becomes
// its own sub-turn on the CHEAP model with only read_file + run_command; a
// subagent that tries to write, or to run a command that could change
// something, is refused; the answers come back as one tool result; and each
// subagent's tokens are shown on the part and counted on the session.
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

// The fake provider answers by MODEL. The main model (m1) calls research once,
// then finishes. Each subagent request on m1-mini follows its own script,
// keyed by the question text it was asked, so the two can run interleaved.
let seen = []
let mainScript = []
const subScripts = {}
const toolCall = (id, name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] })
const prov = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm1-mini' }] })) }
    const b = JSON.parse(body); b._at = Date.now(); seen.push(b)
    let step
    if (b.model === 'm1') step = mainScript.shift() || { text: 'Done.' }
    else {
      const q = b.messages.find(m => m.role === 'user')?.content
      const key = typeof q === 'string' ? q : JSON.stringify(q)
      const list = Object.entries(subScripts).find(([k]) => key.includes(k))?.[1] || []
      step = list.shift() || { text: 'Answer: nothing found.' }
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
    if (step.tool) { chunk(toolCall(step.id || 'c' + Math.random().toString(36).slice(2, 6), step.tool, step.args)); chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) }
    else { chunk({ choices: [{ delta: { content: step.text } }] }); chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) }
    chunk({ choices: [], usage: { prompt_tokens: step.tokens || 100, completion_tokens: 7 } })
    res.write('data: [DONE]\n\n'); res.end()
  })
})
const [pp, pr] = [await freePort(), await freePort()]
await new Promise(r => prov.listen(pp, r))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-research-'))
fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true })
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-ws-')); fs.writeFileSync(path.join(ws, 'README.md'), 'hello from the readme')
const secret = path.join(os.tmpdir(), 'radiant-outside-' + process.pid + '.txt'); fs.writeFileSync(secret, 'not for subagents')
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ providers: [{ id: 'fakeco', name: 'FakeCo', type: 'openai', baseUrl: `http://127.0.0.1:${pp}/v1`, auth: 'key', removable: true }], keys: { fakeco: 'k' }, oauth: {}, accounts: {}, activeAccount: {}, settings: { autoCompact: false, approvalMode: 'off', fastLane: false, routing: false } }))
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(pr), RADIANT_DIR: dir, OPENROUTER_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
srv.stderr.on('data', d => { const t = String(d); if (/Error|error:|throw|at /.test(t)) process.stderr.write('  [server] ' + t) })
srv.on('exit', (code, sig) => process.stderr.write(`  [server] EXITED code=${code} sig=${sig}\n`))
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

  // Two questions. Subagent A reads the readme, then is refused a write and a
  // destructive command, then answers. Subagent B runs a read-only command,
  // tries to read outside the workspace, then answers.
  mainScript = [
    { tool: 'research', id: 'r1', args: { questions: ['where is the greeting?', 'what files are here?'] } },
    { text: 'Research says: the greeting is in README.md.' }
  ]
  subScripts['where is the greeting'] = [
    { tool: 'read_file', args: { path: 'README.md' }, tokens: 200 },
    { tool: 'write_file', args: { path: 'NOTES.md', content: 'x' } },
    { tool: 'run_command', args: { command: 'rm -rf README.md' } },
    { text: 'Answer: README.md:1 has the greeting.\n\nFiles that matter:\n- README.md:1 — the greeting', tokens: 300 }
  ]
  subScripts['what files are here'] = [
    { tool: 'run_command', args: { command: 'ls' }, tokens: 150 },
    { tool: 'read_file', args: { path: secret } },
    { text: 'Answer: just README.md.\n\nFiles that matter:\n- README.md — the only file' }
  ]
  const r = await turn('find the greeting')

  // 1. the main model was offered the tool, and nothing else was harmed
  const mainReq = seen.find(b => b.model === 'm1')
  const mainTools = (mainReq?.tools || []).map(t => t.function?.name)
  ok(mainTools.includes('research'), `the main model is offered research (tools: ${mainTools.join(', ')})`)
  ok(mainTools.includes('write_file'), 'and keeps its own full tool set')

  // 2. each question ran on the cheap model with only the read-only tools
  // Housekeeping (title, memory) runs on the cheap model too, after the turn,
  // without tools; the subagents are the cheap-model requests WITH tools.
  const subReqs = seen.filter(b => b.model === 'm1-mini' && (b.tools || []).length)
  ok(subReqs.length >= 5, `subagents ran on the cheap model (${subReqs.length} requests on m1-mini)`)
  const subTools = [...new Set(subReqs.flatMap(b => (b.tools || []).map(t => t.function?.name)))].sort()
  ok(subTools.join(',') === 'read_file,run_command', `subagents see only read_file and run_command (saw: ${subTools.join(', ')})`)
  ok(!subReqs.some(b => JSON.stringify(b.messages).includes('find the greeting')), 'a subagent does not see the main conversation')
  ok(subReqs.some(b => /read-only shell commands/.test(JSON.stringify(b.messages[0]))), 'the subagent is told it is read-only in its instructions')

  // 3. the refusals reached the subagent as tool results, and nothing changed
  const subMsgs = JSON.stringify(subReqs.map(b => b.messages))
  ok(/not available to a research subagent/.test(subMsgs), 'write_file is refused with a reason')
  ok(/could change something/.test(subMsgs), 'rm -rf is refused with a reason')
  ok(/outside the workspace/.test(subMsgs), 'a read outside the workspace is refused with a reason')
  ok(fs.existsSync(path.join(ws, 'README.md')) && !fs.existsSync(path.join(ws, 'NOTES.md')), 'the workspace is untouched')
  ok(/hello from the readme/.test(subMsgs), 'an in-workspace read works')

  // 4. the answers came home as one tool result, with per-subagent accounting
  const part = (r.last.parts || []).find(p => p.type === 'tool' && p.name === 'research')
  ok(part && /1\. where is the greeting\?/.test(part.result) && /2\. what files are here\?/.test(part.result), 'the tool result carries both answers, numbered')
  ok(part && /README\.md:1 has the greeting/.test(part.result), 'with the subagent\'s answer text')
  ok(Array.isArray(part?.subagents) && part.subagents.length === 2, 'the part records one row per subagent')
  const a = part?.subagents?.find(s => /greeting/.test(s.question))
  ok(a && a.model === 'm1-mini' && a.inTokens === 200 + 100 + 100 + 300 && a.outTokens === 28 && a.tools === 3, `each row has its model and tokens (A: ${JSON.stringify(a)})`)
  ok(a && a.ms >= 0 && a.rounds === 4, 'and its time and rounds')
  ok(!('answer' in (a || {})), 'the answer is not duplicated onto the row')
  const ev = r.events.find(e => e.type === 'tool_result' && e.id === 'r1')
  ok(ev && Array.isArray(ev.subagents) && ev.subagents.length === 2, 'the live stream carries the rows too')
  ok(r.events.some(e => e.type === 'notice' && /Researching 2 questions in parallel on m1-mini/.test(e.text)), 'the chat says research is running, and on what')

  // 5. spend is counted on the session, separately from the chat's own model
  ok(r.saved.stats.researchIn === 700 + 250 + 100 && r.saved.stats.researchCalls === 2, `research tokens are counted on the session (researchIn: ${r.saved.stats.researchIn}, calls: ${r.saved.stats.researchCalls})`)
  ok(r.saved.stats.inTokens === 200, `and NOT into the chat's own input count (inTokens: ${r.saved.stats.inTokens})`)
  ok(r.events.some(e => e.type === 'text_delta' && /Research says/.test(e.text)), 'the main turn finishes with the research in hand')

  // 6. the two ran at once: both first requests were in before either answered
  const firstOf = k => subReqs.find(b => JSON.stringify(b.messages.find(m => m.role === 'user')?.content).includes(k))
  const lastOf = k => [...subReqs].reverse().find(b => JSON.stringify(b.messages.find(m => m.role === 'user')?.content).includes(k))
  ok(firstOf('files are here')._at < lastOf('greeting')._at && firstOf('greeting')._at < lastOf('files are here')._at,
    `the questions ran in parallel, not one after the other (${subReqs.map(b => (JSON.stringify(b.messages.find(m => m.role === 'user')?.content).match(/greeting|files/) || [])[0] + '@' + (b._at - subReqs[0]._at) + 'ms').join(' ')})`)
} finally {
  srv.kill(); prov.close(); await sleep(200)
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(secret, { force: true })
}
console.log(`\n${pass}/${pass + fail} passed  ·  research fans out to read-only subagents on the cheap model and comes home as one result`)
process.exit(fail ? 1 : 0)
