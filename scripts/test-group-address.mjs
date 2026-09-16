// Who acts on a group-chat message.
//
// ⚠️ EVERY AGENT ANSWERED EVERY MESSAGE, AND NONE HAD TOOLS (iandouglas, #16
// and #18). "@Coder, plan the stack" must pick Coder alone, with tools; no
// mention keeps the round table, without them.
import { readFileSync } from 'node:fs'
import { addressedParticipants, addressing, slugName, groupPersona } from '../server/group.js'
import { loginEnv } from '../server/platform.js'
import fs from 'node:fs'
let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }

const room = [{ id: 'a1', name: 'Coder' }, { id: 'a2', name: 'Dev Ops' }, { id: 'a3', name: 'Security' }, { id: 'a4', name: 'Marketing' }]
const who = t => addressedParticipants(t, room)
ok(who('@Coder I would like you to update the plan').join() === 'a1', 'a leading @Name picks that agent')
ok(who("hey @coder, let's use React").join() === 'a1', 'case and a trailing comma do not matter')
ok(who('@dev-ops plan the deploy').join() === 'a2', 'a two-word name is typed with a hyphen')
ok(who('@devops plan the deploy').join() === 'a2', '…or run together')
ok(who('@Coder and @Security look at this').join() === 'a1,a3', 'two mentions, both act, in order')
ok(who("let's do the frontend in React").length === 0, 'no mention: the whole room')
ok(who('email me at tony@templetongroup.com').length === 0, 'an email address is not a mention')
ok(who('@nobody do this').length === 0, 'an unknown name is ignored, not a crash')
ok(slugName('Dev Ops') === 'dev-ops' && slugName('  Q&A lead ') === 'q-a-lead', 'names slug the way the composer shows them')
const p = groupPersona('Be terse.', { names: room.map(r => r.name), self: 'Coder', addressed: true, others: ['Dev Ops', 'Security', 'Marketing'] })
ok(/addressed directly/.test(p) && /with your tools/.test(p) && /Dev Ops, Security, Marketing are listening/.test(p), 'an addressed agent is told it acts and who is listening')
const q = groupPersona('Be terse.', { names: room.map(r => r.name), self: 'Coder', addressed: false, others: [] })
ok(!/addressed directly/.test(q) && /group discussion/.test(q), 'an unaddressed agent gets the round-table brief')
// the server wires it: only the addressed speak, and only they get tools
const src = fs.readFileSync('server/index.js', 'utf8')
ok(/const speakers = \(named\.length \|\| swept\.length\) \? \[\.\.\.named, \.\.\.swept\] : participants/.test(src), 'the loop runs the named then the swept-in, else everyone')
ok(/useTools: acting && session\.useTools !== false/.test(src), 'tools only for the agent actually acting')
// #15: MCP servers get the login shell's PATH, and a shell-shaped command goes through the shell
const env = loginEnv()
ok((process.env.PATH || '').split(':').filter(Boolean).every(d => env.PATH.split(':').includes(d)), 'loginEnv keeps every PATH entry the app already had')
const mcp = fs.readFileSync('server/mcp.js', 'utf8')
ok(/loginEnv\(\)/.test(mcp) && /shellShaped/.test(mcp) && /\['-lc', line\]/.test(mcp), 'MCP spawns with the login PATH; PATH=… npx … runs through the shell')
const settings = fs.readFileSync('src/components/Settings.jsx', 'utf8')
ok(/startEdit\(s\)/.test(settings) && /api\.updateMcp\(editing\.id, patch\)/.test(settings), 'an MCP server can be edited in place')
// ── @others, @all and negation — iandouglas, issue #16 ─────────────────────
// "could we also use something like @others to address everyone else?" with
// "@coder ... ; @others !@marketing update your work accordingly".
const A = t => addressing(t, room)
const ids = o => o.ids.join(',')

const one = A('@coder move the backend to Go')
ok(one.named.length === 1 && one.swept.length === 0, 'naming one agent sweeps nobody in')

const rest = A('@coder move the backend to Go; @others update your plan accordingly')
ok(rest.named.join() === 'a1', 'the named agent is the one who acts')
ok(rest.swept.length === room.length - 1, `@others sweeps in everyone else (${ids(rest)})`)
ok(!rest.swept.includes('a1'), 'and never the agent already named')

const minus = A('@coder move the backend to Go; @others !@marketing update your work')
ok(!minus.ids.includes('a4') && minus.excluded.includes('a4'), `!@marketing keeps Marketing out (${ids(minus)})`)
ok(minus.named.join() === 'a1' && minus.swept.length === room.length - 2, 'while the rest still re-plan')

// ⚠️ ORDER MUST NOT DECIDE IT. An exclusion has to beat a mention wherever it
// appears, or sitting a round out depends on where you typed it.
ok(!A('@marketing do it; !@marketing actually no').ids.includes('a4'), 'an exclusion beats an earlier mention of the same agent')
ok(!A('!@marketing; @others go').ids.includes('a4'), 'and an exclusion written first beats a later @others')

ok(A('@all stand up').swept.length === room.length, '@all sweeps the whole room')
ok(A('@everyone stand up').swept.length === room.length, 'so does @everyone')
ok(A('what does everyone think?').ids.length === 0, 'the bare word "everyone" is not a mention')
ok(A('email me at bob@others.com').ids.length === 0, 'and an address inside an email is not one either')

// ── acting and re-planning must not read alike ─────────────────────────────
const act = groupPersona('Be terse.', { names: room.map(r => r.name), self: 'Coder', addressed: true, others: ['Marketing'], role: 'act' })
const replan = groupPersona('Be terse.', { names: room.map(r => r.name), self: 'Marketing', addressed: true, others: ['Coder'], role: 'replan' })
ok(/Do the work yourself/.test(act), 'the named agent is told to do the work')
ok(/not asked to do this work/.test(replan) && /YOUR OWN plan/.test(replan), 'a swept-in agent is told to revise its own plan')
ok(/Do not do the other person/.test(replan), 'and explicitly not to do the other agent\'s task')
ok(act !== replan, 'the two addenda differ')

// ── the room option, issue #18 ─────────────────────────────────────────────
const srv = readFileSync('server/index.js', 'utf8')
ok(/session\.groupFollowUp/.test(srv), 'the room option is read on a group turn')
ok(/'groupFollowUp'\]/.test(srv), 'and can be saved on the session')
// only the acting agent gets tools, whatever swept them in
ok(/useTools: acting && session\.useTools !== false/.test(srv), 'only the agent doing the work gets tools')
ok(/skills: acting \? mergedSkills : \[\]/.test(srv), 'and only it gets the skills')

console.log(`\n${pass}/${pass + fail} passed  ·  @Name picks who acts; MCP servers find npx and can be edited`)
process.exit(fail ? 1 : 0)
