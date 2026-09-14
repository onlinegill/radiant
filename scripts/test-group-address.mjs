// Who acts on a group-chat message.
//
// ⚠️ EVERY AGENT ANSWERED EVERY MESSAGE, AND NONE HAD TOOLS (iandouglas, #16
// and #18). "@Coder, plan the stack" must pick Coder alone, with tools; no
// mention keeps the round table, without them.
import { addressedParticipants, slugName, groupPersona } from '../server/group.js'
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
ok(/const speakers = addressed\.length \? addressed : participants/.test(src), 'the loop runs the addressed agents, else everyone')
ok(/useTools: isAddressed && session\.useTools !== false/.test(src), 'tools only for the addressed')
// #15: MCP servers get the login shell's PATH, and a shell-shaped command goes through the shell
const env = loginEnv()
ok((process.env.PATH || '').split(':').filter(Boolean).every(d => env.PATH.split(':').includes(d)), 'loginEnv keeps every PATH entry the app already had')
const mcp = fs.readFileSync('server/mcp.js', 'utf8')
ok(/loginEnv\(\)/.test(mcp) && /shellShaped/.test(mcp) && /\['-lc', line\]/.test(mcp), 'MCP spawns with the login PATH; PATH=… npx … runs through the shell')
const settings = fs.readFileSync('src/components/Settings.jsx', 'utf8')
ok(/startEdit\(s\)/.test(settings) && /api\.updateMcp\(editing\.id, patch\)/.test(settings), 'an MCP server can be edited in place')
console.log(`\n${pass}/${pass + fail} passed  ·  @Name picks who acts; MCP servers find npx and can be edited`)
process.exit(fail ? 1 : 0)
