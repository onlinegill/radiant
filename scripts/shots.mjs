/**
 * Marketing screenshots of the real app, for the showcase page.
 *
 * ⚠️ AGAINST THE RUNNING APP, NOT A MOCK. It points at whatever Radiant is
 * serving on 5834, so the shots are the product as it actually is on this
 * machine — which is the only way they stay honest. The previous set was taken
 * on 2026-08-22 against 0.6.71 and was four weeks and forty releases stale.
 *
 * ⚠️ AND WITHOUT THE BALANCES. The old chat-wide.png published "$77.18
 * OPENROUTER · Claude 44% LEFT · ChatGPT 87% LEFT" on a public page. Anything
 * that reads as money, a key, or a private path is hidden before the shutter,
 * not cropped after.
 *
 * Size matches what the page already expects: 1600x1000 at 2x = 3200x2000.
 *
 *   node scripts/shots.mjs [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.RADIANT_URL || 'http://127.0.0.1:5834'
const OUT = process.argv[2] || '/tmp/radiant-shots'
mkdirSync(OUT, { recursive: true })

// ⚠️ THE BALANCES ARE THE ONE THING THAT MUST NOT SHIP. .usage-chip is the
// sidebar strip that reads "OpenRouter $11.19 left · ChatGPT 4% left". The
// previous chat-wide.png published exactly that on a public marketing page.
const HIDE = '.usage-chip { visibility: hidden !important; }'

// ⚠️ AND NOT THE ACCOUNT EMAIL EITHER. The Providers pane renders the signed-in
// address as a chip; on a public page that is a scrape target. Swapped for a
// placeholder that reads naturally in a marketing shot rather than blurred.
const scrubEmails = async page => page.evaluate(() => {
  // ⚠️ WALK TEXT NODES, NOT ELEMENTS. The address sits in a bare text node
  // inside a chip that also holds a status dot and a remove button, so
  // "elements with no children" never matched it and the email shipped anyway.
  const rx = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n, hits = 0
  while ((n = walker.nextNode())) {
    if (rx.test(n.nodeValue)) { rx.lastIndex = 0; n.nodeValue = n.nodeValue.replace(rx, 'you@example.com'); hits++ }
    rx.lastIndex = 0
  }
  return hits
})

// ⚠️ DARK, WITHOUT TOUCHING THE REAL APP'S SETTINGS. The theme is applied as
// inline custom properties on <html> from the user's config, which would beat
// any stylesheet — and flipping the app's own toggle would change the theme on
// every Mac sharing that config. So the inline properties are cleared and
// data-mode is set in THIS headless page only. The site is dark; a light shot
// would sit badly in it, and the set it replaces was dark.
const forceDark = async page => page.evaluate(() => {
  const root = document.documentElement
  for (const prop of [...root.style]) {
    if (prop.startsWith('--bg') || prop.startsWith('--text') || prop.startsWith('--border') || prop.startsWith('--accent') || prop === '--on-accent') {
      root.style.removeProperty(prop)
    }
  }
  root.setAttribute('data-mode', 'dark')
})

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
page.on('pageerror', e => console.log('  page error:', e.message))

const settle = async ms => page.waitForTimeout(ms)
const shot = async name => {
  await forceDark(page)
  const scrubbed = await scrubEmails(page)
  if (scrubbed) console.log('    scrubbed', scrubbed, 'email(s)')
  // ⚠️ VERIFY, DO NOT ASSUME. The first version of the scrub reported success
  // while the address was still on screen, because it walked elements rather
  // than text nodes. Refuse to write a shot that still shows one.
  const leaked = await page.evaluate(() => (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []).filter(e => !/example\.com/.test(e)))
  if (leaked.length) throw new Error('refusing to write ' + name + ' — still shows ' + leaked.join(', '))
  await page.addStyleTag({ content: HIDE })
  await settle(400)
  const file = path.join(OUT, name + '.png')
  await page.screenshot({ path: file })
  console.log('  wrote', file)
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await settle(2500)
  console.log('loaded:', await page.title())

  const click = async (text, note) => {
    const el = page.getByText(text, { exact: false }).first()
    try { await el.click({ timeout: 4000 }); await settle(1400); return true }
    catch { console.log('  could not click', note || text); return false }
  }

  // 1. a real conversation — the chat is the product.
  // ⚠️ Sessions live INSIDE collapsed project groups, so the group has to be
  // opened first; clicking the session name on the landing screen finds
  // nothing and silently re-shoots the empty state.
  await click('Templeton Group Dev', 'project group')
  await settle(900)
  const opened = await click('Read Aloud', 'session')
  if (!opened) { await click('No project', 'fallback group'); await settle(800) }
  await settle(2200)
  await shot('chat-wide')

  // 2. the agents library. ⚠️ Clicking the Agents TAB only changes the sidebar
  // and leaves the whole main pane on the empty welcome screen — dead space in
  // a marketing shot. The "Work with an agent" card opens the gallery, which
  // is the thing worth showing.
  await page.goto(BASE, { waitUntil: 'networkidle' }); await settle(1500)
  await click('Work with an agent', 'agent gallery')
  await settle(1800)
  await shot('agents-wide')

  // 3 + 4. settings panes
  for (const [tab, name] of [['Models', 'models-wide'], ['Providers', 'providers-wide']]) {
    await page.goto(BASE, { waitUntil: 'networkidle' }); await settle(1500)
    await click('Settings', 'settings')
    await settle(1200)
    await click(tab, 'settings tab ' + tab)
    await settle(1600)
    if (tab === 'Models') {
      // the installed-model list is further down and is what people recognise
      await page.evaluate(() => {
        const pane = document.querySelector('.set-body, .settings-body, .set-pane, [class*="set-"][class*="scroll"]')
        const el = pane || [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 200 && d.clientHeight > 400)
        if (el) el.scrollTop = el.scrollHeight * 0.42
      })
      await settle(900)
    }
    await shot(name)
  }
} catch (e) {
  console.log('FAILED:', e.message)
} finally {
  await browser.close()
}
