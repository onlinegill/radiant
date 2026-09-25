// Scope lint: flags bare `config` references inside top-level functions that
// neither receive it as a param nor declare it locally. This is the bug class
// that crashed the Chrome/Memory/Devices tabs (ReferenceError: config is not
// defined) — invisible until the async state behind a gate resolved.
// Analysis runs on the esbuild-transformed output (plain JS — no JSX text
// apostrophes to confuse the scanner).
// Run: node scripts/lint-settings-scope.mjs
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const transformed = execFileSync('npx', ['esbuild', 'src/components/Settings.jsx',
  '--loader:.jsx=jsx', '--log-level=error'], { cwd: process.cwd(), encoding: 'utf-8' })
const src = transformed

// Strip strings, template literals, regex literals, and comments so
// braces/identifiers inside them don't confuse the analysis.
// Keeps line structure for reporting.
function strip (s) {
  let out = '', i = 0, lastSig = ''
  const push = c => { out += c === '\n' ? '\n' : ' '; }
  const emit = c => { out += c; if (c !== ' ' && c !== '\n') lastSig = c }
  while (i < s.length) {
    const c = s[i], n = s[i + 1]
    if (c === '\n') { out += '\n'; i++; continue }
    if (c === '/' && n === '/') { lastSig = '/'; while (i < s.length && s[i] !== '\n') push(s[i++]); continue }
    if (c === '/' && n === '*') { lastSig = '/'; push(c); push(n); i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) push(s[i++]); if (i < s.length) { push(s[i++]); push(s[i++]) } continue }
    // regex literal? a `/` starts one when the previous significant char
    // cannot end an expression (heuristic; division follows values)
    if (c === '/' && n !== '/' && n !== '*' && (/[=,(:!&|?{;[]/.test(lastSig) || (lastSig === '' && /[^/*]/.test(n)))) {
      push(c); i++
      let cls = false
      while (i < s.length) {
        const r = s[i]
        if (r === '\n') break
        push(r); i++
        if (r === '\\') { if (i < s.length) push(s[i++]); continue }
        if (r === '[') cls = true
        else if (r === ']') cls = false
        else if (r === '/' && !cls) break
      }
      while (i < s.length && /[gimsuy]/.test(s[i])) push(s[i++])
      lastSig = '/'
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; lastSig = q; push(c); i++
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') { push(s[i++]); if (i < s.length) push(s[i++]) } else push(s[i++])
      }
      if (i < s.length) push(s[i++])
      continue
    }
    emit(c); i++
  }
  return out
}

const code = strip(src)
const lines = code.split('\n')

// top-level function spans via brace matching
const spans = []
for (const m of code.matchAll(/^function (\w+)\s*\(/gm)) {
  const name = m[1]
  // match the parameter list parens to find the true body brace
  let pdepth = 0, pEnd = -1
  for (let j = m.index + m[0].length - 1; j < code.length; j++) {
    if (code[j] === '(') pdepth++
    else if (code[j] === ')') { pdepth--; if (pdepth === 0) { pEnd = j + 1; break } }
  }
  const bodyStart = code.indexOf('{', pEnd)
  let depth = 0, end = -1
  for (let j = bodyStart; j < code.length; j++) {
    if (code[j] === '{') depth++
    else if (code[j] === '}') { depth--; if (depth === 0) { end = j + 1; break } }
  }
  const header = code.slice(m.index, bodyStart)
  spans.push({ name, header, body: code.slice(bodyStart, end) })
}

let failures = 0
for (const { name, header, body } of spans) {
  const declaresConfig =
    /(?:^|[\s,({])config(?:\s*[,)}=]|$)/.test(header) || // param (incl. destructured)
    new RegExp('(?:const|let|var|function)\\s+config\\b').test(body)
  if (declaresConfig) continue
  // bare `config` tokens: not property access (.config), not `config:` keys
  const uses = [...body.matchAll(/(?<![\w$.])config(?![\w$:])/g)]
  if (uses.length) {
    failures++
    const lineNo = code.slice(0, code.indexOf('function ' + name)).split('\n').length
    console.log(`  FAIL ${name} (line ~${lineNo}): ${uses.length} bare 'config' reference(s) with no declaration`)
  }
}
console.log(failures ? `\n${failures} function(s) reference undeclared 'config'` : '\nno undeclared config references')
process.exit(failures ? 1 : 0)
