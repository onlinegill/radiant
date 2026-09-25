/**
 * Who else is using this folder.
 *
 * ⚠️ TWO MACS ON ONE SHARED FOLDER IS A DATA HAZARD RADIANT ONLY EVER MENTIONED
 * IN PASSING. Settings says "One Mac at a time. Two copies of Radiant writing to
 * the same folder at once will overwrite each other" — in a hint, inside a
 * collapsed section, which nobody reads before it matters. Nothing detected it,
 * so the first sign was work quietly disappearing.
 *
 * ⚠️ AND THIS DOES NOT BLOCK. Refusing to start would lock someone out of their
 * own chats to protect them from a risk they may be perfectly happy to take —
 * reading on one Mac while working on the other is fine, and a stale lock from a
 * crash would be indistinguishable from a live one. Rule 12 cuts the other way
 * here: say the true thing, name the other Mac, let the person decide. The cost
 * of being wrong about a lock must never be "you cannot reach your work".
 *
 * ⚠️ THE HEARTBEAT HAS TO OUTLAST iCLOUD, NOT THE PROCESS. A beat written on one
 * Mac is not visible on the other until iCloud carries it across, which is
 * seconds and occasionally much longer. A threshold tuned to process liveness
 * would have each Mac confidently declaring the other dead. BEAT_MS is short so
 * the record is fresh; STALE_MS is deliberately six beats, so it takes a real
 * absence rather than one slow sync to call a lock abandoned.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { deviceNoun } from './platform.js'

// ⚠️ ONE FILE PER MAC, NOT ONE FILE SHARED. A single `.radiant-lock.json`
// rewritten every 15s by several Macs is exactly what iCloud cannot reconcile:
// it forks "conflict copies" (`.radiant-lock.json 2.json`, …), which piled up to
// 17 junk files in Tony's folder and kept the sync-error banner lit. Each Mac
// now owns `.radiant-lock.<host>.json` and never writes any other, so no single
// file ever has two authors and iCloud has nothing to fork. Detecting another
// Mac becomes "is any OTHER host's file live", which is what we wanted anyway.
export const LOCK_PREFIX = '.radiant-lock.'
export const LOCK_SUFFIX = '.json'
// The pre-per-host shared name, still recognised so old copies get cleaned up.
export const LEGACY_LOCK_NAME = '.radiant-lock.json'
export const BEAT_MS = 15_000
export const STALE_MS = 90_000

// A hostname can hold spaces and punctuation ("Tony's Home MBP M4"); keep the
// filename tame while staying stable per host.
export function safeHost (host) {
  return (String(host || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'mac'
}
export function lockFileFor (host) { return LOCK_PREFIX + safeHost(host) + LOCK_SUFFIX }
const lockPath = (dir, host) => path.join(dir, lockFileFor(host))
// A lock file that is not the legacy shared one and not a temp write-in-progress.
function isLockFile (name) {
  return name.startsWith(LOCK_PREFIX) && name.endsWith(LOCK_SUFFIX) && name !== LEGACY_LOCK_NAME && !name.includes('.tmp-')
}

/** What is written. Pure, so the shape is testable without a filesystem. */
export function lockRecord (host = os.hostname(), pid = process.pid, now = Date.now()) {
  return { host, pid, startedAt: new Date(now).toISOString(), beatAt: new Date(now).toISOString() }
}

/**
 * Is this record abandoned? Pure.
 *
 * A record with no beat is treated as stale rather than trusted: an older
 * Radiant that never wrote one must not lock a folder forever.
 */
export function isStale (rec, now = Date.now()) {
  if (!rec || !rec.beatAt) return true
  const beat = Date.parse(rec.beatAt)
  if (!Number.isFinite(beat)) return true
  return now - beat > STALE_MS
}

/** Is this record our own process, or a dead one of ours? Pure except for the pid probe. */
export function isOurs (rec, host = os.hostname(), pid = process.pid) {
  return Boolean(rec) && rec.host === host && rec.pid === pid
}

/**
 * ⚠️ A CRASHED RADIANT ON THIS MAC MUST NOT LOOK LIKE A SECOND MAC. Same host,
 * and the pid is gone — that is our own wreckage and taking it over is right.
 * Only ever asked about this machine's own records; a pid from another Mac means
 * nothing here, which is exactly why `host` is checked first.
 */
export function deadOnThisMac (rec, host = os.hostname()) {
  if (!rec || rec.host !== host || !rec.pid) return false
  try { process.kill(rec.pid, 0); return false } catch (e) { return e.code === 'ESRCH' }
}

/** One host's own record, or null. `host` defaults to this machine. */
export function readLock (dir, host = os.hostname()) {
  try { return JSON.parse(fs.readFileSync(lockPath(dir, host), 'utf8')) } catch { return null }
}

