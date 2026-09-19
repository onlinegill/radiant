// ⚠️ A MODEL'S THINKING IS NOT ITS ANSWER. Reasoning models (Qwen 3 with
// thinking on, DeepSeek R1) write a <think>…</think> block first. Shown raw
// it is paragraphs of "the user wants… let me consider…" before one line of
// reply. Build 25 showed it and Tony said "not good". The stream is folded
// as it arrives: an open <think> hides everything until its close, and the
// byline says "thinking" meanwhile. A tag split across two chunks is the
// case that bites — hence the trailing-partial-tag hold-back.
export function visibleText (raw) {
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
