/**
 * Asking for a rating — once, at a moment that has earned it.
 *
 * ⚠️ RATINGS ARE A RANKING INPUT AND RADIANT HAS NONE, which is a large part of
 * why a day after release it was findable at #17 for "Radiant Local" and
 * nowhere in the top 40 for anything else. Tony: "people need to be able to
 * find the app."
 *
 * ⚠️ AND THE ASK MUST BE EARNED, OR IT COSTS MORE THAN IT WINS. The rules here,
 * in order of how badly each one reads when broken:
 *   · never on launch, never mid-task — only after something worked;
 *   · the person must have DONE something real first: a finished download and
 *     a conversation with actual turns in it, not a tap;
 *   · at most once ever from this app's side. The system also caps it at three
 *     a year, but "the system will stop me" is not a reason to ask twice;
 *   · it can never block, branch or report failure. A rating prompt that
 *     changes what the app does is a rating prompt that has gone wrong.
 */
const KEY = 'radiant.phone.ratingAsked'
const MIN_TURNS = 6     // a real conversation, not a hello

const asked = () => {
  try { return localStorage.getItem(KEY) === '1' } catch { return true }
}
const markAsked = () => {
  try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
}

/**
 * Ask, if this is a moment worth asking at. Returns nothing and throws
 * nothing — callers must not care.
 */
export function maybeAskForRating ({ turns = 0 } = {}) {
  try {
    if (asked()) return
    if (!Number.isFinite(turns) || turns < MIN_TURNS) return
    const plugin = window.Capacitor?.Plugins?.AppRating
    if (!plugin?.request) return
    markAsked()          // before the call: asking twice is worse than not asking
    plugin.request().catch(() => {})
  } catch { /* never let this affect anything */ }
}

/** Test seam. */
export const RATING_KEY = KEY
export const RATING_MIN_TURNS = MIN_TURNS
