/**
 * Two Macs on one folder: say so, and never lock anyone out.
 *
 * ⚠️ THE HAZARD WAS REAL AND ONLY EVER MENTIONED IN A HINT. Radiant's Settings
 * says "One Mac at a time. Two copies of Radiant writing to the same folder at
 * once will overwrite each other" — inside a collapsed section. Nothing detected
 * it, so the first sign was work quietly disappearing.
 *
 * ⚠️ AND THE FAILURE MODE OF A LOCK IS WORSE THAN THE RACE. If being wrong means
 * "you cannot reach your own chats", the cure is worse than the disease. So every
 * case below asserts BOTH halves: that we noticed, and that we did not block.
 *
 * ⚠️ ONE FILE PER MAC. The lock used to be a single shared `.radiant-lock.json`
 * rewritten every 15s by every Mac — which iCloud cannot reconcile, so it forked
 * conflict copies until 17 junk files sat in the folder and the sync-error banner
 * stayed lit. Each Mac now owns `.radiant-lock.<host>.json`; these tests drive
 * the new shape and prove the old junk is swept.
 */
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const L = await import('../server/lock.js')
let pass = 0, fail = 0
const results = []
const ok = (n, c, extra = '') => { c ? pass++ : (fail++, results.push(`  FAIL ${n}${extra ? ' — ' + extra : ''}`)) }
const dir = mkdtempSync(join(tmpdir(), 'rx-lock-'))
const NOW = Date.now()

// ── an empty folder is ours ─────────────────────────────────────────────────
{
  const r = L.claimLock(dir, { host: 'mbp', pid: 1, now: NOW })
  ok('an unused folder is claimed without complaint', !r.contested && !r.holder)
  ok('and the claim is on disk under this Mac\'s own file', L.readLock(dir, 'mbp')?.host === 'mbp')
  ok('the file is named per host', existsSync(join(dir, L.lockFileFor('mbp'))))
}

// ── a second Mac ────────────────────────────────────────────────────────────
{
  const r = L.claimLock(dir, { host: 'mba', pid: 2, now: NOW + 1000 })
  ok('a second Mac notices the first', r.contested && r.holder?.host === 'mbp')
  // ⚠️ THE HALF THAT MATTERS. Noticing must not turn into refusing.
  ok('...and still takes the folder rather than locking anyone out', L.readLock(dir, 'mba')?.host === 'mba')
  // ⚠️ AND IT WRITES ITS OWN FILE, NOT OVER THE FIRST MAC'S. No shared file =
  // nothing for iCloud to fork.
  ok('the first Mac\'s file is untouched', L.readLock(dir, 'mbp')?.host === 'mbp')
  ok('two Macs mean two files', readdirSync(dir).filter(n => n.startsWith(L.LOCK_PREFIX) && n.endsWith(L.LOCK_SUFFIX)).length === 2)
  ok('the message names the other Mac', /mbp/.test(L.describeHolder(r.holder, 'mba') || ''))
  ok('and says the one thing to actually avoid', /same chat on both/.test(L.describeHolder(r.holder, 'mba') || ''))
  ok('a second copy on THIS Mac reads as this Mac, not as a mystery machine',
     /open twice on this Mac/.test(L.describeHolder({ host: 'mbp' }, 'mbp') || ''))
  ok('a second Mac is described, not ordered to quit',
     !/quit one of them/.test(L.describeHolder({ host: 'work' }, 'home') || '') && /Also open on work/.test(L.describeHolder({ host: 'work' }, 'home') || ''))
  ok('...and does not claim to be somewhere else', !/also open on/.test(L.describeHolder({ host: 'mbp' }, 'mbp') || ''))
}

// fresh folders for the remaining cases (dir keeps mbp+mba from above)
const dir2 = mkdtempSync(join(tmpdir(), 'rx-lock2-'))

// ── our own restart is not a second Mac ─────────────────────────────────────
{
  // ⚠️ A CRASHED RADIANT ON THIS MAC LOOKS EXACTLY LIKE A LIVE ONE ON DISK. Our
  // own file with a dead pid is our wreckage, not another Mac — same file, so we
  // simply overwrite it, and it must not count as contention.
  writeFileSync(join(dir2, L.lockFileFor('mbp')), JSON.stringify(L.lockRecord('mbp', 999999, NOW)))
  const r = L.claimLock(dir2, { host: 'mbp', pid: 3, now: NOW + 500 })
  ok('a dead Radiant on this Mac is not another Mac', !r.contested, JSON.stringify(r.holder))
  ok('the same process re-claiming is not contention',
     !L.claimLock(dir2, { host: 'mbp', pid: 3, now: NOW + 600 }).contested)
}

