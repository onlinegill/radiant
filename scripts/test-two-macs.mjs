// Two Radiant servers on one folder: a setting saved by one reaches the other,
// and neither overwrites the other's change with a stale copy.
//
// ⚠️ THIS IS THE FIVE-MACS CASE. Every server held config.json in memory from
// startup and wrote the whole copy back on each change, so a theme picked on
// one Mac was undone by the next save anywhere else. Tony: "I have 5 macs.
// youre telling me i need to quit radiant on each one to work on another
// mac?" Two servers here, one folder, no iCloud in between — the same file.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radiant-two-macs-'))
const [pa, pb] = [await freePort(), await freePort()]
const boot = port => spawn('node', ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(port), RADIANT_DIR: dir, RADIANT_NO_LOCK_WAIT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
const A = boot(pa); const B = boot(pb)
const up = async port => { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/config`); if (r.ok) return true } catch {} await sleep(250) } return false }
try {
  ok(await up(pa) && await up(pb), 'two servers start on one folder')
  const put = (port, body) => fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
  const get = port => fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.json())

  // Mac A picks a theme.
  await put(pa, { themeId: 'nord' })
  // Mac B's watcher polls every 4s; give it time, then read B's memory.
  let seen = false
  for (let i = 0; i < 20 && !seen; i++) { await sleep(500); seen = (await get(pb)).settings.themeId === 'nord' }
  ok(seen, 'Mac B sees the theme Mac A picked, without restarting')

  // Mac B changes something else. Its save must carry A's theme forward.
  await put(pb, { uiScale: 1.25 })
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).settings
  ok(disk.themeId === 'nord' && disk.uiScale === 1.25, `B's save keeps A's theme (disk: theme=${disk.themeId}, scale=${disk.uiScale})`)

  // And A picks up B's change in turn.
  seen = false
  for (let i = 0; i < 20 && !seen; i++) { await sleep(500); seen = (await get(pa)).settings.uiScale === 1.25 }
  ok(seen, 'Mac A sees the change Mac B made')
  const revA1 = (await get(pa)).rev
  await put(pb, { themeId: 'ember' })
  let bumped = false
  for (let i = 0; i < 20 && !bumped; i++) { await sleep(500); bumped = (await get(pa)).rev !== revA1 }
  ok(bumped, 'a foreign write bumps the revision the window polls')
} finally {
  A.kill(); B.kill()
  await sleep(300)
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${pass}/${pass + fail} passed  ·  five Macs, one folder, nobody quits`)
process.exit(fail ? 1 : 0)