/** Every live-or-dead lock record in the folder, one per Mac that has claimed it. */
export function allLocks (dir) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!isLockFile(name)) continue
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))) } catch { /* corrupt = ignore */ }
  }
  return out
}

/** Write our claim to OUR file only. Atomic, for the same reason every write here is. */
export function writeLock (dir, rec) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const dest = lockPath(dir, rec.host)
    const tmp = dest + '.tmp-' + process.pid
    fs.writeFileSync(tmp, JSON.stringify(rec, null, 2))
    fs.renameSync(tmp, dest)
    return true
  } catch { return false }
}

/**
 * Another Mac (or a second window on this Mac) that is live right now, or null.
 * Read BEFORE we overwrite our own file, so a second window on this Mac — which
 * shares our file — is still visible. Another Mac's file is separate and seen
 * either way.
 */
function contender (dir, { host, pid, now }) {
  let best = null
  for (const rec of allLocks(dir)) {
    if (!rec || isStale(rec, now)) continue
    if (rec.host !== host) { return { host: rec.host, since: rec.startedAt, beatAt: rec.beatAt } } // another Mac wins outright
    // same host, our own shared file: only a DIFFERENT, still-running pid counts
    if (rec.pid !== pid) { try { process.kill(rec.pid, 0); best = { host: rec.host, since: rec.startedAt, beatAt: rec.beatAt } } catch { /* dead: our own wreckage */ } }
  }
  return best
}

/**
 * Remove the pre-per-host shared lock and any iCloud conflict copies it spawned.
 * Safe: it only deletes the legacy shared name and files with iCloud's
 * "<name> <n>.json" conflict suffix — never a valid per-host file, which has no
 * such suffix. Idempotent; runs once at startup.
 */
export function sweepLegacyLocks (dir) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return 0 }
  let n = 0
  for (const name of names) {
    const legacy = name === LEGACY_LOCK_NAME
    const conflict = /^\.radiant-lock.* \d+\.json$/.test(name)   // iCloud fork: "… 2.json"
    if (!legacy && !conflict) continue
    try { fs.unlinkSync(path.join(dir, name)); n++ } catch { /* ignore */ }
  }
  return n
}

export function releaseLock (dir, host = os.hostname(), pid = process.pid) {
  const rec = readLock(dir, host)
  if (rec && !isOurs(rec, host, pid)) return false   // never delete somebody else's
  try { fs.unlinkSync(lockPath(dir, host)); return true } catch { return false }
}

/**
 * Claim the folder and say what we found. Never throws, never blocks.
 *
 * `holder` is another live Radiant we are now sharing with — the only case the
 * UI has anything to say about.
 */
export function claimLock (dir, { host = os.hostname(), pid = process.pid, now = Date.now() } = {}) {
  const holder = contender(dir, { host, pid, now })   // read before we write
  writeLock(dir, lockRecord(host, pid, now))
  return { contested: Boolean(holder), holder }
}

/** Keep our claim fresh, and notice if somebody else is sharing the folder. */
export function beatLock (dir, { host = os.hostname(), pid = process.pid, now = Date.now() } = {}) {
  const mine = readLock(dir, host)
  const holder = contender(dir, { host, pid, now })   // read before we overwrite our own file
  writeLock(dir, { ...lockRecord(host, pid, now), startedAt: (isOurs(mine, host, pid) && mine.startedAt) || new Date(now).toISOString() })
  return { contested: Boolean(holder), holder }
}

/**
 * One sentence for the UI, or null when there is nothing to say.
 *
 * ⚠️ NAME THE MACHINE. "Another copy of Radiant" sends someone hunting.
 *
 * ⚠️ AND DO NOT TELL THEM TO QUIT IT. This used to say "quit one of them",
 * written for a two-Mac evening in August. Tony runs five Macs on one folder:
 * "youre telling me i need to quit radiant on each one to work on another
 * mac?" Since then the server reloads config.json when another Mac writes it,
 * so several copies are safe to run; what is left is the honest limit of a
 * shared folder, and this sentence states it instead of an order.
 */
export function describeHolder (holder, thisHost = os.hostname()) {
  if (!holder) return null
  const elsewhere = holder.host && holder.host !== thisHost
  return elsewhere
    ? `Also open on ${holder.host}, sharing this folder. Settings changed on either ${deviceNoun()} reach the other within a few seconds; a chat runs on whichever ${deviceNoun()} you send from. Avoid editing the same chat on both at the same moment.`
    : `Radiant is open twice on this ${deviceNoun()}, sharing one folder. Two windows editing the same chat at once can overwrite each other — close one.`
}
