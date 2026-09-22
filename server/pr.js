/**
 * The current branch's GitHub pull request, for the row above the composer.
 *
 * ⚠️ THIS ONLY READS. It runs `gh` and `git` to REPORT a PR, its merge state,
 * its size and its CI — it never pushes, opens, or merges anything. "Create PR"
 * in the UI opens GitHub's compare page in the browser; the user submits it.
 * Taken from Cline's desktop composer after Tony reviewed it.
 *
 * ⚠️ AND IT HIDES ITSELF RATHER THAN ERRORING. No gh, not signed in, not a
 * GitHub repo, the default branch, a detached HEAD, no project folder — each is
 * "nothing to show", not a failure. The row simply does not appear.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { usableCwd } from './config.js'

const GIT = fs.existsSync('/usr/bin/git') ? '/usr/bin/git' : 'git'
// AGENTS.md: /usr/local/bin/gh is an Intel binary with no Rosetta; prefer brew's.
const GH = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'].find(p => { try { return fs.existsSync(p) } catch { return false } }) || 'gh'

function run (cmd, args, cwd, ms = 12000) {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd, timeout: ms, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', HOME: process.env.HOME } },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), errText: String(stderr || '') }))
  })
}

// gh availability is stable and slowish to check; cache it briefly (Cline: 5 min).
let ghCache = { at: 0, ok: false }
async function ghAvailable () {
  if (Date.now() - ghCache.at < 5 * 60_000) return ghCache.ok
  let ok = false
  try { const r = await run(GH, ['auth', 'status'], undefined, 8000); ok = r.code === 0 } catch {}
  ghCache = { at: Date.now(), ok }
  return ok
}

export function repoSlug (originUrl) {
  const m = String(originUrl).trim().match(/github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?$/i)
  return m ? m[1] : null
}

/** CLEAN/BLOCKED/BEHIND/DIRTY/… → a plain tone the UI can colour. */
export function mergeTone (s) {
  if (s === 'CLEAN' || s === 'HAS_HOOKS' || s === 'UNSTABLE') return 'ready'
  if (s === 'BLOCKED' || s === 'DIRTY') return 'blocked'
  if (s === 'BEHIND') return 'behind'
  return 'unknown'
}

/** statusCheckRollup entries → {name, state, url}; state is pass|fail|pending|skipped. */
export function normalizeChecks (rollup) {
  const out = []
  for (const c of (Array.isArray(rollup) ? rollup : [])) {
    const name = c.name || c.context || 'check'
    const url = c.detailsUrl || c.targetUrl || c.link || null
    let state
    if (c.__typename === 'CheckRun') {
      if (c.status && c.status !== 'COMPLETED') state = 'pending'
      else state = ({ SUCCESS: 'pass', NEUTRAL: 'skipped', SKIPPED: 'skipped', FAILURE: 'fail', TIMED_OUT: 'fail', CANCELLED: 'fail', ACTION_REQUIRED: 'fail', STARTUP_FAILURE: 'fail' })[c.conclusion] || 'pending'
    } else { // StatusContext
      state = ({ SUCCESS: 'pass', PENDING: 'pending', EXPECTED: 'pending', ERROR: 'fail', FAILURE: 'fail' })[c.state] || 'pending'
    }
    out.push({ name, state, url })
  }
  return out
}
export const ciRollup = checks => checks.some(c => c.state === 'fail') ? 'fail'
  : checks.some(c => c.state === 'pending') ? 'pending'
    : checks.length ? 'pass' : 'none'

/**
 * What to show for `cwd`. Returns { show:false, reason } when there is nothing,
 * or { show:true, branch, pr?, checks?, ciState, canCreate } otherwise.
 */
export async function prStatus (cwd) {
  const dir = usableCwd(cwd).dir
  if (!dir) return { show: false, reason: 'no-folder' }
  // a git repo?
  const inRepo = await run(GIT, ['-C', dir, 'rev-parse', '--is-inside-work-tree'], undefined, 6000)
  if (inRepo.code !== 0 || inRepo.out.trim() !== 'true') return { show: false, reason: 'not-git' }
  // current branch; detached HEAD has no PR row
  const br = await run(GIT, ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], undefined, 6000)
  const branch = br.out.trim()
  if (!branch || branch === 'HEAD') return { show: false, reason: 'detached' }
  // a GitHub origin?
  const origin = await run(GIT, ['-C', dir, 'remote', 'get-url', 'origin'], undefined, 6000)
  if (origin.code !== 0 || !/github\.com/i.test(origin.out)) return { show: false, reason: 'not-github' }
  // the default branch has no PR of its own
  let def = ''
  const sym = await run(GIT, ['-C', dir, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], undefined, 6000)
  if (sym.code === 0) def = sym.out.trim().replace(/^refs\/remotes\/origin\//, '')
  if (!def && /\b(main|master)\b/.test(branch)) def = branch
  if (branch === def) return { show: false, reason: 'default-branch' }

  if (!(await ghAvailable())) return { show: false, reason: 'no-gh' }

  // one gh call gets the PR and its CI
  const view = await run(GH, ['pr', 'view', branch, '--json', 'number,url,title,isDraft,state,mergeStateStatus,additions,deletions,statusCheckRollup'], dir, 12000)
  if (view.code !== 0) {
    // no PR for this branch yet — offer to open GitHub's compare page (the user
    // submits it there; Radiant never opens a PR itself)
    const slug = repoSlug(origin.out)
    return { show: true, branch, hasPr: false, canCreate: true, compareUrl: slug ? `https://github.com/${slug}/compare/${encodeURIComponent(branch)}?expand=1` : null }
  }
  let d = null
  try { d = JSON.parse(view.out) } catch { return { show: false, reason: 'parse' } }
  if (!d || d.state === 'MERGED' || d.state === 'CLOSED') return { show: false, reason: 'closed' }
  const checks = normalizeChecks(d.statusCheckRollup)
  return {
    show: true,
    branch,
    hasPr: true,
    pr: {
      number: d.number, url: d.url, title: d.title || '', isDraft: Boolean(d.isDraft),
      mergeStateStatus: d.mergeStateStatus || 'UNKNOWN', mergeTone: mergeTone(d.mergeStateStatus),
      additions: d.additions || 0, deletions: d.deletions || 0
    },
    checks,
    ciState: ciRollup(checks),
    compareUrl: null
  }
}
