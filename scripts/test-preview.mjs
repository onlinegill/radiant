#!/usr/bin/env node
/** The Preview tab's picker and the read-only file endpoint. */
import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
let pass = 0, fail = 0
const ok = (n, c, extra = '') => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${extra ? ' — ' + extra : ''}`)) }

// the picker is plain logic inside a .jsx file; lift it out by text so this runs under node
import { readFileSync } from 'node:fs'
const src = readFileSync('src/components/Preview.jsx', 'utf8')
const body = src.slice(src.indexOf('const FILE_RX'), src.indexOf('export default function Preview'))
const { previewCandidates } = await import('data:text/javascript,' + encodeURIComponent(body.replace('export function previewCandidates', 'export function previewCandidates')))
const msgs = [
  { role: 'assistant', parts: [{ type: 'tool', name: 'write_file', args: { path: '/p/notes.md' }, result: 'ok' }] },
  { role: 'assistant', parts: [{ type: 'tool', name: 'run_command', args: { command: 'npm run dev' }, result: '  ➜  Local:   http://localhost:5173/\n' }] },
  { role: 'assistant', parts: [{ type: 'tool', name: 'write_file', args: { path: '/p/index.html' }, result: 'Error: EACCES' }, { type: 'tool', name: 'write_file', args: { path: '/p/site/index.html' }, result: 'wrote' }, { type: 'tool', name: 'write_file', args: { path: '/p/a.js' }, result: 'wrote' }] }
]
const c = previewCandidates(msgs)
ok('newest first', c[0].value === '/p/site/index.html')
ok('a dev server URL is picked up from command output', c.some(x => x.kind === 'url' && x.value === 'http://localhost:5173/'))
ok('a failed write is not offered', !c.some(x => x.value === '/p/index.html'))
ok('a .js file is not previewable', !c.some(x => x.value === '/p/a.js'))
ok('markdown is', c.some(x => x.value === '/p/notes.md'))

// the endpoint, on a real server
const dir = mkdtempSync(join(tmpdir(), 'rx-prev-'))
writeFileSync(join(dir, 'page.html'), '<h1>hi</h1>')
writeFileSync(join(dir, '.secret'), 'no')
const port = 5900 + Math.floor(Math.random() * 90)
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(port) }, stdio: 'ignore' })
await new Promise(r => setTimeout(r, 3500))
const get = (p, m = 'GET') => new Promise(res => http.request({ host: '127.0.0.1', port, path: p, method: m }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers })) }).end())
let r = await get('/api/preview?path=' + encodeURIComponent(join(dir, 'page.html')))
ok('a file in the temp folder is served with its type', r.status === 200 && /text\/html/.test(r.headers['content-type']) && r.body.includes('<h1>hi</h1>'))
r = await get('/api/preview?path=' + encodeURIComponent(join(dir, 'page.html')), 'HEAD')
ok('HEAD carries an etag for change detection', r.status === 200 && /"\d+-\d+"/.test(r.headers.etag || ''))
r = await get('/api/preview?path=' + encodeURIComponent(join(dir, '.secret')))
ok('dotfiles are refused', r.status === 403)
r = await get('/api/preview?path=' + encodeURIComponent('/etc/hosts'))
ok('outside home and temp is refused', r.status === 403)
r = await get('/api/preview?path=' + encodeURIComponent(join(dir, 'nope.html')))
ok('a missing file is a 404, not a crash', r.status === 404)
r = await get('/api/preview?path=' + encodeURIComponent(dir))
ok('a folder is refused', r.status === 400)
server.kill()
console.log(`${pass}/${pass + fail} passed  ·  a window on the result, read-only`)
process.exit(fail ? 1 : 0)
