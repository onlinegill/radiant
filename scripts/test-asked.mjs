// The user's answer to an agent's question is on screen afterwards.
//
// ⚠️ IT WAS NOT. An ask_user exchange is stored as a tool call — the question
// in its arguments, "The user answered: …" in its result — and the transcript
// folded it into a "4 tool calls" chip. Tony answered a question, the agent
// carried on as if he had, and his answer was nowhere on the page: "my reply
// did not appear but the agent answered it." This imports a chat with such an
// exchange and reads the rendered page, not the source.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'

const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const PORT = await freePort()
let pass = 0, fail = 0
const results = []
const ok = (n, c, extra = '') => { c ? pass++ : (fail++, results.push(`  FAIL ${n}${extra ? ' — ' + extra : ''}`)) }

const dataDir = mkdtempSync(join(tmpdir(), 'radiant-asked-'))
const server = spawn('node', ['server/index.js'], { env: { ...process.env, RADIANT_PORT: String(PORT), RADIANT_DIR: dataDir, NODE_ENV: 'production' }, stdio: 'ignore' })
process.on('exit', () => server.kill())
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break } catch {} ; await new Promise(r => setTimeout(r, 250)) }

// a chat in which the agent asked, the user answered, and the agent went on
const chat = {
  radiantChats: 1,
  chats: [{
    id: 'asked-1', title: 'Asked and answered', provider: 'openai', model: 'gpt-5.6-sol', cwd: dataDir, useTools: true, createdAt: new Date().toISOString(),
    messages: [
      { role: 'user', text: 'Set up the project.' },
      { role: 'assistant', parts: [
        { type: 'text', text: 'Before I scaffold anything, I need to know where this should live.' },
        { type: 'tool', id: 'c1', name: 'ask_user', args: { question: 'Where should I set it up?', options: ['TypeScript at ~/Projects/x', 'Python at ~/Projects/x'] }, result: 'The user answered: Python at ~/Projects/x' },
        { type: 'tool', id: 'c2', name: 'run_command', args: { command: 'mkdir -p ~/Projects/x' }, result: '' },
        { type: 'text', text: 'Good — Python it is.' }
      ] }
    ]
  }]
}
const imp = await fetch(base + '/api/chats/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(chat) })
ok('the chat imports', imp.ok, String(imp.status))
const sessions = await (await fetch(base + '/api/sessions')).json()
const sid = sessions.find(s => s.title === 'Asked and answered')?.id
ok('and is listed', Boolean(sid))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.addInitScript(() => { window.radiantNative = window.radiantNative || { toggleHud: () => {}, pickFolder: async () => null, openExternal: () => {} } })
await page.goto(base + '/#/session/' + sid, { waitUntil: 'networkidle' })
await page.waitForSelector('.sidebar', { timeout: 15000 })
// open it the way a person does: imported chats land in a collapsed
// "Imported <day>" project shelf, so open the shelf, then the row
const shelf = page.getByText(/^Imported /).first()
if (await shelf.count()) { await shelf.click({ force: true }).catch(() => {}); await page.waitForTimeout(600) }
const row = page.getByText('Asked and answered').first()
if (await row.count()) { await row.click({ force: true }).catch(() => {}); await page.waitForTimeout(1000) }
const text = await page.locator('body').innerText()
ok('the question is on the page', /Where should I set it up\?/.test(text))
ok('and the answer is on the page, as the user\'s', /You\s*Python at ~\/Projects\/x/i.test(text), text.slice(0, 400))
ok('it is NOT folded into the tool-call chips', !/2 tool calls/.test(text))
// the unrelated command still folds as before
ok('other tool calls still show as chips', await page.locator('.tool-chip, .tool-run').count() >= 1)
await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass}/${pass + fail} passed  ·  what you answered stays on the page`)
process.exit(fail ? 1 : 0)
