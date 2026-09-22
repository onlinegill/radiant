// The server's port-fallback list and the extension's probe list must be identical.
//
// ⚠️ When 5834 is busy the server falls back to another port; the Chrome
// extension can only FIND Radiant on a fixed list of ports. If the two lists
// drift, the app binds a port the extension never checks and shows "Not
// connected" forever while the agent quietly uses its own browser — exactly the
// bug Tony hit when a second Radiant held 5834.
import fs from 'node:fs'
let pass = 0, fail = 0
const ok = (c, what) => { if (c) pass++; else { fail++; console.log('  FAIL', what) } }

const parseList = (file, name) => {
  const src = fs.readFileSync(file, 'utf8')
  const m = src.match(new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]'))
  if (!m) return null
  return m[1].split(',').map(x => Number(x.trim())).filter(Number.isFinite)
}

const server = parseList('server/index.js', 'EXT_PORTS')
const ext = parseList('extension/sw.js', 'DEFAULT_PORTS')

ok(server && server.length >= 2, `server EXT_PORTS parsed (${JSON.stringify(server)})`)
ok(ext && ext.length >= 2, `extension DEFAULT_PORTS parsed (${JSON.stringify(ext)})`)
ok(server && ext && JSON.stringify(server) === JSON.stringify(ext),
   `the two lists are identical — server ${JSON.stringify(server)} vs extension ${JSON.stringify(ext)}`)
ok(server && server[0] === 5834, 'the primary port is 5834')

console.log(`\n${pass}/${pass + fail} passed  ·  the server falls back only to ports the extension actually looks on`)
process.exit(fail ? 1 : 0)
