// A decision model can make the app cheaper; it must never make it work less.
//
// ⚠️ ONE ENABLED MCP SERVER WAS 16.6K TOKENS ON EVERY MODEL CALL. Jev decides,
// per message, which servers' tools to attach. These are the rules that keep
// that from ever costing a capability: everything attaches when nothing can
// decide; a server already in use stays; a borderline answer attaches; and the
// request Jev gets is the endpoint's documented shape.
import http from 'node:http'
let pass = 0, fail = 0
const ok = (n, c, extra = '') => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${extra ? ' — ' + extra : ''}`)) }

// the stub must be in place before the module reads the URL
const seen = []
let reply = () => ({ answers: {} })
const stub = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c
  const b = JSON.parse(body); seen.push({ headers: req.headers, body: b })
  const r = reply(b)
  if (r === 'boom') { res.writeHead(500); return res.end('nope') }
  if (r === 'hang') return   // never answers
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r))
})
await new Promise(r => stub.listen(0, '127.0.0.1', r))
process.env.RADIANT_DECISIONS_URL = `http://127.0.0.1:${stub.address().port}/decisions`
const { decide, chooseMcpServers, describeServer, DECISION_MODEL } = await import('../server/decide.js')

const servers = [{ id: 'mcp-linear', name: 'Linear', enabled: true }, { id: 'mcp-gh', name: 'GitHub', enabled: true }, { id: 'mcp-off', name: 'Old', enabled: false }]
const toolsByServer = { 'mcp-linear': ['mcp__mcp-linear__list_issues', 'mcp__mcp-linear__save_issue'], 'mcp-gh': ['mcp__mcp-gh__create_pr'] }
const ids = r => [...r.attach].sort()

// ── nothing to decide with → everything, exactly as before ──────────────────
{
  const r = await chooseMcpServers({ message: 'fix the bug', servers, toolsByServer, decideFn: decide, apiKey: '' })
  ok('no OpenRouter key: every enabled server attaches', JSON.stringify(ids(r)) === '["mcp-gh","mcp-linear"]' && !r.decided)
  ok('and the disabled one never does', !r.attach.has('mcp-off'))
  ok('and Jev was not even asked', seen.length === 0)
}

// ── the request is the endpoint's documented shape ──────────────────────────
reply = b => ({ answers: Object.fromEntries(Object.keys(b.questions).map(k => [k, { type: 'noul', noul: k === 'mcp-linear' ? 0.97 : 0.02 }])), usage: { input_tokens: 40, output_tokens: 0, cost: 0.00002 } })
{
  const r = await chooseMcpServers({ message: 'Mark TG-473 as done in Linear', history: [{ role: 'user', text: 'earlier' }], servers, toolsByServer, decideFn: decide, apiKey: 'k', sessionId: 's1' })
  const b = seen.at(-1).body
  ok('the model is Jev', b.model === DECISION_MODEL)
  ok('one yes/no question per enabled server, keyed by its id', Object.keys(b.questions).sort().join() === 'mcp-gh,mcp-linear' && Object.values(b.questions).every(q => q.type === 'noul' && q.criteria.true && q.criteria.false))
  ok('the criterion names the server and what its tools do', /Linear — tools: list issues, save issue/.test(b.questions['mcp-linear'].criteria.true))
  ok('the state carries the latest message and recent ones', b.state.latest_message === 'Mark TG-473 as done in Linear' && Array.isArray(b.state.earlier_messages))
  ok('the key travels as a bearer header, never in the body', seen.at(-1).headers.authorization === 'Bearer k' && !JSON.stringify(b).includes('"k"'))
  ok('a confident yes attaches, a confident no does not', JSON.stringify(ids(r)) === '["mcp-linear"]' && r.decided)
  ok('what was left off is named, with its probability', r.skipped.length === 1 && r.skipped[0].name === 'GitHub' && r.skipped[0].p === 0.02)
  ok('and the cost is reported', r.usage?.cost === 0.00002)
}

// ── a borderline answer attaches — a wrong no costs a capability ────────────
reply = b => ({ answers: Object.fromEntries(Object.keys(b.questions).map(k => [k, { type: 'noul', noul: 0.4 }])) })
{
  const r = await chooseMcpServers({ message: 'hmm', servers, toolsByServer, decideFn: decide, apiKey: 'k' })
  ok('40% attaches (threshold leans towards keeping tools)', ids(r).length === 2)
}

// ── a server already used in this conversation stays, without asking ───────
reply = b => ({ answers: Object.fromEntries(Object.keys(b.questions).map(k => [k, { type: 'noul', noul: 0.0 }])) })
{
  const history = [{ role: 'user', text: 'list my issues' }, { role: 'assistant', parts: [{ type: 'tool', name: 'mcp__mcp-linear__list_issues', args: {}, result: '[]' }] }]
  const r = await chooseMcpServers({ message: 'and close the first one', history, servers, toolsByServer, decideFn: decide, apiKey: 'k' })
  ok('a server used earlier in the chat is attached even on a firm no', r.attach.has('mcp-linear'))
  ok('and Jev is only asked about the others', Object.keys(seen.at(-1).body.questions).join() === 'mcp-gh')
  ok('which can still be left off', !r.attach.has('mcp-gh'))
}

// ── every failure attaches everything ───────────────────────────────────────
reply = () => 'boom'
{
  const r = await chooseMcpServers({ message: 'x', servers, toolsByServer, decideFn: decide, apiKey: 'k' })
  ok('a 500 from the endpoint attaches everything', ids(r).length === 2 && !r.decided)
}
reply = () => ({ answers: { 'mcp-linear': { type: 'noul', noul: 0.9 } } })   // GitHub's answer missing
{
  const r = await chooseMcpServers({ message: 'x', servers, toolsByServer, decideFn: decide, apiKey: 'k' })
  ok('a server whose answer is missing attaches', r.attach.has('mcp-gh') && r.attach.has('mcp-linear'))
}
reply = () => ({ not: 'answers' })
{
  const r = await chooseMcpServers({ message: 'x', servers, toolsByServer, decideFn: decide, apiKey: 'k' })
  ok('a malformed body attaches everything', ids(r).length === 2 && !r.decided)
}
reply = () => 'hang'
{
  const t0 = Date.now()
  const r = await chooseMcpServers({ message: 'x', servers, toolsByServer, decideFn: (a) => decide({ ...a, timeoutMs: 300 }), apiKey: 'k' })
  ok('a hung endpoint times out and attaches everything', ids(r).length === 2 && !r.decided && Date.now() - t0 < 2000)
}
ok('describeServer humanises tool names', describeServer({ name: 'Linear' }, ['mcp__mcp-linear__save_issue_label']) === 'Linear — tools: save issue label')

stub.close()
console.log(`\n${pass}/${pass + fail} passed  ·  a decision can save tokens, never a capability`)
process.exit(fail ? 1 : 0)
