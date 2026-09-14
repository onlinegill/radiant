/**
 * When the chat's model is not answering, try the fallback the person chose.
 *
 * ⚠️ AN OUTAGE ENDED THE TURN. If xAI or OpenRouter had a bad hour, the turn
 * threw, the chat showed the provider's error, and that was that — the person
 * had to open the model picker, choose something else, and send again. Every
 * other harness on the LangChain checklist (2026-06) has a fallback; Radiant
 * did not. Settings → Models → "If the model is not answering" names one, and
 * a turn that fails BEFORE ANYTHING HAPPENED — no text, no tool calls — is
 * rerun on it, with a notice saying so. A turn that had already done work is
 * not silently redone on a different model: that would repeat tool calls.
 *
 * Only outages count. A 401, a 402, a 400 for a bad request, a refused key —
 * those are about THIS account or THIS request and the fallback would fail
 * the same way or hide a fixable problem.
 */

/** Is this error message the provider being unavailable, as opposed to us being wrong? */
export function isOutage (message) {
  const m = String(message || '')
  if (/^(400|401|402|403|404)\b/.test(m)) return false
  if (/authentication|api key|quota|credit|billing|restricted|too long|context/i.test(m)) return false
  return /\b(429|5\d\d)\b|overloaded|over capacity|capacity|rate.?limit|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|timed? ?out|unavailable|bad gateway|internal server error|stream error/i.test(m)
}

/**
 * Decide whether to rerun the turn on the fallback.
 * `assistant` is the message the failed turn pushed; `current`/`fallback` are { provider, model }.
 */
export function shouldFallBack ({ message, assistant, current, fallback }) {
  if (!fallback || !fallback.provider || !fallback.model) return { ok: false, why: 'no fallback set' }
  if (fallback.provider === current?.provider && fallback.model === current?.model) return { ok: false, why: 'fallback is the same model' }
  if (!isOutage(message)) return { ok: false, why: 'not an outage' }
  const parts = (assistant?.parts || []).filter(p => p && p.type !== 'notice')
  if (parts.length) return { ok: false, why: 'the turn had already done work' }
  return { ok: true }
}

/** The sentence the chat shows when the fallback takes over. */
export function fallbackNotice ({ current, fallback, message }) {
  const why = String(message || '').replace(/\s+/g, ' ').slice(0, 120)
  return `${current.model} on ${current.providerName || current.provider} is not answering (${why}) — continuing on ${fallback.model}.`
}
