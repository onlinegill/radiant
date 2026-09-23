// A single-use refresh token is spent once, however many callers need it.
//
// ⚠️ Nous (and OpenAI) rotate the refresh token on every use. Parallel graph
// nodes each found the access token expired and each refreshed with the same
// refresh token; the provider accepted the first and refused the second, which
// reported "session expired — sign in again" though the session was fine.
let pass = 0, fail = 0
const ok = (c, what) => { if (c) pass++; else { fail++; console.log('  FAIL', what) } }

// a token endpoint that honours each refresh token exactly once
let live = new Set(['r0']), calls = 0, n = 0
globalThis.fetch = async (url, opts) => {
  calls++
  await new Promise(r => setTimeout(r, 50))
  const used = opts.headers['x-nous-refresh-token']
  if (!live.has(used)) return new Response('used', { status: 401 })
  live.delete(used); n++; live.add('r' + n)
  return new Response(JSON.stringify({ access_token: 'a' + n, refresh_token: 'r' + n, expires_in: 900 }), { status: 200 })
}
const { validAccessToken } = await import('../server/oauth.js')
const expired = () => ({ oauth: { nousresearch: { access: 'a0', refresh: 'r0', expires: Date.now() - 1000 } } })
let saves = 0
const save = () => { saves++ }

// two callers, each with its own copy of the config (graph nodes load their own)
const [x, y] = await Promise.allSettled([validAccessToken('nousresearch', expired(), save), validAccessToken('nousresearch', expired(), save)])
ok(x.status === 'fulfilled' && y.status === 'fulfilled', `both callers get a token, neither is told the session expired (${x.reason?.message || ''}${y.reason?.message || ''})`)
ok(x.value === 'a1' && y.value === 'a1', `they share one refresh (${x.value}, ${y.value})`)
ok(calls === 1 && saves === 1, `the refresh token was spent once (${calls} calls, ${saves} saves)`)

// a caller still holding the old config gets the minted token, not a dead refresh
const stale = expired()
const z = await validAccessToken('nousresearch', stale, save).catch(e => e.message)
ok(z === 'a1' && calls === 1, `an older copy of the config reuses the new token (${z}, ${calls} calls)`)
ok(stale.oauth.nousresearch.refresh === 'r1', 'and that copy is updated, so saving it later cannot put the dead token back')

console.log(`\n${pass}/${pass + fail} passed  ·  one refresh per provider, however many callers need it`)
process.exit(fail ? 1 : 0)
