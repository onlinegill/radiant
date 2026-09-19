/**
 * Small, fast, typed decisions — Jev, through OpenRouter's decisions endpoint.
 *
 * ⚠️ WHY THIS EXISTS. The harness benchmark (bench/) found one enabled MCP
 * server — Linear — riding on every model call of every chat as 69 tool
 * schemas, 16.6k tokens, whether the message was "close TG-473" or "fix this
 * Django bug". Radiant had no way to know which servers a message needed, so it
 * sent all of them. Jev is a model that does not write text at all: it takes
 * some facts and a multiple-choice question and returns a choice with a
 * calibrated probability, in ~300 ms, for about two thousandths of a cent.
 * Measured 2026-09-18 on nine such questions: nine right. That is the right
 * tool for "does this message need Linear?" — a question a chat model would
 * answer at a thousand times the price and a hundred times the latency.
 *
 * ⚠️ IT IS NEVER ON THE CRITICAL PATH. Every failure — no OpenRouter key, the
 * endpoint down, a timeout, a malformed answer — resolves to `null`, and every
 * caller treats null as "do what Radiant did before": attach everything. A
 * decision model can make the app cheaper; it must never make it work less.
 *
 * ⚠️ THE KEY STAYS HERE. This runs server-side with the OpenRouter key from
 * config; nothing about it reaches the renderer.
 */
import { modelFetch } from './net.js'

// overridable so scripts/test-decide.mjs can point this at a stub
const DECISIONS_URL = process.env.RADIANT_DECISIONS_URL || 'https://openrouter.ai/api/alpha/decisions'
export const DECISION_MODEL = '~typesafe/jev-latest'

/**
 * Ask Jev. `questions` is the endpoint's own shape:
 *   { id: { type: 'noul', instructions, criteria: { true, false } } }
 *   { id: { type: 'choice', instructions, criteria: { option: guidance, … } } }
 * Returns { answers, usage } or null. Never throws.
 */
export async function decide ({ apiKey, state, questions, sessionId, signal, timeoutMs = 4000 }) {
  if (!apiKey || !questions || !Object.keys(questions).length) return null
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const onAbort = () => ctl.abort()
  signal?.addEventListener?.('abort', onAbort, { once: true })
  try {
    const res = await modelFetch(DECISIONS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: DECISION_MODEL, state, questions, ...(sessionId ? { session_id: sessionId } : {}) }),
      signal: ctl.signal
    })
    if (!res.ok) return null
    const json = await res.json()
    if (!json || typeof json.answers !== 'object') return null
    return { answers: json.answers, usage: json.usage || null }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }
}

/** "list_issues, save_issue, …" → "list issues, save issue, …" — enough for a criterion. */
export function describeServer (server, toolNames) {
  const names = (toolNames || []).map(n => n.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '').replace(/[_-]+/g, ' ')).slice(0, 14)
  return `${server.name}${names.length ? ' — tools: ' + names.join(', ') + (toolNames.length > 14 ? ', …' : '') : ''}`
}

/**
 * Which MCP servers' tools does THIS message need?
 *
 * Rules, in order:
 *   1. No way to decide (no key, no decide function, nothing enabled) → all.
 *   2. A server whose tools were used earlier in this conversation stays
 *      attached — the agent is mid-task with it, and a follow-up like "and
 *      close it" says nothing a classifier could catch.
 *   3. For the rest, one yes/no question per server. Attach at p ≥ 0.35: a
 *      wrong "no" costs the user a capability, a wrong "yes" costs tokens.
 *   4. Jev unreachable or an answer missing → that server is attached.
 *
 * `toolsByServer` is { serverId: [toolName, …] }; `history` the session's
 * messages. Returns { attach: Set<serverId>, skipped: [server], decided }.
 */
export async function chooseMcpServers ({ message, history = [], servers = [], toolsByServer = {}, decideFn, apiKey, sessionId, signal }) {
  const enabled = servers.filter(s => s.enabled)
  const all = () => ({ attach: new Set(enabled.map(s => s.id)), skipped: [], decided: false })
  if (!enabled.length || !decideFn || !apiKey) return all()

  // 2. already in use here
  const usedIds = new Set()
  for (const m of history) {
    for (const p of (m.parts || [])) {
      const hit = p.type === 'tool' && /^mcp__([^_]+(?:_[^_]+)*)__/.exec(p.name || '')
      if (hit) usedIds.add(hit[1])
    }
  }
  const toAsk = enabled.filter(s => !usedIds.has(s.id))
  if (!toAsk.length) return { attach: new Set(enabled.map(s => s.id)), skipped: [], decided: false }

  const recent = history.filter(m => m.role === 'user').slice(-3).map(m => String(m.text || '').slice(0, 400))
  const questions = {}
  for (const s of toAsk) {
    questions[s.id] = {
      type: 'noul',
      instructions: `Does acting on the user's latest message require the "${s.name}" tools? Only the latest message matters; earlier ones are context.`,
      criteria: {
        true: `The latest message asks for something these tools do: ${describeServer(s, toolsByServer[s.id] || [])}.`,
        false: 'The latest message can be handled with files, the shell, the web, or a plain answer — none of these tools are needed.'
      }
    }
  }
  const out = await decideFn({ apiKey, sessionId, signal, state: { latest_message: String(message || '').slice(0, 2000), earlier_messages: recent }, questions })
  if (!out) return all()

  const attach = new Set(usedIds)
  const skipped = []
  for (const s of toAsk) {
    const a = out.answers?.[s.id]
    const p = a && typeof a.noul === 'number' ? a.noul : null
    if (p == null || p >= 0.35) attach.add(s.id)
    else skipped.push({ id: s.id, name: s.name, p })
  }
  return { attach, skipped, decided: true, usage: out.usage }
}

