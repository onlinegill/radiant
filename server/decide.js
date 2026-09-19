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

/**
 * Which of the always-on skills does THIS message need?
 *
 * Skills ride in the system prompt, so every always-on skill is on every
 * request of every chat — a house-style guide, a deploy checklist and a
 * PDF-filling procedure all along for "say hi". Same shape as MCP servers:
 * one yes/no per skill, attach at p ≥ 0.35, and STICKY — a skill attached
 * once in a chat stays, so the cached system prefix only ever grows rather
 * than churning from message to message.
 *
 * Only skills that are on for everything are judged. A skill the agent
 * carries or one added to this chat with a slash command was chosen on
 * purpose and always goes. Any failure → all, as before.
 */
export async function chooseSkills ({ message, history = [], skills = [], judged = new Set(), sticky = new Set(), decideFn, apiKey, sessionId, signal }) {
  const all = () => ({ attach: new Set(skills.map(s => s.id)), skipped: [], decided: false })
  const toAsk = skills.filter(s => judged.has(s.id) && !sticky.has(s.id))
  if (!toAsk.length || !decideFn || !apiKey) return all()
  const recent = history.filter(m => m.role === 'user').slice(-3).map(m => String(m.text || '').slice(0, 400))
  const questions = {}
  for (const s of toAsk) {
    questions[s.id] = {
      type: 'noul',
      instructions: `Would the "${s.name}" skill help with the user's latest message? Only the latest message matters; earlier ones are context.`,
      criteria: {
        true: `The latest message is the kind of task this skill is for: ${String(s.description || s.content || '').slice(0, 300)}`,
        false: 'The latest message is unrelated to what this skill covers.'
      }
    }
  }
  const out = await decideFn({ apiKey, sessionId, signal, state: { latest_message: String(message || '').slice(0, 2000), earlier_messages: recent }, questions })
  if (!out) return all()
  const attach = new Set(skills.filter(s => !judged.has(s.id) || sticky.has(s.id)).map(s => s.id))
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
 * After a turn: is any of the housekeeping worth a model call?
 *
 * Three background writers used to run after every turn — a title, a memory
 * distiller, a skill reflection — each a model call, on turns like "thanks".
 * One Jev request answers all three at once (questions run in parallel;
 * the extra ones are nearly free), and only the writers that pass run.
 * Bars: memory 0.3 (a missed fact is worse than a wasted call), skill 0.5,
 * "the heuristic title is already fine" 0.7 (the writer is skipped only when
 * Jev is sure). Unreachable → run everything, as before.
 */
export async function chooseHousekeeping ({ userText, assistantText, toolNames = [], heuristicTitle, wantTitle, wantMemory, wantSkill, decideFn, apiKey, sessionId, signal }) {
  const all = { title: wantTitle, memory: wantMemory, skill: wantSkill, decided: false }
  if (!decideFn || !apiKey || !(wantTitle || wantMemory || wantSkill)) return all
  const questions = {}
  if (wantTitle) questions.title_ok = { type: 'noul', instructions: `Is "${heuristicTitle}" already a good short title for a chat that begins with the user's message — clear about the topic, not cut off mid-thought?`, criteria: { true: 'It reads as a title someone would give the chat.', false: 'It is a truncated fragment, starts with filler, or misses the point.' } }
  if (wantMemory) questions.memory = { type: 'noul', instructions: 'Does this exchange contain a NEW, durable fact about the user or their project — a preference, decision, name, convention, tool or goal — worth remembering in later chats?', criteria: { true: 'A lasting fact is stated or decided here.', false: 'Task chatter, a one-off request, an answer that leaves nothing to remember.' } }
  if (wantSkill) questions.skill = { type: 'noul', instructions: 'Does this exchange show a repeatable, multi-step procedure — how to do a recurring kind of task — that would be worth saving as a reusable skill?', criteria: { true: 'A sequence of steps that will recur, or a correction of how something should be done from now on.', false: 'A one-off answer, a single command, a question, or chatter.' } }
  const state = { user_message: String(userText || '').slice(0, 1500), assistant_reply: String(assistantText || '').slice(0, 1500), tools_used: toolNames.slice(0, 20) }
  const out = await decideFn({ apiKey, sessionId, signal, state, questions })
  if (!out) return all
  const p = k => { const a = out.answers?.[k]; return a && typeof a.noul === 'number' ? a.noul : null }
  return {
    title: wantTitle && !(p('title_ok') != null && p('title_ok') >= 0.7),
    memory: wantMemory && (p('memory') == null || p('memory') >= 0.3),
    skill: wantSkill && (p('skill') == null || p('skill') >= 0.5),
    decided: true, usage: out.usage, p: { title_ok: p('title_ok'), memory: p('memory'), skill: p('skill') }
  }
}

/**
 * Auto mode's second opinion: is this command safe to run without asking?
 *
 * The rule list in util.js (commandRisk) knows `rm -rf` and `sudo`; it does
 * not know that `git checkout -- .` throws away uncommitted work, that
 * `curl -d @~/.ssh/id_rsa` is exfiltration, or that `find / -delete` is a
 * catastrophe spelled without rm. Jev reads the command with the folder and
 * the user's own words and answers four questions in one request. Anything
 * at or over 0.5 turns a silent run into a question, with the reason shown.
 *
 * Jev can only ESCALATE here. A command the rules call risky is never waved
 * through on Jev's say-so: a wrong "safe" is the one mistake this cannot
 * afford, and "Auto" was described to the user as rules.
 */
export const RISK_BAR = 0.5
export async function assessCommand ({ command, cwd, userText, decideFn, apiKey, sessionId, signal }) {
  const none = { risk: null, reasons: [], decided: false }
  if (!command || !decideFn || !apiKey) return none
  const questions = {
    destroys: { type: 'noul', instructions: 'Could this command delete, overwrite or discard data that is not easily recovered — files, uncommitted work, a database, a branch, history? Build output, caches and temp files do not count.', criteria: { true: 'It removes, resets, truncates, force-pushes, drops or overwrites something with no easy undo.', false: 'It only reads, builds, tests, lists, or writes to output and temp locations.' } },
    exfiltrates: { type: 'noul', instructions: 'Could this command send local files, keys, tokens, environment variables or other private data to a network destination?', criteria: { true: 'It uploads, posts or pipes local content or secrets to a remote host.', false: 'It stays local, or only downloads, or talks to localhost.' } },
    system: { type: 'noul', instructions: 'Does this command change the machine beyond the project — system settings, global installs, permissions, services, other users, sudo?', criteria: { true: 'It needs elevated rights or changes something outside the project that persists.', false: 'It acts inside the project or the user’s own tooling.' } },
    outside: { type: 'noul', instructions: `Does this command act on paths outside the working folder (${cwd || 'unknown'}) in a way that changes them?`, criteria: { true: 'It writes, moves or deletes outside the working folder.', false: 'It reads outside at most, or stays inside.' } }
  }
  const out = await decideFn({ apiKey, sessionId, signal, state: { command: String(command).slice(0, 2000), working_folder: cwd || '', user_latest_message: String(userText || '').slice(0, 800) }, questions })
  if (!out) return none
  const ps = Object.entries(questions).map(([k]) => [k, out.answers?.[k]?.noul]).filter(([, p]) => typeof p === 'number')
  if (!ps.length) return none
  const labels = { destroys: 'could destroy data', exfiltrates: 'could send private data out', system: 'changes the system', outside: 'changes files outside the project' }
  const reasons = ps.filter(([, p]) => p >= RISK_BAR).sort((a, b) => b[1] - a[1]).map(([k, p]) => `${labels[k]} (${Math.round(p * 100)}%)`)
  return { risk: Math.max(...ps.map(([, p]) => p)), reasons, decided: true, usage: out.usage }
}
