#!/usr/bin/env node
/**
 * Jev picks the next move from an element list — the "amazingly fast
 * computer use" pattern (jev-ultrafast, jev-browser, mobile-jev), as a tool
 * any driver can call: the browser pane's read_page, Chrome's, the iOS
 * Simulator's inspect tree, a Playwright DOM walk.
 *
 *   node scripts/jev-pick.mjs --goal "open the Settings tab" < elements.json
 *
 * stdin: a JSON array of candidates, each { id, role, name, text?, value? }
 * (up to ~150; more is noise), or the raw text of an accessibility tree —
 * anything with `[ref_N]` / `ref_N` markers is parsed into candidates.
 * Options: --goal (required), --done-check "what the page shows when the
 * goal is met", --history "steps taken so far", --page "title/url".
 *
 * stdout: { action: 'click'|'type'|'done'|'stuck', id, text?, confidence, p }
 *   click  → click candidate `id`
 *   type   → focus candidate `id`, type `text` (the caller supplies text for
 *            fields via --values name=value; Jev does not write text)
 *   done   → the goal is met; stop
 *   stuck  → nothing here advances the goal; the caller should scroll,
 *            go back, or hand over to a person
 *
 * ⚠️ JEV DOES NOT SEE PIXELS. It reads the list you give it, so a target
 * that only exists as an image, or a page that has not finished loading,
 * is not on the list, and the answer is 'stuck', not a guess.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decide } from '../server/decide.js'

const args = process.argv.slice(2)
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const goal = opt('goal'); if (!goal) { console.error('jev-pick: --goal is required'); process.exit(2) }
const doneCheck = opt('done-check', '')
const history = opt('history', '')
const page = opt('page', '')
const values = Object.fromEntries(args.filter((a, i) => args[i - 1] === '--values').flatMap(v => v.split(',')).map(kv => kv.split('=')).filter(x => x.length === 2))

const key = process.env.OPENROUTER_API_KEY || (() => {
  try {
    const dir = fs.existsSync(path.join(os.homedir(), '.radiant-location')) ? fs.readFileSync(path.join(os.homedir(), '.radiant-location'), 'utf8').trim() : path.join(os.homedir(), '.radiant')
    return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).keys?.openrouter || null
  } catch { return null }
})()
if (!key) { console.log(JSON.stringify({ action: 'stuck', reason: 'no OpenRouter key' })); process.exit(0) }

let raw = ''
for await (const c of process.stdin) raw += c
let cands
try { cands = JSON.parse(raw) } catch { cands = null }
if (!Array.isArray(cands)) {
  // an accessibility tree with ref markers → candidates
  cands = []
  for (const line of raw.split('\n')) {
    const m = /\[?(ref_\d+)\]?/.exec(line); if (!m) continue
    const text = line.replace(/\[?ref_\d+\]?/, '').replace(/^\s*[-•]?\s*/, '').trim().slice(0, 140)
    if (text) cands.push({ id: m[1], text })
  }
}
cands = cands.slice(0, 150)
if (!cands.length) { console.log(JSON.stringify({ action: 'stuck', reason: 'no candidates' })); process.exit(0) }

const label = c => [c.role, c.name, c.text, c.value ? `value="${String(c.value).slice(0, 40)}"` : ''].filter(Boolean).join(' · ').slice(0, 160)
const criteria = {}
for (const c of cands) criteria[String(c.id)] = label(c)
criteria.__done = `The goal is already met on this page${doneCheck ? ': ' + doneCheck : ''}.`
criteria.__stuck = 'Nothing listed here moves the goal forward (wrong page, still loading, target not on the list).'

const state = { goal, page, steps_so_far: history || '(none)', elements_on_page: cands.map(c => `${c.id}: ${label(c)}`), values_available_to_type: Object.keys(values) }
const questions = {
  next: { type: 'choice', instructions: 'Which element should be acted on NEXT to move toward the goal — or is the goal already met (__done), or is nothing here useful (__stuck)? Prefer the most direct step; prefer a control over a heading with the same words.', criteria },
  kind: { type: 'choice', instructions: 'If an element is chosen, what should be done with it?', criteria: { click: 'press, open, select, toggle, submit', type: 'it is a text field that needs a value typed into it', none: 'no element is chosen' } }
}
const out = await decide({ apiKey: key, state, questions, timeoutMs: 8000 })
if (!out) { console.log(JSON.stringify({ action: 'stuck', reason: 'Jev unreachable' })); process.exit(0) }
const n = out.answers.next, k = out.answers.kind
const id = n?.choice
const conf = n?.confidence ?? null
const p = n?.probabilities?.[id] ?? null
let res
if (!id) res = { action: 'stuck', reason: 'no answer' }
else if (id === '__done') res = { action: 'done', confidence: conf, p }
else if (id === '__stuck') res = { action: 'stuck', confidence: conf, p }
else {
  const c = cands.find(x => String(x.id) === id)
  const kind = k?.choice === 'type' ? 'type' : 'click'
  res = { action: kind, id, label: label(c), confidence: conf, p }
  if (kind === 'type') {
    // pick which value belongs in this field, if any were offered
    const names = Object.keys(values)
    if (names.length === 1) { res.text = values[names[0]]; res.value_name = names[0] } else if (names.length) {
      const v = await decide({ apiKey: key, state: { field: label(c), goal }, questions: { which: { type: 'choice', instructions: 'Which value belongs in this field?', criteria: Object.fromEntries([...names.map(nm => [nm, `type "${String(values[nm]).slice(0, 80)}" (the value called ${nm})`]), ['none', 'none of them fit']]) } }, timeoutMs: 6000 })
      const w = v?.answers?.which?.choice
      if (w && w !== 'none') res.text = values[w], res.value_name = w
    }
  }
}
res.cost = out.usage?.cost ?? null
console.log(JSON.stringify(res))
