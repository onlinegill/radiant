// The PR row's parsing: gh's statusCheckRollup and merge state → what the UI draws.
// The exec/hide paths (not-git, detached, default-branch, no-gh) are verified by
// hand against real repos; this pins the pure transforms where the bugs live.
import { repoSlug, mergeTone, normalizeChecks, ciRollup } from '../server/pr.js'
let pass = 0, fail = 0
const ok = (c, what) => { if (c) pass++; else { fail++; console.log('  FAIL', what) } }

// repo slug from either remote form
ok(repoSlug('git@github.com:templetongroup/radiant.git') === 'templetongroup/radiant', 'ssh remote → slug')
ok(repoSlug('https://github.com/templetongroup/radiant.git') === 'templetongroup/radiant', 'https remote → slug')
ok(repoSlug('https://github.com/templetongroup/radiant') === 'templetongroup/radiant', 'no .git suffix → slug')
ok(repoSlug('https://gitlab.com/x/y.git') === null, 'non-github remote → no slug')

// merge tone
ok(mergeTone('CLEAN') === 'ready', 'CLEAN → ready')
ok(mergeTone('BLOCKED') === 'blocked' && mergeTone('DIRTY') === 'blocked', 'BLOCKED/DIRTY → blocked')
ok(mergeTone('BEHIND') === 'behind', 'BEHIND → behind')
ok(mergeTone('UNKNOWN') === 'unknown', 'unknown → unknown')

// checks: CheckRun (Actions) and StatusContext (legacy) both normalize
const rollup = [
  { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'u1' },
  { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', detailsUrl: 'u2' },
  { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'u3' },
  { __typename: 'CheckRun', name: 'flaky', status: 'COMPLETED', conclusion: 'NEUTRAL' },
  { __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS', targetUrl: 'u4' }
]
const norm = normalizeChecks(rollup)
ok(norm.length === 5, 'all checks normalized')
ok(norm[0].state === 'pass' && norm[0].url === 'u1', 'a completed success is pass with its url')
ok(norm[1].state === 'pending', 'an in-progress run is pending')
ok(norm[2].state === 'fail', 'a failed run is fail')
ok(norm[3].state === 'skipped', 'a neutral run is skipped')
ok(norm[4].state === 'pass' && norm[4].name === 'ci/legacy', 'a legacy status context maps too')

// the rollup: fail beats pending beats pass; none when empty
ok(ciRollup(norm) === 'fail', 'any failure → fail overall')
ok(ciRollup([{ state: 'pass' }, { state: 'pending' }]) === 'pending', 'pending (no fail) → pending')
ok(ciRollup([{ state: 'pass' }, { state: 'skipped' }]) === 'pass', 'all pass/skipped → pass')
ok(ciRollup([]) === 'none', 'no checks → none')
ok(normalizeChecks(undefined).length === 0, 'a PR with no rollup does not throw')

console.log(`\n${pass}/${pass + fail} passed  ·  the PR row reads gh's checks and merge state correctly`)
process.exit(fail ? 1 : 0)
