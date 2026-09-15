/**
 * The fetch model calls go through.
 *
 * ⚠️ NODE'S fetch GIVES UP AFTER FIVE SILENT MINUTES, AND SAYS "terminated".
 * undici, which is what Node's fetch is, ships headersTimeout and bodyTimeout
 * of 300 000 ms. A local model does not know that: a 27B on Apple Silicon can
 * take minutes to load and minutes more to chew through a long prompt before
 * the first byte, and a thinking model can be silent for as long as it
 * thinks. When the clock ran out the round threw `TypeError: terminated`,
 * which reached the chat as the whole explanation. Tony: "why was this
 * terminated?" — and, with a reviewer watching, "models just failing silently
 * and stopping mid chat."
 *
 * Model calls run on an agent with no timeouts. Cancellation is the turn's
 * AbortSignal, which Stop and a closed connection already drive; a request
 * that will never answer is caught by the turn's own budget, not by a timer
 * that fires at the moment a large model happens to be busy.
 */
import { Agent } from 'undici'

export const PATIENCE = { headersTimeout: 0, bodyTimeout: 0 }   // 0 = never
const patient = new Agent(PATIENCE)

export function modelFetch (url, opts = {}) {
  return fetch(url, { ...opts, dispatcher: patient })
}
