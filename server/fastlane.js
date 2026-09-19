/**
 * The fast lane: a bounded set of lookups answered by a tool, not a model.
 *
 * ⚠️ WHY. "what's uncommitted", "last few commits", "what model is this",
 * "what's TG-474 about" — each was a full model turn: 5–20 s while the model
 * thought, called one tool, and wrote a paragraph around its output. The
 * chat bot Tony watched (CJ, 2026-09-17) answers this class instantly because
 * Jev picks the tool and the tool's output IS the answer. Same here, for a
 * closed list of read-only lookups. Jev classifies the message in ~300 ms;
 * only a confident match (≥ 0.85) takes the lane, and everything else goes
 * to the model as before. Never mid-task, never with attachments, never a
 * long message — the lane is for questions, not work.
 *
 * ⚠️ THE LIST IS CLOSED AND READ-ONLY. Nothing here writes, pushes, deletes
 * or leaves the machine except one Linear read through the user's own MCP
 * server. Adding a lookup means adding it to LANES with its criterion, and
 * a case in scripts/test-fastlane.mjs.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { scrubbedEnv } from './ollama.js'

export const LANE_BAR = 0.85
export const LANES = {
  git_status: 'What is changed, uncommitted, staged or untracked right now (git status).',
  git_log: 'The recent commits — what was committed lately, the last few changes (git log).',
  git_diff: 'What the current uncommitted changes look like or which files they touch (git diff).',
  list_files: 'What is in the working folder or the project layout — the files and folders here.',
  where_am_i: 'Which model, provider or working folder this chat is using, or which chat this is.',
  issue: 'What a Linear issue is about, by its key such as TG-474 (needs a Linear server).',
  none: 'Anything else — a task, a question needing reasoning or explanation, or a follow-up about earlier work.'
}

export async function classifyLookup ({ message, attachments = [], history = [], hasLinear, decideFn, apiKey, sessionId, signal }) {
  const text = String(message || '').trim()
  if (!decideFn || !apiKey || !text || attachments.length || text.length > 200 || text.startsWith('/')) return { lane: 'none', p: null }
  // mid-task: the previous reply used tools → the model has the thread
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role === 'user' && i === history.length - 1) continue
    if (m.role === 'assistant') { if ((m.parts || []).some(p => p.type === 'tool')) return { lane: 'none', p: null, reason: 'mid-task' }; break }
  }
  const criteria = { ...LANES }
  if (!hasLinear) delete criteria.issue
  const out = await decideFn({ apiKey, sessionId, signal, state: { latest_message: text }, questions: { lane: { type: 'choice', instructions: 'Is this message exactly one of these quick lookups, answerable by running the tool named and showing its output — or anything else?', criteria } } })
  const a = out?.answers?.lane
  const probs = a?.probabilities || null
  if (!a?.choice || a.choice === 'none') return { lane: 'none', p: a?.probabilities?.[a?.choice] ?? null, choice: a?.choice, confidence: a?.confidence, probs }
  const p = a.probabilities?.[a.choice] ?? 0
  if ((a.confidence ?? 0) < LANE_BAR || p < LANE_BAR) return { lane: 'none', p, reason: 'not sure enough', choice: a.choice, confidence: a.confidence, probs }
  return { lane: a.choice, p, choice: a.choice, confidence: a.confidence, probs }
}

const run = (cmd, args, cwd, ms = 8000) => new Promise(resolve => execFile(cmd, args, { cwd, timeout: ms, maxBuffer: 1 << 20, env: scrubbedEnv() }, (err, stdout, stderr) => resolve(err ? `${stdout || ''}${stderr || err.message}`.trim() : String(stdout).trim())))
const fence = s => '```\n' + (s || '(nothing)').slice(0, 6000) + '\n```'

export async function runLookup (lane, { cwd, message, session, provider, callMcp, mcpTools = [] }) {
  const dir = cwd && fs.existsSync(cwd) ? cwd : process.cwd()
  switch (lane) {
    case 'git_status': return `**git status** in \`${dir}\`\n\n${fence(await run('git', ['status', '--short', '--branch'], dir))}`
    case 'git_log': return `**Last 10 commits** in \`${dir}\`\n\n${fence(await run('git', ['log', '--oneline', '--decorate', '-10'], dir))}`
    case 'git_diff': return `**Uncommitted changes** in \`${dir}\`\n\n${fence(await run('git', ['diff', '--stat'], dir))}`
    case 'list_files': {
      const names = fs.readdirSync(dir, { withFileTypes: true }).filter(d => !d.name.startsWith('.') && d.name !== 'node_modules').sort((a, b) => a.name.localeCompare(b.name)).map(d => d.isDirectory() ? d.name + '/' : d.name)
      return `**${dir}** — ${names.length} entries\n\n${fence(names.join('\n'))}`
    }
    case 'where_am_i': return `This chat is **${session.title || 'untitled'}**, on **${session.model}** via **${provider?.name || session.provider}**, working in \`${session.cwd || '(no folder)'}\`${session.agentId ? `, as agent ${session.agentId}` : ''}.`
    case 'issue': {
      const key = /\b([A-Z]{2,6}-\d+)\b/.exec(message)?.[1]
      const tool = mcpTools.find(t => /get_issue$/.test(t.name))
      if (!key || !tool || !callMcp) return null
      const r = await callMcp(tool.name, { id: key })
      const txt = typeof r === 'string' ? r : JSON.stringify(r, null, 2)
      return `**${key}** from Linear\n\n${fence(txt)}`
    }
    default: return null
  }
}

export const LANE_NOTE = 'Answered instantly from a tool, without a model. Ask in more words and the model will take it.'
