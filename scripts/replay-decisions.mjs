#!/usr/bin/env node
/**
 * Replay the decisions in your transcripts under different bars — no model,
 * no Jev, no new calls. Every reply since v0.9.36 carries the probabilities
 * behind its routing, fast-lane, tool, skill, housekeeping and claims
 * decisions (`decisions` on the assistant message); this reads them back.
 *
 *   node scripts/replay-decisions.mjs                 # what happened, by kind
 *   node scripts/replay-decisions.mjs --route 0.7     # if the routing bar were 0.7
 *   node scripts/replay-decisions.mjs --lane 0.9 --mcp 0.5 --skills 0.5
 *   node scripts/replay-decisions.mjs --show route    # every routing decision, one line each
 *
 * The AgentRun idea: keep the answers, change the code that reads them,
 * re-run a thousand judgments in seconds. Here that is "would this bar have
 * sent more of my real messages to the fast model, and which ones?"
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const bars = { route: Number(opt('route', 0.8)), lane: Number(opt('lane', 0.85)), mcp: Number(opt('mcp', 0.35)), skills: Number(opt('skills', 0.35)) }
const show = opt('show', null)

const dir = fs.existsSync(path.join(os.homedir(), '.radiant-location')) ? fs.readFileSync(path.join(os.homedir(), '.radiant-location'), 'utf8').trim() : path.join(os.homedir(), '.radiant')
const sdir = path.join(dir, 'sessions')
const rows = []
for (const f of fs.readdirSync(sdir).filter(f => f.endsWith('.json'))) {
  let s; try { s = JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8')) } catch { continue }
  const msgs = s.messages || []
  msgs.forEach((m, i) => {
    if (m.role !== 'assistant' || !m.decisions) return
    const user = [...msgs.slice(0, i)].reverse().find(x => x.role === 'user')
    rows.push({ session: s.title || f, text: String(user?.text || '').replace(/\s+/g, ' ').slice(0, 70), d: m.decisions })
  })
}
if (!rows.length) { console.log('no decisions recorded yet — they are kept on every reply from v0.9.36 on'); process.exit(0) }

const pct = p => p == null ? '—' : String(Math.round(p * 100)).padStart(3) + '%'
let routeWas = 0, routeWould = 0, laneWas = 0, laneWould = 0, mcpDropWas = 0, mcpDropWould = 0, skDropWas = 0, skDropWould = 0, claims = 0, unsupported = 0, hk = { title: 0, memory: 0, skill: 0, n: 0 }
for (const r of rows) {
  const d = r.d
  if (d.route?.p != null) { if (d.route.routed) routeWas++; if (d.route.p >= bars.route) routeWould++ }
  if (d.lane?.probs) { if (d.lane.took && d.lane.took !== 'none') laneWas++; const top = d.lane.choice; if (top && top !== 'none' && (d.lane.probs[top] ?? 0) >= bars.lane && (d.lane.confidence ?? 0) >= bars.lane) laneWould++ }
  if (d.mcp?.probs) for (const [id, p] of Object.entries(d.mcp.probs)) { if (!d.mcp.attached.includes(id)) mcpDropWas++; if (p < bars.mcp) mcpDropWould++ }
  if (d.skills?.probs) for (const [id, p] of Object.entries(d.skills.probs)) { if (!d.skills.attached.includes(id)) skDropWas++; if (p < bars.skills) skDropWould++ }
  for (const c of d.claims || []) { claims += c.claims; unsupported += c.unsupported.length }
  if (d.housekeeping) { hk.n++; for (const k of ['title', 'memory', 'skill']) if (d.housekeeping.ran[k]) hk[k]++ }
  if (show === 'route' && d.route?.p != null) console.log(`${pct(d.route.p)} ${d.route.routed ? '→ ' + (d.route.to || 'fast') : 'kept'}   ${r.text}`)
  if (show === 'lane' && d.lane?.probs) console.log(`${pct(d.lane.probs[d.lane.choice])} ${d.lane.took && d.lane.took !== 'none' ? 'INSTANT ' + d.lane.took : 'model'}   ${r.text}`)
  if (show === 'claims' && d.claims?.length) for (const c of d.claims) for (const u of c.unsupported) console.log(`${pct(u.support)} unsupported: ${u.claim.slice(0, 90)}   [${r.session}]`)
}
console.log(`${rows.length} replies with decisions`)
console.log(`routing   bar ${bars.route}: routed ${routeWas} → would route ${routeWould}`)
console.log(`fast lane bar ${bars.lane}: took it ${laneWas} → would take ${laneWould}`)
console.log(`MCP       bar ${bars.mcp}: servers left off ${mcpDropWas} → would leave off ${mcpDropWould}`)
console.log(`skills    bar ${bars.skills}: left off ${skDropWas} → would leave off ${skDropWould}`)
console.log(`housekeeping over ${hk.n} turns: title ran ${hk.title}, memory ${hk.memory}, skill ${hk.skill}`)
console.log(`claims checked ${claims}, unsupported ${unsupported}`)
