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
 * Who this message is for.
 *
 * ⚠️ NAMING ONE AGENT WAS NOT ENOUGH. iandouglas, issue #16: "could we also use
 * something like @others to address everyone else?" — with the example
 * "@coder, move the backend to Go; @others update your plan accordingly", and
 * a negation so one agent can sit a round out: "@others !@marketing".
 *
 * That is two different jobs in one message, and the distinction is the whole
 * point: the NAMED agents do the work, and the SWEPT-IN ones revise their own
 * plans in light of it. Collapsing them into one list would tell Marketing to
 * go and rewrite the backend.
 *
 * Returns { ids, named, swept, excluded }:
 *   named     addressed by name, in order of mention — these act
 *   swept     pulled in by @others / @all — these re-plan, they do not act
 *   excluded  removed by !@name, whatever else the message said
 *   ids       named then swept, the order they speak in
 */
const MENTION = /(^|[\s(,;:])(!?)@([a-z0-9][\w.-]*)/gi
const EVERYONE = new Set(['all', 'everyone', 'room'])
const REST = new Set(['others', 'rest', 'everyone-else'])

export function addressing (text, participants) {
  const named = []
  const excluded = []
  let wantsRest = false
  let wantsAll = false
  const match = typed => participants.find(p => {
    const slug = slugName(p.name)
    return typed === slug || typed === slug.replace(/-/g, '') || typed === String(p.name).toLowerCase()
  })
  let m
  MENTION.lastIndex = 0
  while ((m = MENTION.exec(String(text || '')))) {
    const negated = m[2] === '!'
    const typed = m[3].toLowerCase().replace(/[.,;:!?)]+$/, '')
    if (EVERYONE.has(typed)) { if (!negated) wantsAll = true; continue }
    if (REST.has(typed)) { if (!negated) wantsRest = true; continue }
    const hit = match(typed)
    if (!hit) continue
    // ⚠️ EXCLUSION WINS WHEREVER IT APPEARS. "!@marketing" has to beat both an
    // earlier @marketing and a later @others, or sitting a round out depends on
    // word order — which nobody would guess.
    if (negated) { if (!excluded.includes(hit.id)) excluded.push(hit.id) }
    else if (!named.includes(hit.id)) named.push(hit.id)
  }
  const keep = id => !excluded.includes(id)
  const finalNamed = named.filter(keep)
  const swept = (wantsAll || wantsRest)
    ? participants.map(p => p.id).filter(id => keep(id) && !finalNamed.includes(id))
    : []
  return { ids: [...finalNamed, ...swept], named: finalNamed, swept, excluded }
}

/**
 * The participant ids addressed in `text`, in order of first mention, or []
 * when nobody is. Kept as the simple view over addressing() above.
 */
export function addressedParticipants (text, participants) {
  return addressing(text, participants).ids
}

/** The persona addendum for a group turn, for the speaker and the situation. */
export function groupPersona (base, { names, self, addressed, others, role = 'act' }) {
  const shared = `${base || ''}\n\nThis is a group discussion between ${names.join(', ')}. You are ${self}. The other participants' messages are shown to you tagged like "[Name]: …". Speak only as yourself, in the first person, briefly. Add something new — build on or respectfully challenge what the others said; do not repeat them or role-play the other participants.`
  if (!addressed) return shared
  // ⚠️ TWO WAYS TO BE ADDRESSED, AND THEY MUST NOT READ ALIKE. @others sweeps
  // agents in so they can REVISE THEIR OWN PLANS, not so they can all start
  // doing the named agent's job — which is exactly what "you were addressed,
  // do the work" would tell Marketing to do.
  if (role === 'replan') {
    return `${shared}\n\nYou were not asked to do this work — someone else in the room was. You are included so you can update YOUR OWN plan in light of it. Say briefly what changes for your part and what no longer applies, or say plainly that nothing changes. Do not do the other person's task.`
  }
  return `${shared}\n\nYou were addressed directly in this message, so you are the one acting on it${others.length ? ` — ${others.join(', ')} ${others.length === 1 ? 'is' : 'are'} listening and will see what you do and say, but will not act unless asked` : ''}. Do the work yourself, with your tools, and report what you did. If part of it clearly belongs to someone else in the room, say so by name rather than doing it.`
}
