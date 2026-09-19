// What you typed and did not send must still be there when you come back.
//
// ⚠️ PAUL LOST HIS SENTENCE. Testing 1.0 on 2026-09-17 he typed into a chat
// that had no model; nothing happened when he sent it, and the text was gone
// once he went to get a model. Tony, relaying it: "the text should stay in the
// window while a model is being picked/downloaded." A chat with no model is
// precisely the chat you have to LEAVE, so the draft has to outlive the screen.
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }

const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
}
globalThis.window = { dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {} }

const { loadDraft, saveDraft, clearDraft, adoptDraft } = await import('../src/mobile/drafts.js')
const reset = () => store.clear()

// ── it survives the screen ─────────────────────────────────────────────────
reset()
ok(loadDraft('c1') === '', 'a conversation with nothing typed has no draft')
saveDraft('c1', 'write me a haiku about rain')
ok(loadDraft('c1') === 'write me a haiku about rain', 'what you typed is still there')

// ── one box per conversation ───────────────────────────────────────────────
saveDraft('c2', 'something else entirely')
ok(loadDraft('c1') === 'write me a haiku about rain', 'and it does not leak between chats')
ok(loadDraft('c2') === 'something else entirely', 'each conversation keeps its own')

// ── sending clears it ──────────────────────────────────────────────────────
saveDraft('c1', '')
ok(loadDraft('c1') === '', 'an empty draft is forgotten, not stored as ""')
saveDraft('c2', 'back again'); clearDraft('c2')
ok(loadDraft('c2') === '', 'and clearDraft does the same')

// ── ⚠️ THE NEW-CHAT PATH, WHICH IS THE ONE PAUL WALKED ─────────────────────
// "New chat" mints a fresh id every time, and a conversation with no messages
// is never written to chats.js — so typing, leaving to fetch a model, and
// tapping New chat again would look at an id that has never seen the text.
reset()
saveDraft('fresh-1', 'the sentence I typed before leaving')
ok(adoptDraft('fresh-2', ['c1', 'c2']) === 'the sentence I typed before leaving',
   'a new chat picks up the draft abandoned by an empty one')
ok(loadDraft('fresh-2') === 'the sentence I typed before leaving', 'and it now belongs to that chat')
ok(loadDraft('fresh-1') === '', 'the abandoned id is not left behind to be adopted twice')

// ⚠️ AND IT MUST NOT STEAL. A draft in a conversation that exists belongs to
// that conversation; a new chat that hoovered it up would look like the old
// bug from the other end.
reset()
saveDraft('c1', 'half a message to Ian')
ok(adoptDraft('fresh-9', ['c1']) === '', 'a real conversation keeps its own draft')
ok(loadDraft('c1') === 'half a message to Ian', 'which is still exactly where it was')

// its own draft always wins over anything adoptable
reset()
saveDraft('c1', 'mine'); saveDraft('gone', 'someone else’s')
ok(adoptDraft('c1', []) === 'mine', 'a chat that has a draft of its own is given that one')

// ── nothing it is handed can throw ─────────────────────────────────────────
reset()
ok(loadDraft(null) === '' && loadDraft(undefined) === '', 'no id, no draft, no crash')
saveDraft(null, 'x')
ok(adoptDraft(null, []) === '', 'and adopting nothing is not an error')
store.set('radiant.phone.drafts', 'not json at all')
ok(loadDraft('c1') === '', 'a corrupt store reads as empty rather than throwing')
store.set('radiant.phone.drafts', '["an array, not a map"]')
ok(loadDraft('c1') === '', 'and so does one of the wrong shape')

// ── it cannot grow forever ─────────────────────────────────────────────────
reset()
for (let i = 0; i < 80; i++) saveDraft('chat-' + i, 'draft ' + i)
const kept = Object.keys(JSON.parse(store.get('radiant.phone.drafts'))).length
ok(kept <= 40, `the store is capped (kept ${kept})`)
ok(loadDraft('chat-79') === 'draft 79', 'and the cap keeps the ones you touched last')

// ── the wiring, so the module is not merely correct and unused ─────────────
const chat = readFileSync('src/mobile/MobileChat.jsx', 'utf8')
ok(/useState\(initialDraft\)/.test(chat), 'the composer starts from the saved draft')
ok(/draftOut\.current\?\.\(draftRef\.current\)/.test(chat), 'and writes it back')
ok(/useEffect\(\(\) => \(\) => draftOut\.current\?\.\(draftRef\.current\), \[\]\)/.test(chat),
   'including on the way out, where a pending debounce would otherwise be lost')

// ⚠️ THE GUARD THAT SAID NOTHING. `if (!body || run.current || !model) return`
// is what made the send button inert in a chat with no model.
ok(!/if \(!body \|\| run\.current \|\| !model\) return/.test(chat),
   'sending with no model is no longer a silent return')
ok(/if \(!model\) \{[\s\S]{0,400}onGetModel\?\.\(\)/.test(chat),
   'it offers the way to get one instead')

const screen = readFileSync('src/mobile/ChatScreen.jsx', 'utf8')
ok(/adoptDraft\(id,/.test(screen), 'the chat route restores the draft for its conversation')
ok(/onDraftChange=\{onDraftChange\}/.test(screen) && /saveDraft\(id, text\)/.test(screen),
   'and persists it against that conversation')


// ── thinking is folded out of what the phone shows ─────────────────────────
{
  const { visibleText } = await import('../src/mobile/thinking.js')
  {
    const t = (raw) => visibleText(raw)
    ok('a whole think block disappears', t('<think>hmm</think>\nHi there').text === 'Hi there')
    ok('an open block hides everything after it and says thinking', t('<think>the user wants').text === '' && t('<think>the user wants').thinking)
    ok('a partial closing tag is still hidden', t('<think>x</thi').text === '')
    ok('a partial opening tag at the end is held back', t('Sure<thi').text === 'Sure' && !t('Sure<thi').thinking)
    ok('text with no block is untouched', t('plain answer').text === 'plain answer')
    ok('text after the block keeps its own paragraphs', t('<think>a</think>\n\nOne\n\nTwo').text === 'One\n\nTwo')
  }
}

console.log(`\n${pass}/${pass + fail} passed  ·  an unsent sentence outlives the screen it was typed in`)
process.exit(fail ? 1 : 0)