/**
 * Which model should answer THIS message: the one the user picked, or a fast
 * one on the same provider?
 *
 * ⚠️ WHY. Most messages in a coding chat are not coding: "what did that
 * error say", "rename it", "and the other file?", "thanks, now commit". Each
 * one waits on the strongest model the user owns — 5–20 s and full price —
 * for an answer a fast model gives in 2 s at a tenth of the cost. Jev reads
 * the message and says "easy" or "hard" in 300 ms; a fast model takes the
 * easy ones. The reply says which model answered, so nothing is hidden.
 *
 * Rules, in order — each is a way routing could make the app worse:
 *   1. No fast model, or it IS the chosen model → keep.
 *   2. Plan mode, a group chat, or an agent with its own model → keep.
 *   3. Mid-task: the previous reply used tools → keep. "And close it" says
 *      nothing a classifier could catch; the big model has the thread.
 *   4. Attachments, a slash command, or a long message (> 4000 chars) → keep.
 *   5. Ask. Jev if there is a key; else `judgeFn` (a cheap model, 1–2 s);
 *      else keep. Route only at p ≥ 0.8 — a wrong "easy" costs the user a
 *      worse answer, a wrong "hard" costs a few seconds.
 *   6. Any failure → keep. Routing can make Radiant faster; it must never
 *      make it answer worse.
 */
export const ROUTE_BAR = 0.8
export async function chooseModel ({ message, attachments = [], history = [], sessionModel, fastModel, planMode, group, agentModel, decideFn, judgeFn, apiKey, sessionId, signal }) {
  const keep = reason => ({ model: sessionModel, routed: false, reason })
  if (!fastModel || fastModel === sessionModel) return keep('no fast model')
  if (planMode || group || agentModel) return keep(planMode ? 'plan mode' : group ? 'group chat' : 'agent model')
  const text = String(message || '')
  if (attachments.length || text.startsWith('/') || text.length > 4000) return keep('attachments, command, or long')
  // 3. the previous assistant reply, before the message just added
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role === 'user' && i === history.length - 1) continue
    if (m.role === 'assistant') { if ((m.parts || []).some(p => p.type === 'tool')) return keep('mid-task'); break }
  }
  const recent = history.filter(m => m.role === 'user').slice(-4, -1).map(m => String(m.text || '').slice(0, 300))
  const state = { latest_message: text.slice(0, 2000), earlier_messages: recent }
  const question = {
    type: 'noul',
    instructions: 'Could a small, fast model (Claude Haiku, GPT mini, Gemini Flash) answer the latest_message well, or does it need the strongest model available? Judge the latest message; earlier ones are context only.',
    criteria: {
      true: 'A short factual question; a quick lookup; a one-line or one-file edit; a wording, naming or formatting change; a question about the conversation so far; a greeting or thanks; a simple command to run and report.',
      false: 'Changes across several files; debugging or diagnosing a failure; design, architecture or trade-off decisions; anything the user calls hard, careful, important or thorough; long documents to write; multi-step reasoning or math; an ambiguous task that needs judgment.'
    }
  }
  let p = null, judge = null
  try {
    if (decideFn && apiKey) {
      const out = await decideFn({ apiKey, sessionId, signal, state, questions: { easy: question } })
      const a = out?.answers?.easy
      if (a && typeof a.noul === 'number') { p = a.noul; judge = 'jev' }
    } else if (judgeFn) {
      const v = await judgeFn(state, question)
      if (typeof v === 'number') { p = v; judge = 'model' }
    }
  } catch { p = null }
  if (p == null) return keep('no judge')
  if (p >= ROUTE_BAR) return { model: fastModel, routed: true, p, judge, reason: 'easy' }
  return { model: sessionModel, routed: false, p, judge, reason: 'hard' }
}
