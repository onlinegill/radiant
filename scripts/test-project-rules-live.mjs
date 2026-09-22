// A workspace's own rules file is loaded into the agent's prompt.
//
// Cline reads .clinerules, Cursor .cursorrules, Claude Code CLAUDE.md — the
// repo's standing instructions, pulled into context so the agent follows the
// project's conventions. Radiant did not; this proves it now does: the rules
// reach the model, the chat says so once, and it can be turned off.
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
let pass = 0, fail = 0
const ok = (c, what) => { if (c) pass++; else { fail++; console.log('  FAIL', what) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })

let seen = []
const prov = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm1-mini' }] })) }
    seen.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 1 } })}\n\n`)
    res.write('data: [DONE]\n\n'); res.end()
  })
})
const [pp, pr] = [await freePort(), await freePort()]
await new Promise(r => prov.listen(pp, r))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-rules-'))
fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true })
// a workspace that is a git repo with an AGENTS.md and a nested subfolder
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-repo-'))
fs.mkdirSync(path.join(ws, '.git'), { recursive: true })
fs.writeFileSync(path.join(ws, 'AGENTS.md'), 'RULE-MARKER: always run the tests with `npm run gate` before shipping.')
fs.mkdirSync(path.join(ws, 'src'), { recursive: true })
const sub = path.join(ws, 'src')
// a plain folder with no rules and no repo
const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-bare-'))
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ providers: [{ id: 'fakeco', name: 'FakeCo', type: 'openai', baseUrl: `http://127.0.0.1:${pp}/v1`, auth: 'key', removable: true }], keys: { fakeco: 'k' }, oauth: {}, accounts: {}, activeAccount: {}, settings: { autoCompact: false, approvalMode: 'off', fastLane: false, routing: false } }))
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(pr), RADIANT_DIR: dir, OPENROUTER_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
srv.stderr.on('data', d => { const t = String(d); if (/Error|error:|throw|at /.test(t)) process.stderr.write('  [server] ' + t) })
const turn = async (cwd, text = 'hi') => {
  const s = await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'fakeco', model: 'm1', useTools: true, cwd }) })).json()
  const t = await (await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, content: { text } }) })).text()
  const events = t.split('\n\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)))
  return { id: s.id, events }
}
const sysOf = b => JSON.stringify(b.messages?.find(m => m.role === 'system') || b.messages?.[0] || b)
try {
  let up = false
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${pr}/api/config`)).ok } catch {} if (!up) await sleep(250) }
  ok(up, 'server up')

  // rules at the workspace root reach the model, and the chat says so once
  seen = []
  let r = await turn(ws)
  const req = seen.find(b => b.model === 'm1')
  ok(req && /RULE-MARKER/.test(sysOf(req)), 'the workspace AGENTS.md is in the system prompt')
  ok(req && /Project rules/.test(sysOf(req)), 'it is labelled as project rules')
  ok(r.events.some(e => e.type === 'notice' && /Loaded this project's rules from AGENTS\.md/.test(e.text)), 'the chat says which rules file was loaded')

  // a nested subfolder still finds the repo-root rules (walks up to .git)
  seen = []
  r = await turn(sub)
  ok(seen.some(b => b.model === 'm1' && /RULE-MARKER/.test(sysOf(b))), 'a subfolder inherits the repo-root rules')

  // a bare folder with no rules loads nothing and says nothing
  seen = []
  r = await turn(bare)
  ok(seen.some(b => b.model === 'm1') && !seen.some(b => /RULE-MARKER|Project rules/.test(sysOf(b))), 'a folder with no rules loads none')
  ok(!r.events.some(e => e.type === 'notice' && /project's rules/.test(e.text)), 'and says nothing about rules')

  // the notice is once per session, not per turn
  seen = []
  const s2 = await (await fetch(`http://127.0.0.1:${pr}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'fakeco', model: 'm1', useTools: true, cwd: ws }) })).json()
  const once = async () => { const t = await (await fetch(`http://127.0.0.1:${pr}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s2.id, content: { text: 'again' } }) })).text(); return t.split('\n\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6))) }
  const e1 = await once(); const e2 = await once()
  ok(e1.some(e => e.type === 'notice' && /project's rules/.test(e.text)), 'first turn announces the rules')
  ok(!e2.some(e => e.type === 'notice' && /project's rules/.test(e.text)), 'the second turn does not repeat it')
  ok(seen.every(b => b.model !== 'm1' || /RULE-MARKER/.test(sysOf(b))), 'but every turn still carries the rules in the prompt')

  // turning it off in settings stops loading
  await fetch(`http://127.0.0.1:${pr}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectRules: false }) })
  seen = []
  r = await turn(ws)
  ok(!seen.some(b => /RULE-MARKER|Project rules/.test(sysOf(b))), 'with the setting off, no rules are loaded')
} finally {
  srv.kill(); prov.close(); await sleep(200)
  for (const d of [dir, ws, bare]) fs.rmSync(d, { recursive: true, force: true })
}
console.log(`\n${pass}/${pass + fail} passed  ·  a workspace's own rules file rides in every turn, announced once, toggleable`)
process.exit(fail ? 1 : 0)
