#!/usr/bin/env node
/** Checkpoints: snapshot, change list, restore (including files created after), undoable restore, and the folders that must never be snapshotted. */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { snapshot, changes, restore, eligible, fileDiff } from '../server/checkpoints.js'
let pass = 0, fail = 0
const ok = (n, c, extra = '') => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${extra ? ' — ' + extra : ''}`)) }
const data = mkdtempSync(join(tmpdir(), 'rx-ckdata-'))
const proj = mkdtempSync(join(tmpdir(), 'rx-ckproj-'))
writeFileSync(join(proj, 'a.txt'), 'one')
mkdirSync(join(proj, 'node_modules', 'x'), { recursive: true }); writeFileSync(join(proj, 'node_modules', 'x', 'big.js'), 'x'.repeat(1000))

ok('the home folder is never eligible', !eligible(homedir()).ok)
ok('root is never eligible', !eligible('/').ok)
ok('a project folder is', eligible(proj).ok)

const s1 = await snapshot(data, proj, 'before')
ok('first snapshot has a sha', s1 && /^[0-9a-f]{40}$/.test(s1.sha) && s1.changed)
const s1b = await snapshot(data, proj, 'again')
ok('nothing changed → same sha, no new commit', s1b.sha === s1.sha && !s1b.changed)

writeFileSync(join(proj, 'a.txt'), 'two'); writeFileSync(join(proj, 'b.txt'), 'new')
const s2 = await snapshot(data, proj, 'after')
ok('a change makes a new sha', s2.sha !== s1.sha && s2.changed)
const ch = await changes(data, proj, s1.sha, s2.sha)
ok('the change list names both files', ch.length === 2 && ch.some(c => c.file === 'a.txt') && ch.some(c => c.file === 'b.txt'), JSON.stringify(ch))
ok('node_modules is not in it', !ch.some(c => /node_modules/.test(c.file)))
const d = await fileDiff(data, proj, s1.sha, s2.sha, 'a.txt')
ok('a file diff reads as a diff', /-one/.test(d) && /\+two/.test(d))

// a third edit AFTER s2, then restore to s1: a.txt back to one, b.txt gone, c.txt gone
writeFileSync(join(proj, 'c.txt'), 'later')
const r = await restore(data, proj, s1.sha)
ok('restore puts the edited file back', readFileSync(join(proj, 'a.txt'), 'utf8') === 'one')
ok('restore removes files created after the snapshot', !existsSync(join(proj, 'b.txt')) && !existsSync(join(proj, 'c.txt')))
ok('node_modules survives a restore', existsSync(join(proj, 'node_modules', 'x', 'big.js')))
ok('the restore is itself undoable (a safety snapshot exists)', r.safety && /^[0-9a-f]{40}$/.test(r.safety))
ok('and it says what it touched', r.touched.length >= 2)
const r2 = await restore(data, proj, r.safety)
ok('undoing the restore brings c.txt back', existsSync(join(proj, 'c.txt')) && readFileSync(join(proj, 'a.txt'), 'utf8') === 'two')

rmSync(data, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true })
console.log(`${pass}/${pass + fail} passed  ·  a reply's changes can be undone without losing the chat`)
process.exit(fail ? 1 : 0)
