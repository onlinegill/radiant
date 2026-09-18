#!/usr/bin/env node
/**
 * Every new GitHub issue, sorted the moment it lands — by Jev.
 *
 * A report about chats dying silently used to sit unread next to a request
 * for a nicer icon until someone opened the list. Jev (server/decide.js)
 * reads each untriaged issue and answers, in a third of a second: which app,
 * what kind of thing, how bad, and whether it is one we already have open.
 * The answers become labels on the issue — nothing is posted, nothing is
 * closed, and a duplicate is only LABELLED as one, with the number it
 * duplicates in the label's description, so a person still makes the call.
 *
 *   node scripts/triage.mjs             # label every open issue not yet triaged
 *   node scripts/triage.mjs --dry-run   # show what it would do
 *   node scripts/triage.mjs --redo 42   # triage one issue again
 *
 * ⚠️ NEVER ON ITS OWN JUDGMENT ALONE. Every label carries the probability it
 * was given, and anything under 60% is left unlabelled and listed for a
 * person. A wrong label is worse than no label: it hides the issue in the
 * wrong drawer.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decide } from '../server/decide.js'

const GH = process.env.GH_BIN || (fs.existsSync('/opt/homebrew/bin/gh') ? '/opt/homebrew/bin/gh' : 'gh')
const REPO = 'templetongroup/radiant'
const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const redo = args.includes('--redo') ? Number(args[args.indexOf('--redo') + 1]) : null
const BAR = 0.6

const gh = (...a) => execFileSync(GH, a, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const key = process.env.OPENROUTER_API_KEY || (() => {
  try {
    const dir = fs.existsSync(path.join(os.homedir(), '.radiant-location')) ? fs.readFileSync(path.join(os.homedir(), '.radiant-location'), 'utf8').trim() : path.join(os.homedir(), '.radiant')
    return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).keys?.openrouter || null
  } catch { return null }
})()
if (!key) { console.log('triage: no OpenRouter key — nothing done'); process.exit(0) }

// labels this script may apply; created if missing, so a fresh clone works
const LABELS = {
  'app: mac': 'the Mac app', 'app: iphone': 'the iPhone / iPad app', 'app: website': 'templetongroup.dev', 'app: chrome': 'the Chrome extension',
  'kind: bug': 'something is broken', 'kind: request': 'something wanted', 'kind: question': 'a question, not a change',
  'sev: critical': 'data loss, a dead app, or a security hole', 'sev: broken': 'a feature does not work', 'sev: cosmetic': 'looks or reads wrong, still works',
  'triaged': 'sorted by scripts/triage.mjs', 'duplicate': 'the description names the issue it duplicates'
}
const have = new Set(JSON.parse(gh('label', 'list', '--repo', REPO, '--limit', '100', '--json', 'name')).map(l => l.name))
for (const [name, desc] of Object.entries(LABELS)) {
  if (!have.has(name) && !dry) gh('label', 'create', name, '--repo', REPO, '--description', desc, '--color', name.startsWith('sev: critical') ? 'B60205' : name.startsWith('sev:') ? 'D93F0B' : name.startsWith('kind:') ? '0E8A16' : name.startsWith('app:') ? '1D76DB' : 'BFD4F2')
}

// --closed: a dry run over the last closed issues, to see what it would have said
const stateArg = args.includes('--closed') ? 'closed' : 'open'
const issues = JSON.parse(gh('issue', 'list', '--repo', REPO, '--state', stateArg, '--limit', '200', '--json', 'number,title,body,labels,author,createdAt'))
const todo = issues.filter(i => redo ? i.number === redo : stateArg === 'closed' || !i.labels.some(l => l.name === 'triaged'))
if (stateArg === 'closed' && !dry) { console.log('--closed is a dry run'); process.exit(1) }
if (!todo.length) { console.log(`triage: ${issues.length} open issue(s), none waiting`); process.exit(0) }

const others = i => issues.filter(o => o.number !== i.number).slice(0, 25)
let spent = 0
const flagged = []
for (const issue of todo) {
  const dupes = others(issue)
  const state = { title: issue.title, body: String(issue.body || '').slice(0, 4000), reporter: issue.author?.login, open_issues: dupes.map(o => `#${o.number}: ${o.title}`) }
  const questions = {
    app: { type: 'choice', instructions: 'Which part of Radiant is this about?', criteria: { mac: 'the Mac desktop app (Electron; chats, agents, providers, settings)', iphone: 'the iPhone or iPad app (on-device models, App Store)', website: 'templetongroup.dev or the download page', chrome: 'the Chrome extension', unclear: 'cannot tell from the text' } },
    kind: { type: 'choice', instructions: 'What is this?', criteria: { bug: 'something that is supposed to work does not', request: 'asks for something new or different', question: 'asks how something works, changes nothing' } },
    severity: { type: 'choice', instructions: 'If it is a bug, how bad?', criteria: { critical: 'data is lost, the app is unusable or dies silently, or a security or privacy problem', broken: 'a feature does not work but the app is otherwise usable', cosmetic: 'looks, wording, layout — works but reads or renders wrong', na: 'not a bug' } },
    // ⚠️ RELATED IS NOT DUPLICATE. On the first dry run a question about tool
    // calling in group chat was called a duplicate of a request about
    // subagents in group chat at 90% — same feature, different ask. The
    // criterion says so, and the bar for this one label is higher.
    dupe: { type: 'choice', instructions: 'Is this the SAME ask as one of open_issues — the same bug or the same request, such that fixing one fixes the other? Being about the same feature is not enough.', criteria: Object.fromEntries([...dupes.map(o => [`#${o.number}`, o.title]), ['none', 'a different ask from all of them, even if about the same feature']]) }
  }
  const out = await decide({ apiKey: key, state, questions, timeoutMs: 8000 })
  if (!out) { console.log(`  #${issue.number}: Jev unreachable — left for a person`); flagged.push(issue.number); continue }
  spent += out.usage?.cost || 0
  const a = out.answers
  const pick = (q) => { const x = a[q]; return x && x.choice && (x.confidence ?? 1) >= BAR ? x : null }
  const labels = []
  const app = pick('app'); if (app && app.choice !== 'unclear') labels.push(`app: ${app.choice}`)
  const kind = pick('kind'); if (kind) labels.push(`kind: ${kind.choice}`)
  const sev = pick('severity'); if (sev && sev.choice !== 'na' && kind?.choice === 'bug') labels.push(`sev: ${sev.choice}`)
  const dupe = a.dupe && a.dupe.choice !== 'none' && (a.dupe.confidence ?? 0) >= 0.9 ? a.dupe : null
  if (dupe) labels.push('duplicate')
  const conf = q => a[q] ? Math.round((a[q].confidence ?? 1) * 100) + '%' : '—'
  console.log(`  #${issue.number} ${issue.title.slice(0, 60)}`)
  console.log(`     ${labels.join(', ') || '(no label confident enough)'}${dupe ? `  ↔ ${dupe.choice}` : ''}   [app ${conf('app')} · kind ${conf('kind')} · sev ${conf('severity')} · dupe ${conf('dupe')}]`)
  if (!labels.length) flagged.push(issue.number)
  if (dry) continue
  gh('issue', 'edit', String(issue.number), '--repo', REPO, ...labels.flatMap(l => ['--add-label', l]), '--add-label', 'triaged')
}
console.log(`\ntriage: ${todo.length} issue(s) sorted for $${spent.toFixed(5)}${flagged.length ? ` · left for a person: #${flagged.join(', #')}` : ''}`)
