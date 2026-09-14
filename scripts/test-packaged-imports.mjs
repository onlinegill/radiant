// Every import the server makes must resolve inside what the packaged app ships.
//
// ⚠️ THE DEV SERVER HAS THE WHOLE REPO; THE APP HAS dist/, server/, electron/.
// server/voice.js imported ../src/voice-text.js, every gate passed, the release
// was signed and notarized, and Radiant 0.9.0 opened with no window: the
// server threw "Cannot find module" before it listened and the window waits
// for the server. This walks the import graph from server/index.js and
// electron/main.cjs and refuses any relative import that leaves the shipped
// file set.
import fs from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const shipped = (pkg.build?.files || []).map(g => g.replace(/\/\*\*$/, '')).filter(g => !g.includes('.'))
ok(shipped.includes('server') && shipped.includes('dist') && shipped.includes('electron'), `build.files ships ${shipped.join(', ')}`)
const inShipped = f => shipped.some(dir => path.relative(dir, f).split(path.sep)[0] !== '..')

const seen = new Set()
const bad = []
function walk (file) {
  if (seen.has(file) || !fs.existsSync(file)) return
  seen.add(file)
  const src = fs.readFileSync(file, 'utf8')
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
  let m
  while ((m = re.exec(src))) {
    const target = path.normalize(path.join(path.dirname(file), m[1]))
    if (!inShipped(target)) bad.push(`${file} → ${m[1]}`)
    else walk(target)
  }
}
walk('server/index.js'); walk('electron/main.cjs'); walk('electron/preload.cjs')
ok(seen.size > 20, `walked ${seen.size} files from the server and shell entry points`)
ok(bad.length === 0, `no server/electron import leaves the shipped set:\n    ${bad.join('\n    ')}`)

console.log(`\n${pass}/${pass + fail} passed  ·  what the server imports is what the app ships`)
process.exit(fail ? 1 : 0)
