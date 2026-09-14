/**
 * The text that crosses between a spoken conversation and a Radiant turn.
 *
 * Pure functions, no DOM. Lives in server/ because BOTH sides import it and
 * only server/ ships in the packaged app (package.json build.files) — the
 * first cut put it in src/, the packaged server threw "Cannot find module"
 * at startup, and Radiant opened with no window at all.
 * voice.js (the WebRTC session) and App.jsx (the turn) both import from here.
 *
 * Two directions:
 *   - what the person SAID → the message a turn is run on (utteranceFrom)
 *   - what the agent WROTE → what GPT-Live is handed to say (spokenFrom)
 *
 * ⚠️ THE DELEGATION EVENT CARRIES NO WORDS. GPT-Live's session.delegation.created
 * is metadata — an id and a target — and the doc is explicit that the user's
 * request has to be assembled from the transcript deltas the app has been
 * collecting. So the transcript is kept here as timed fragments, and the
 * utterance for a delegation is everything the person said since the previous
 * one was cut.
 */

/** Join input-transcript fragments newer than `sinceMs` into one request. */
export function utteranceFrom (fragments, sinceMs = -1) {
  const text = fragments
    .filter(f => f && typeof f.text === 'string' && (f.endMs ?? f.startMs ?? 0) > sinceMs)
    .map(f => f.text)
    .join('')
  return text.replace(/\s+/g, ' ').trim()
}

// ⚠️ 500 TOKENS PER APPEND, and the model paraphrases rather than reads. So the
// answer is handed over as plain prose, short, with the code and the tables left
// in the chat where they can be read. 1,400 characters is comfortably under the
// cap for English and leaves the model room to paraphrase.
const SPOKEN_MAX = 1400

/** Plain, speakable text from an assistant message's parts. */
export function spokenFrom (parts, max = SPOKEN_MAX) {
  const text = (parts || [])
    .filter(p => p && p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n')
  const plain = deMarkdown(text)
  if (!plain) return ''
  if (plain.length <= max) return plain
  // cut at the last sentence end before the cap, or the last space
  const head = plain.slice(0, max)
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  const kept = cut > max * 0.5 ? head.slice(0, cut + 1) : head.slice(0, head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : max)
  return kept.trim() + ' The rest of the answer is in the chat.'
}

/** Markdown → prose. Code is named, not read; structure becomes sentences. */
export function deMarkdown (md) {
  let s = String(md || '')
  s = s.replace(/```[\s\S]*?```/g, ' (there is a code block in the chat) ')
  s = s.replace(/`([^`]+)`/g, '$1')
  s = s.replace(/^#{1,6}\s+/gm, '')
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/__([^_]+)__/g, '$1')
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' (an image) ')
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  // a table becomes "row: a, b, c."
  s = s.replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
  s = s.replace(/^\s*\|(.+)\|\s*$/gm, (_, row) => row.split('|').map(c => c.trim()).filter(Boolean).join(', ') + '.')
  s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
  s = s.replace(/^\s*>\s?/gm, '')
  s = s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim()
  return s
}

/** A quiet progress line for a tool the turn just started. */
export function progressLine (name, args = {}) {
  const file = args.path || args.file || args.filename
  switch (name) {
    case 'read_file': return file ? `Reading ${basename(file)}.` : 'Reading a file.'
    case 'write_file': return file ? `Writing ${basename(file)}.` : 'Writing a file.'
    case 'edit_file': return file ? `Editing ${basename(file)}.` : 'Editing a file.'
    case 'run_command': return args.command ? `Running: ${String(args.command).slice(0, 80)}.` : 'Running a command.'
    case 'list_dir': case 'glob': case 'grep': case 'search_files': return 'Looking through the workspace.'
    case 'fetch_url': return 'Fetching a web page.'
    case 'todo_write': return 'Updating the task list.'
    default:
      if (name.startsWith('browser_')) return 'Working in the browser.'
      if (name.startsWith('mcp__')) return `Using ${name.split('__')[1] || 'a tool'}.`
      return `Using ${name.replace(/_/g, ' ')}.`
  }
}

function basename (p) { return String(p).split('/').filter(Boolean).pop() || String(p) }

/**
 * What GPT-Live is told at session start. Short: the doc says conversation
 * style and when to delegate go here, and everything about the task stays with
 * the backend — which is Radiant's own system prompt.
 */
export function liveInstructions ({ title, model, host } = {}) {
  return [
    'You are the voice of Radiant, a coding and research assistant that runs on the user\'s own computer.',
    'You handle the conversation: listen, speak briefly and naturally, ask a short question when a request is unclear.',
    'Delegate to the backend anything that needs the workspace, files, code, commands, the web, memory of earlier chats, or real knowledge — which is almost everything. Do not answer those yourself or guess.',
    'While the backend works, keep replies short. When a result arrives, paraphrase it in one to three sentences; say that details are in the chat when there are any.',
    'Never claim an action happened unless a result said so.',
    title ? `The chat is called "${title}".` : '',
    model ? `The backend model is ${model}.` : '',
    host ? `The computer is ${host}.` : ''
  ].filter(Boolean).join(' ')
}

/** Seed text for the Live session: the last few turns, plain and short. */
export function seedFrom (messages, max = 6) {
  const recent = (messages || []).filter(m => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'voice')).slice(-max)
  return recent.map(m => {
    if (m.role === 'voice') return transcriptText(m.rows, m.seconds).slice(0, 600)
    const body = m.role === 'user' ? (m.text || '') : spokenFrom(m.parts, 400)
    return body ? `${m.role === 'user' ? 'User' : 'Assistant'}: ${body}` : ''
  }).filter(Boolean).join('\n')
}

// ⚠️ ONE LINE THAT VANISHED. The first cut showed only the latest caption,
// ellipsized on a single line, and threw it away when the call ended. Tony:
// "the text of our voice conversation all comes in on a single line and then
// disappears when i end the voice chat." Captions are ROWS now — one per
// stretch of one speaker — and the rows are saved into the chat when the call
// ends, as a message of role "voice".
const ROW_GAP_MS = 1500

/** Add a fragment to the caption rows, starting a new row on a speaker change or a pause. */
export function addFragment (rows, who, f) {
  const last = rows[rows.length - 1]
  const startMs = f.startMs ?? 0
  if (last && last.who === who && startMs - (last.endMs ?? startMs) <= ROW_GAP_MS) {
    last.text += f.text
    last.endMs = Math.max(last.endMs ?? 0, f.endMs ?? startMs)
  } else {
    rows.push({ id: rows.length + 1, who, text: f.text, startMs, endMs: f.endMs ?? startMs })
  }
  return rows
}

/** The saved transcript as prose a model can read. */
export function transcriptText (rows, seconds) {
  const mins = seconds ? `${Math.max(1, Math.round(seconds / 60))} min` : ''
  const lines = (rows || []).map(r => `${r.who === 'you' ? 'You' : 'Radiant'}: ${String(r.text || '').trim()}`).filter(l => !/:\s*$/.test(l))
  return `[Voice conversation${mins ? `, ${mins}` : ''} — what was said aloud:]\n${lines.join('\n')}`
}

/** Messages with a "voice" role become user text for the model. */
export function voiceAsText (messages) {
  return (messages || []).map(m => (m && m.role === 'voice')
    ? { role: 'user', text: transcriptText(m.rows, m.seconds) }
    : m)
}
