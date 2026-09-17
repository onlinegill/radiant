/**
 * Every plugin method must be registered in THREE places, and all three agree.
 *
 * ⚠️ THIS IS THE PROJECT'S QUIETEST FAILURE. A Swift @objc method that is
 * missing from `pluginMethods` compiles, links, and has a live ObjC selector —
 * and Capacitor still refuses the call at runtime. A method missing from
 * bridge.js is never reachable from the web layer at all. Both ship a button
 * that does nothing, with no build error and no console warning. It has
 * happened twice; today it nearly happened a third time with deviceInfo.
 */
import { readFileSync, readdirSync } from 'node:fs'

const bridge = readFileSync('src/mobile/bridge.js', 'utf8')
let pass = 0, fail = 0
const is = (name, got, want) => {
  if (got === want) { pass++; return }
  fail++; console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

const dir = 'apps/ios/ios/App/App/plugins'
for (const file of readdirSync(dir).filter(f => f.endsWith('.swift'))) {
  const src = readFileSync(`${dir}/${file}`, 'utf8')
  const jsName = src.match(/public let jsName = "(\w+)"/)?.[1]
  if (!jsName) continue // not a Capacitor plugin (DownloadMath, etc.)

  const registered = [...src.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map(m => m[1]).sort()
  const implemented = [...src.matchAll(/@objc func (\w+)\(_ call: CAPPluginCall\)/g)].map(m => m[1]).sort()

  // Implemented but not registered: Capacitor refuses the call at runtime.
  for (const m of implemented) {
    is(`${jsName}.${m} is in pluginMethods`, registered.includes(m), true)
  }
  // Registered but not implemented: the call resolves to nothing.
  for (const m of registered) {
    is(`${jsName}.${m} is implemented`, implemented.includes(m), true)
  }
  // And the web layer must know the method exists.
  const listed = bridge.match(new RegExp(`${jsName}:\\s*\\[([^\\]]*)\\]`))?.[1]
  is(`${jsName} is listed in bridge.js`, !!listed, true)
  if (listed) {
    const exposed = [...listed.matchAll(/'(\w+)'/g)].map(m => m[1])
    for (const m of implemented) {
      is(`${jsName}.${m} is exposed in bridge.js`, exposed.includes(m), true)
    }
  }
}

// ⚠️ A PLUGIN FILE ON DISK IS NOT A PLUGIN IN THE APP. AppRating.swift was
// written, compiled locally by `swift build`'s reckoning, installed, and was
// NOT in the binary — because it was never added to the Xcode project's
// Sources phase. Capacitor then refuses the call at runtime and the JS
// `.catch()` swallows it, so the feature is simply absent and silent. Every
// plugin file must appear in project.pbxproj as a file reference AND in the
// build phase; one without the other compiles nothing.
{
  const pbx = readFileSync('apps/ios/ios/App/App.xcodeproj/project.pbxproj', 'utf8')
  const files = readdirSync('apps/ios/ios/App/App/plugins').filter(f => f.endsWith('.swift'))
  for (const f of files) {
    is(`${f} is a file reference in the Xcode project`, /PBXFileReference/.test(pbx.split('\n').filter(l => l.includes(f)).join('\n')), true)
    is(`${f} is in the Sources build phase`, pbx.includes(`${f} in Sources */,`), true)
  }
}

console.log(`${pass}/${pass + fail} passed  ·  Swift, pluginMethods and bridge.js agree`)
process.exit(fail ? 1 : 0)
