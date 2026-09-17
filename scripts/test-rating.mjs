// Asking for a rating must be earned, once, and must never matter.
//
// ⚠️ RATINGS ARE A RANKING INPUT AND RADIANT HAD NONE. A day after release it
// sat at #17 for "Radiant Local" and outside the top 40 for everything else.
// Tony: "people need to be able to find the app." An ask that nags, or that
// fires on launch, costs more than the ranking it buys — so the rules are
// tested rather than trusted.
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }

// a localStorage and a plugin, as the phone has
const store = new Map()
let asks = 0
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
}
globalThis.window = { Capacitor: { Plugins: { AppRating: { request: async () => { asks++; return { asked: true } } } } } }

const { maybeAskForRating, RATING_MIN_TURNS } = await import('../src/mobile/rating.js')
const reset = () => { store.clear(); asks = 0 }

// ── it must be earned ──────────────────────────────────────────────────────
reset()
maybeAskForRating({ turns: 0 })
ok(asks === 0, 'a fresh install is never asked')
maybeAskForRating({ turns: RATING_MIN_TURNS - 1 })
ok(asks === 0, 'a short exchange is not a real conversation')
maybeAskForRating({ turns: RATING_MIN_TURNS })
ok(asks === 1, 'a real conversation plus a finished download earns the ask')

// ── once, ever ─────────────────────────────────────────────────────────────
maybeAskForRating({ turns: 500 })
maybeAskForRating({ turns: 500 })
ok(asks === 1, 'and it is never asked twice, whatever happens afterwards')

// ⚠️ MARKED BEFORE THE CALL. If the plugin is slow or rejects, a second
// download must not produce a second prompt.
reset()
globalThis.window.Capacitor.Plugins.AppRating.request = async () => { asks++; throw new Error('no') }
maybeAskForRating({ turns: 50 })
maybeAskForRating({ turns: 50 })
ok(asks === 1, 'a failing request still counts as asked')

// ── it must never matter ───────────────────────────────────────────────────
reset()
globalThis.window.Capacitor.Plugins.AppRating = undefined
let threw = null
try { maybeAskForRating({ turns: 50 }) } catch (e) { threw = e }
ok(threw === null, 'a build without the plugin does not throw')
globalThis.window = {}
try { maybeAskForRating({ turns: 50 }) } catch (e) { threw = e }
ok(threw === null, 'and neither does no Capacitor at all')
try { maybeAskForRating() } catch (e) { threw = e }
ok(threw === null, 'nor being called with nothing')

// ── the native side, and where it is called from ───────────────────────────
const sw = readFileSync('apps/ios/ios/App/App/plugins/AppRating.swift', 'utf8')
ok(/CAPPluginMethod\(name: "request"/.test(sw), 'request is registered, or Capacitor refuses it at runtime')
ok(/foregroundActive/.test(sw), 'it asks on the active scene — iPadOS can have more than one')
ok(/AppStore\.requestReview\(in: scene\)/.test(sw) && /SKStoreReviewController/.test(sw),
   'and uses the modern API where it exists, falling back where it does not')

const hook = readFileSync('src/mobile/useLocalModels.js', 'utf8')
ok(/downloadDone[\s\S]{0,900}maybeAskForRating/.test(hook), 'the ask hangs off a finished download, not launch')
ok(/catch \{ \/\* a rating prompt must never affect a download \*\//.test(hook), 'and cannot disturb the download if it fails')

console.log(`\n${pass}/${pass + fail} passed  ·  asked once, when earned, and never in the way`)
process.exit(fail ? 1 : 0)
