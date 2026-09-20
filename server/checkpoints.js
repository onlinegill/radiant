/**
 * Checkpoints: the project's files, snapshotted around every turn, so a
 * reply's changes can be undone without touching the conversation.
 *
 * ⚠️ WHY. Auto mode plus the Jev guard decide what the agent may RUN; nothing
 * undid what it had DONE. A bad refactor that slipped through meant reaching
 * for git by hand, and a folder that was never a repo had no undo at all.
 * Cline's checkpoints (a shadow git repo beside the project, a snapshot per
 * step, "restore files / restore task / both") are the idea; this is the
 * per-turn version: one snapshot before the turn starts, one after its last
 * tool, and "undo this reply's changes" on the message.
 *
 * ⚠️ THE SHADOW REPO IS NOT THE PROJECT'S REPO. It lives under Radiant's data
 * folder, keyed by the project path, with the project as its work tree — so
 * the project's own .git and history are never touched, untracked files are
 * covered too, and a folder with no git at all still gets an undo. It honours
 * the project's .gitignore, so node_modules never goes in.
 *
 * ⚠️ NEVER THE HOME FOLDER. A chat whose working folder is ~ (the default when
 * no project is set) cannot be snapshotted — that is the whole disk. Such
 * chats get no checkpoint, and say so once. A snapshot that takes longer than
 * SLOW_MS disables checkpoints for that folder for the rest of the process:
 * an undo that costs ten seconds per turn is not worth having.
 */
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SLOW_MS = 8000
const disabled = new Map()   // cwd -> reason
const GIT = fs.existsSync('/usr/bin/git') ? '/usr/bin/git' : 'git'

export function checkpointDir (dataDir, cwd) {
  return path.join(dataDir, 'checkpoints', crypto.createHash('sha1').update(path.resolve(cwd)).digest('hex').slice(0, 16))
}

export function eligible (cwd) {
  if (!cwd) return { ok: false, reason: 'no folder' }
  const p = path.resolve(cwd)
  if (p === os.homedir() || p === '/' || p === path.parse(p).root) return { ok: false, reason: 'the home folder is too big to snapshot — set a project folder for this chat' }
  try { if (!fs.statSync(p).isDirectory()) return { ok: false, reason: 'not a folder' } } catch { return { ok: false, reason: 'folder missing' } }
  if (disabled.has(p)) return { ok: false, reason: disabled.get(p) }
  return { ok: true }
}

function git (dir, cwd, args, ms = SLOW_MS) {
  return new Promise((resolve, reject) => {
    execFile(GIT, ['--git-dir', dir, '--work-tree', cwd, ...args], { cwd, timeout: ms, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', HOME: process.env.HOME } },
      (err, stdout, stderr) => err ? reject(Object.assign(new Error((stderr || err.message).trim()), { killed: err.killed })) : resolve(String(stdout)))
  })
}

async function ensure (dataDir, cwd) {
  const dir = checkpointDir(dataDir, cwd)
  if (!fs.existsSync(path.join(dir, 'HEAD'))) {
    fs.mkdirSync(dir, { recursive: true })
    await git(dir, cwd, ['init', '-q'])
    await git(dir, cwd, ['config', 'user.email', 'checkpoints@radiant'])
    await git(dir, cwd, ['config', 'user.name', 'Radiant checkpoints'])
    await git(dir, cwd, ['config', 'core.autocrlf', 'false'])
    // the project's own .gitignore applies through the work tree; these are on top
    const ex = path.join(dir, 'info', 'exclude')
    fs.mkdirSync(path.dirname(ex), { recursive: true })
    fs.writeFileSync(ex, ['.git', 'node_modules', '.DS_Store', '*.log', '.venv', 'venv', '__pycache__', 'DerivedData', 'release/', '.next', '.cache'].join('\n') + '\n')
  }
  return dir
}

/** Snapshot the folder. Returns { sha, changed } or null (not eligible / too slow). */
export async function snapshot (dataDir, cwd, label = 'checkpoint') {
  const e = eligible(cwd)
  if (!e.ok) return null
  const p = path.resolve(cwd)
  const t0 = Date.now()
  try {
    const dir = await ensure(dataDir, p)
    await git(dir, p, ['add', '-A', '--', '.'])
    let head = null
    try { head = (await git(dir, p, ['rev-parse', '--verify', 'HEAD'])).trim() } catch {}
    let changed = true
    if (head) { try { await git(dir, p, ['diff', '--cached', '--quiet', 'HEAD']); changed = false } catch {} }
    if (!changed && head) return { sha: head, changed: false }
    await git(dir, p, ['commit', '-q', '--allow-empty', '-m', label])
    const sha = (await git(dir, p, ['rev-parse', 'HEAD'])).trim()
    if (Date.now() - t0 > SLOW_MS) disabled.set(p, 'snapshots take too long here')
    return { sha, changed: true }
  } catch (e) {
    if (e.killed || /timed out/i.test(e.message)) disabled.set(p, 'snapshots take too long here')
    else console.error('[checkpoint]', e.message)
    return null
  }
}

/** What changed between two snapshots: [{ file, added, removed }]. */
export async function changes (dataDir, cwd, from, to) {
  const p = path.resolve(cwd)
  const dir = checkpointDir(dataDir, p)
  if (!fs.existsSync(path.join(dir, 'HEAD')) || !from || !to || from === to) return []
  const out = await git(dir, p, ['diff', '--numstat', from, to])
  return out.split('\n').filter(Boolean).map(l => { const [a, r, ...f] = l.split('\t'); return { file: f.join('\t'), added: a === '-' ? null : Number(a), removed: r === '-' ? null : Number(r) } })
}

/** The unified diff for one file between two snapshots (capped). */
export async function fileDiff (dataDir, cwd, from, to, file) {
  const p = path.resolve(cwd)
  const dir = checkpointDir(dataDir, p)
  const out = await git(dir, p, ['diff', '--no-color', from, to, '--', file])
  return out.length > 200000 ? out.slice(0, 200000) + '\n… (truncated)' : out
}

/**
 * Put the folder back to a snapshot. The current state is snapshotted first,
 * so a restore is itself undoable; the sha of that safety snapshot is
 * returned. Files added since the snapshot are removed (git clean -fd —
 * ignored files such as node_modules are left alone).
 */
export async function restore (dataDir, cwd, sha) {
  const e = eligible(cwd)
  if (!e.ok) throw new Error(e.reason)
  const p = path.resolve(cwd)
  const dir = await ensure(dataDir, p)
  const safety = await snapshot(dataDir, p, 'before restore')
  await git(dir, p, ['checkout', '-q', sha, '--', '.'], 30000)
  // checkout puts back what the snapshot HAD; files created since it are
  // still here, tracked by the safety snapshot, and have to go by name
  const gone = (await git(dir, p, ['diff', '--name-only', '--diff-filter=D', 'HEAD', sha])).split('\n').filter(Boolean)
  for (const f of gone) { try { fs.rmSync(path.join(p, f), { force: true }) } catch {} }
  await git(dir, p, ['clean', '-fdq'], 30000)
  // what the restore touched, for the transcript
  const touched = safety?.sha ? await changes(dataDir, p, safety.sha, sha) : []
  return { safety: safety?.sha || null, touched }
}
