/**
 * What you typed but have not sent yet, kept.
 *
 * ⚠️ IT WAS THROWN AWAY THE MOMENT YOU WENT TO GET A MODEL. Paul, testing 1.0
 * on 2026-09-17: he typed into a chat that had no model, and the sentence was
 * gone by the time he came back. That is the whole shape of it — a chat with
 * nothing to answer it is precisely the chat you have to LEAVE, to pick a model
 * or start a download, and leaving unmounted the composer and its React state.
 * Tony, relaying it: "the text should stay in the window while a model is being
 * picked/downloaded."
 *
 * One entry per conversation, so two chats do not share a box.
 *
 * ⚠️ AND A BRAND NEW CHAT GETS A BRAND NEW ID EVERY TIME. "New chat" mints one
 * (MobileShell's openChat, `fresh: true`), and a conversation with no messages
 * is never written to chats.js at all — so the draft of an abandoned new chat
 * belongs to an id nothing else will ever ask for. `adoptDraft` hands it to the
 * next new chat instead of orphaning it, which is the exact path Paul walked:
 * type, leave to get a model, tap New chat, and expect your sentence to be
 * there. Drafts of conversations that DO exist are never adopted — they stay
 * with the conversation they were typed in.
 */
const KEY = 'radiant.phone.drafts'
const MAX = 40

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch { return {} }
}

const write = (map) => {
  // Newest first, then capped: a draft store that grows forever is a leak, and
  // the ones worth keeping are the ones you touched last.
  const rows = Object.entries(map)
    .filter(([, v]) => v && typeof v.text === 'string' && v.text.length)
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .slice(0, MAX)
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(rows))) } catch { /* private mode */ }
}

/** The unsent text for one conversation, or ''. */
export function loadDraft (id) {
  if (!id) return ''
  const row = read()[id]
  return row && typeof row.text === 'string' ? row.text : ''
}

/** Remember (or, with empty text, forget) one conversation's unsent text. */
export function saveDraft (id, text) {
  if (!id) return
  const map = read()
  if (text && text.length) map[id] = { text, at: Date.now() }
  else delete map[id]
  write(map)
}

export function clearDraft (id) { saveDraft(id, '') }

/**
 * Give a fresh conversation the draft left behind by an abandoned one.
 *
 * `knownIds` is every conversation that actually exists; anything else is a
 * chat that was opened, typed in, and left before it had a single message, so
 * its id died with it. The newest such draft moves to `id` and the rest are
 * dropped. Returns the text, or ''.
 */
export function adoptDraft (id, knownIds = []) {
  if (!id) return ''
  const map = read()
  if (map[id]) return map[id].text || ''
  const known = new Set([...knownIds, id])
  const orphans = Object.entries(map)
    .filter(([k, v]) => !known.has(k) && v && v.text)
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
  if (!orphans.length) return ''
  const [, best] = orphans[0]
  for (const [k] of orphans) delete map[k]
  map[id] = { text: best.text, at: best.at || Date.now() }
  write(map)
  return best.text
}
