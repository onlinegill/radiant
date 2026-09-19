#!/usr/bin/env node
/** The fast lane: what takes it, what never does, and what each lookup returns. */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { classifyLookup, runLookup, LANES } from '../server/fastlane.js'
let pass = 0, fail = 0
const ok = (n, c, extra = '') => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${extra ? ' — ' + extra : ''}`)) }
const jev = (choice, conf = 0.95, p = 0.95) => async ({ questions }) => ({ answers: { lane: { choice, confidence: conf, probabilities: { [choice]: p } } } })

let r = await classifyLookup({ message: "what's uncommitted?", decideFn: jev('git_status'), apiKey: 'k' })
ok('a confident lookup takes the lane', r.lane === 'git_status')
r = await classifyLookup({ message: "what's uncommitted?", decideFn: jev('git_status', 0.6, 0.6), apiKey: 'k' })
ok('below 0.85 it does not', r.lane === 'none' && r.reason === 'not sure enough')
r = await classifyLookup({ message: 'fix the bug in providers.js', decideFn: jev('none'), apiKey: 'k' })
ok('"none" goes to the model', r.lane === 'none')
r = await classifyLookup({ message: 'git status', attachments: [{}], decideFn: jev('git_status'), apiKey: 'k' })
ok('an attachment never takes the lane', r.lane === 'none')
r = await classifyLookup({ message: 'and the status?', history: [{ role: 'user', text: 'fix it' }, { role: 'assistant', parts: [{ type: 'tool', name: 'edit_file' }] }, { role: 'user', text: 'and the status?' }], decideFn: jev('git_status'), apiKey: 'k' })
ok('mid-task never takes the lane', r.lane === 'none' && r.reason === 'mid-task')
r = await classifyLookup({ message: 'x'.repeat(201), decideFn: jev('git_status'), apiKey: 'k' })
ok('a long message never takes the lane', r.lane === 'none')
r = await classifyLookup({ message: '/commit', decideFn: jev('git_status'), apiKey: 'k' })
ok('a slash command never takes the lane', r.lane === 'none')
r = await classifyLookup({ message: 'git status', decideFn: jev('git_status'), apiKey: null })
ok('no key → model', r.lane === 'none')
r = await classifyLookup({ message: 'git status', decideFn: async () => null, apiKey: 'k' })
ok('Jev unreachable → model', r.lane === 'none')
let seen = null
await classifyLookup({ message: "what's TG-474", hasLinear: false, decideFn: async ({ questions }) => { seen = Object.keys(questions.lane.criteria); return null }, apiKey: 'k' })
ok('the issue lane is offered only with a Linear server', !seen.includes('issue') && seen.includes('git_log'))

// the lookups, on a real little repo
const dir = mkdtempSync(join(tmpdir(), 'rx-lane-'))
execFileSync('git', ['init', '-q'], { cwd: dir })
writeFileSync(join(dir, 'a.txt'), 'hello'); mkdirSync(join(dir, 'src'))
execFileSync('git', ['add', '.'], { cwd: dir }); execFileSync('git', ['-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-qm', 'first'], { cwd: dir })
writeFileSync(join(dir, 'a.txt'), 'hello world')
const session = { title: 'Test chat', model: 'm1', provider: 'p1', cwd: dir }
ok('git_status shows the modified file', /M a\.txt/.test(await runLookup('git_status', { cwd: dir, session })))
ok('git_log shows the commit', /first/.test(await runLookup('git_log', { cwd: dir, session })))
ok('git_diff shows the stat', /a\.txt/.test(await runLookup('git_diff', { cwd: dir, session })))
const ls = await runLookup('list_files', { cwd: dir, session })
ok('list_files lists entries with folders marked', /a\.txt/.test(ls) && /src\//.test(ls))
ok('where_am_i names model, provider and folder', /m1/.test(await runLookup('where_am_i', { cwd: dir, session, provider: { name: 'Prov' } })) && /Prov/.test(await runLookup('where_am_i', { cwd: dir, session, provider: { name: 'Prov' } })))
ok('issue without a key or tool returns nothing (the model takes it)', (await runLookup('issue', { cwd: dir, session, message: 'what is it', mcpTools: [] })) === null)
ok('issue calls the Linear get_issue tool with the key', /TG-474/.test(await runLookup('issue', { cwd: dir, session, message: 'what is TG-474 about', mcpTools: [{ name: 'mcp__linear__get_issue' }], callMcp: async (n, a) => `title: ${a.id} · Connect to my Mac` })))
ok('every lane has a criterion', Object.keys(LANES).every(k => typeof LANES[k] === 'string' && LANES[k].length > 10))
console.log(`${pass}/${pass + fail} passed  ·  the lane is a closed list of read-only lookups`)
process.exit(fail ? 1 : 0)