// ── staleness has to outlast iCloud, not the process ────────────────────────
{
  const fresh = L.lockRecord('mba', 7, NOW)
  ok('a beat from a second ago is live', !L.isStale(fresh, NOW + 1000))
  ok('a beat from 30 seconds ago is still live — that is sync, not death', !L.isStale(fresh, NOW + 30_000))
  ok('the threshold is several beats, not one', L.STALE_MS >= L.BEAT_MS * 4)
  ok('a beat from three minutes ago is abandoned', L.isStale(fresh, NOW + 180_000))
  ok('a record with no beat at all is abandoned, not trusted forever', L.isStale({ host: 'old', pid: 1 }, NOW))
  ok('an unparseable beat is abandoned rather than believed', L.isStale({ host: 'x', pid: 1, beatAt: 'not a date' }, NOW))
  const d = mkdtempSync(join(tmpdir(), 'rx-lock3-'))
  writeFileSync(join(d, L.lockFileFor('mba')), JSON.stringify(L.lockRecord('mba', 7, NOW - 200_000)))
  ok('so an abandoned second Mac is not contention', !L.claimLock(d, { host: 'mbp', pid: 4, now: NOW }).contested)
  rmSync(d, { recursive: true, force: true })
}

// ── the beat notices another Mac arriving ───────────────────────────────────
{
  const d = mkdtempSync(join(tmpdir(), 'rx-lock4-'))
  L.claimLock(d, { host: 'mbp', pid: 5, now: NOW })
  ok('a quiet folder beats quietly', !L.beatLock(d, { host: 'mbp', pid: 5, now: NOW + L.BEAT_MS }).contested)
  writeFileSync(join(d, L.lockFileFor('mba')), JSON.stringify(L.lockRecord('mba', 8, NOW + L.BEAT_MS)))
  const r = L.beatLock(d, { host: 'mbp', pid: 5, now: NOW + L.BEAT_MS * 2 })
  ok('a Mac that arrives after us is noticed on the next beat', r.contested && r.holder?.host === 'mba')
  ok('and our own startedAt is preserved across beats', L.readLock(d, 'mbp')?.startedAt === new Date(NOW).toISOString())
  rmSync(d, { recursive: true, force: true })
}

// ── releasing ───────────────────────────────────────────────────────────────
{
  const d = mkdtempSync(join(tmpdir(), 'rx-lock5-'))
  L.claimLock(d, { host: 'mbp', pid: 6, now: NOW })
  ok('we can release our own claim', L.releaseLock(d, 'mbp', 6) && L.readLock(d, 'mbp') === null)
  // another Mac's file is a different file; releasing ours never removes it
  writeFileSync(join(d, L.lockFileFor('mba')), JSON.stringify(L.lockRecord('mba', 9, NOW)))
  L.claimLock(d, { host: 'mbp', pid: 7, now: NOW })
  ok('releasing ours leaves the other Mac\'s file alone',
     L.releaseLock(d, 'mbp', 7) && L.readLock(d, 'mba')?.host === 'mba')
  rmSync(d, { recursive: true, force: true })
}

// ── the legacy shared lock and its iCloud conflict copies are swept ──────────
{
  const d = mkdtempSync(join(tmpdir(), 'rx-lock6-'))
  writeFileSync(join(d, '.radiant-lock.json'), '{}')          // the old shared name
  writeFileSync(join(d, '.radiant-lock 2.json'), '{}')        // iCloud conflict copies
  writeFileSync(join(d, '.radiant-lock.json 3.json'), '{}')
  writeFileSync(join(d, L.lockFileFor('mbp')), JSON.stringify(L.lockRecord('mbp', 1, NOW)))  // a real per-host file
  const n = L.sweepLegacyLocks(d)
  ok('the legacy file and both conflict copies are swept', n === 3, `swept ${n}`)
  ok('but a valid per-host lock is kept', existsSync(join(d, L.lockFileFor('mbp'))))
  ok('nothing shared or forked remains', !existsSync(join(d, '.radiant-lock.json')) && !existsSync(join(d, '.radiant-lock 2.json')))
  rmSync(d, { recursive: true, force: true })
}

// ── nothing here may throw, ever ────────────────────────────────────────────
{
  const d = mkdtempSync(join(tmpdir(), 'rx-lock7-'))
  writeFileSync(join(d, L.lockFileFor('mbp')), 'this is not json {{{')
  ok('a corrupt lock reads as no lock', L.readLock(d, 'mbp') === null)
  ok('and is claimed without complaint', !L.claimLock(d, { host: 'mbp', pid: 10, now: NOW }).contested)
  const gone = join(d, 'no', 'such', 'place')
  ok('an unreachable folder does not throw', L.readLock(gone, 'mbp') === null)
  ok('sweeping a missing folder does not throw', L.sweepLegacyLocks(gone) === 0)
  ok('describeHolder says nothing when there is nothing to say', L.describeHolder(null) === null)
  // an odd hostname still makes a tame filename
  ok('a spacey hostname becomes a safe filename', L.lockFileFor("Tony's  Home MBP M4") === '.radiant-lock.Tony-s-Home-MBP-M4.json')
  rmSync(d, { recursive: true, force: true })
}

rmSync(dir, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true })
console.log(results.join('\n'))
console.log(`\n${pass}/${pass + fail} passed  ·  one lock file per Mac, named, never locked out, no iCloud junk`)
process.exit(fail ? 1 : 0)
