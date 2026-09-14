// A copy of Radiant that macOS has translocated cannot update itself, and the
// app has to say so instead of failing every six hours in silence.
//
// ⚠️ THE DEV MBP SAT ON 0.8.7 FOR WEEKS. Its server could see 0.9.9 on GitHub;
// the shell downloaded it and could not swap the bundle, and nothing on screen
// said why. This pins the detector and the sentences on the paths that occur.
import fs from 'node:fs'
let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }
const src = fs.readFileSync('electron/updater.cjs', 'utf8')
// extract installLocation() and run it against fake execPaths
const m = src.match(/function installLocation \(\) \{[\s\S]*?\n  \}/)
ok(m, 'installLocation exists in updater.cjs')
const fn = new Function('process', m[0] + '; return installLocation()')
const at = p => fn({ execPath: p })
const t = at('/private/var/folders/xx/T/AppTranslocation/1234-ABCD/d/Radiant.app/Contents/MacOS/Radiant')
ok(t.translocated && !t.updatable && !t.inApplications, 'a translocated path is recognised and not updatable')
ok(t.bundle.endsWith('Radiant.app'), `the bundle path is reported (${t.bundle})`)
const a = at('/Applications/Radiant.app/Contents/MacOS/Radiant')
ok(!a.translocated && a.updatable && a.inApplications, '/Applications is updatable')
const d = at('/Users/tony/Downloads/Radiant.app/Contents/MacOS/Radiant')
ok(!d.translocated && d.updatable && !d.inApplications, 'Downloads without translocation still updates (macOS only translocates quarantined copies)')
ok(/Drag Radiant into the Applications folder/.test(src), 'the check-update answer says what to do')
ok(/cannot update itself/.test(src), 'and the menu dialog says the copy cannot update itself')
ok(/rad:install-location/.test(fs.readFileSync('electron/preload.cjs', 'utf8')), 'the location is exposed to the window')
ok(/status\?\.blocked/.test(fs.readFileSync('src/components/Settings.jsx', 'utf8')), 'and About shows it')
console.log(`\n${pass}/${pass + fail} passed  ·  a copy that cannot update itself says so`)
process.exit(fail ? 1 : 0)
