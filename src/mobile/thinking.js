// ⚠️ A MODEL'S THINKING IS NOT ITS ANSWER. Reasoning models (Qwen 3 with
// thinking on, DeepSeek R1) write a <think>…</think> block first. Shown raw
// it is paragraphs of "the user wants… let me consider…" before one line of
// reply. Build 25 showed it and Tony said "not good". The stream is folded
// as it arrives: an open <think> hides everything until its close, and the
// byline says "thinking" meanwhile. A tag split across two chunks is the
// case that bites — hence the trailing-partial-tag hold-back.
//
// ⚠️ AND SOME TEMPLATES OPEN THE BLOCK FOR THE MODEL. DeepSeek R1's ends the
// prompt with "<think>\n", so the reply carries only the CLOSE: reasoning, then
// "</think>", then the answer — and all of it showed, stray tag included. So a
// close with no open before it hides everything ahead of it; and a model known
// to think that way (`opened`, from its row's `thinks`) is hidden from the
// first word, so the reasoning never flashes past. If such a reply ends with
// no close at all (`final`), it is shown whole — an answer must never vanish
// because a model skipped thinking this once.
export function visibleText (raw, { opened = false, final = false } = {}) {
  const close0 = raw.indexOf('</think>')
  const open0 = raw.indexOf('<think>')
  if (close0 !== -1 && (open0 === -1 || close0 < open0)) {
    raw = raw.slice(close0 + 8).replace(/^\n+/, '')
  } else if (opened && close0 === -1 && open0 === -1 && !final) {
    return { text: '', thinking: true }
  }
  let out = ''
  let i = 0
  let thinking = false
  while (i < raw.length) {
    if (!thinking) {
      const o = raw.indexOf('<think>', i)
      if (o === -1) {
        // hold back a possible partial "<think" at the very end
        const tail = raw.slice(i)
        const m = /<(?:t(?:h(?:i(?:n(?:k>?)?)?)?)?)?$/.exec(tail)
        out += m && m.index > 0 ? tail.slice(0, m.index) : (m ? '' : tail)
        break
      }
      out += raw.slice(i, o); i = o + 7; thinking = true
    } else {
      const c = raw.indexOf('</think>', i)
      if (c === -1) break
      i = c + 8; thinking = false
      // the answer usually starts on a fresh line after the block
      while (raw[i] === '\n') i++
    }
  }
  return { text: out, thinking }
}
