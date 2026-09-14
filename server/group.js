/**
 * Who speaks in a group chat.
 *
 * ⚠️ EVERY AGENT ANSWERED EVERY MESSAGE, AND NONE COULD USE TOOLS. iandouglas,
 * issues #16 and #18: "if I say in group chat 'let's do the frontend in React'
 * right now all 4 models are going to go try to accomplish the same task at the
 * same time" — and "all 3 came back saying they couldn't access tools".
 *
 * Addressing fixes both. `@Coder, plan the stack` makes Coder the only speaker
 * this turn, and because one agent is acting rather than four talking, that
 * agent runs with the chat's tools. The rest of the room stays silent AND
 * aware: the message and Coder's reply are in the transcript every agent reads
 * on its next turn. No mention → the round-table behaviour as before, without
 * tools, because four agents editing one folder at once is the thing nobody
 * wants.
 */

/** A name as it can be typed after @: "Dev Ops" → "dev-ops"; also "devops". */
export function slugName (name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * The participant ids addressed in `text`, in order of first mention, or [] when
 * nobody is. `participants` is [{ id, name }].
 */
export function addressedParticipants (text, participants) {
  const out = []
  const re = /(^|[\s(,;:])@([a-z0-9][\w.-]*)/gi
  let m
  while ((m = re.exec(String(text || '')))) {
    const typed = m[2].toLowerCase().replace(/[.,;:!?)]+$/, '')
    const hit = participants.find(p => {
      const slug = slugName(p.name)
      return typed === slug || typed === slug.replace(/-/g, '') || typed === String(p.name).toLowerCase()
    })
    if (hit && !out.includes(hit.id)) out.push(hit.id)
  }
  return out
}

/** The persona addendum for a group turn, for the speaker and the situation. */
export function groupPersona (base, { names, self, addressed, others }) {
  const shared = `${base || ''}\n\nThis is a group discussion between ${names.join(', ')}. You are ${self}. The other participants' messages are shown to you tagged like "[Name]: …". Speak only as yourself, in the first person, briefly. Add something new — build on or respectfully challenge what the others said; do not repeat them or role-play the other participants.`
  if (!addressed) return shared
  return `${shared}\n\nYou were addressed directly in this message, so you are the one acting on it${others.length ? ` — ${others.join(', ')} ${others.length === 1 ? 'is' : 'are'} listening and will see what you do and say, but will not act unless asked` : ''}. Do the work yourself, with your tools, and report what you did. If part of it clearly belongs to someone else in the room, say so by name rather than doing it.`
}
