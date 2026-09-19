#!/usr/bin/env node
/**
 * A browser driven by Jev: read the page as a numbered element list, ask Jev
 * for the next move (~300 ms), do it, read again — the jev-ultrafast loop.
 * No screenshot, no chat model, no paragraph of reasoning per step.
 *
 *   node scripts/jev-browse.mjs --url https://example.com --goal "…" \
 *        [--done-check "what the page shows when done"] [--values k=v,k=v] \
 *        [--max-steps 25] [--headed] [--shot /tmp/end.png]
 *
 * Uses Playwright's Chrome (the one scripts/shots.mjs uses). Each step prints
 * what it did; the run ends with done, stuck, or the step cap. Text typed
 * into fields comes ONLY from --values — Jev chooses the field, never the
 * words. It never enters a password, a card number, or anything it was not
 * given; a page that asks for those is 'stuck' for a person to take over.
 *
 * ⚠️ Confidence matters more than the pick. Below 0.35 confidence on a click
 * the loop scrolls once and asks again rather than clicking a guess, and
 * two low-confidence rounds in a row end the run as 'stuck'.
 */
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const url = opt('url'), goal = opt('goal')
if (!url || !goal) { console.error('usage: jev-browse --url <url> --goal "…"'); process.exit(2) }
const maxSteps = Number(opt('max-steps', 25))
const values = opt('values', '')
const doneCheck = opt('done-check', '')

const browser = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed') })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(url, { waitUntil: 'domcontentloaded' })

// the page as candidates: visible interactive elements plus headings, numbered
async function elements () {
  return page.evaluate(() => {
    const out = []
    const seen = new Set()
    const sel = 'a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch], [contenteditable=true], h1, h2, h3, summary, label'
    let n = 0
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight * 1.5) continue
      const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') continue
      const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName === 'INPUT' ? (el.type || 'text') + ' field' : el.tagName === 'TEXTAREA' ? 'text field' : el.tagName === 'SELECT' ? 'select' : /^H[1-3]$/.test(el.tagName) ? 'heading' : el.tagName.toLowerCase())
      const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || el.value || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 100)
      if (!name && !/field/.test(role)) continue
      const key = role + '|' + name; if (seen.has(key) && !/field/.test(role)) continue; seen.add(key)
      const id = 'e' + (++n)
      el.setAttribute('data-jev', id)
      out.push({ id, role, name, value: el.value ? String(el.value).slice(0, 40) : undefined })
      if (out.length >= 150) break
    }
    return out
  })
}

const history = []
let lowRuns = 0
for (let step = 1; step <= maxSteps; step++) {
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await page.waitForTimeout(400)
  let cands
  try { cands = await elements() } catch { await page.waitForTimeout(800); cands = await elements().catch(() => []) }
  const pick = spawnSync(process.execPath, ['scripts/jev-pick.mjs', '--goal', goal, '--page', `${await page.title()} — ${page.url()}`, '--history', history.slice(-8).join(' → ') || '', ...(doneCheck ? ['--done-check', doneCheck] : []), ...(values ? ['--values', values] : [])], { input: JSON.stringify(cands), encoding: 'utf8' })
  let r; try { r = JSON.parse(pick.stdout.trim().split('\n').pop()) } catch { console.log('step', step, 'picker failed:', pick.stderr || pick.stdout); break }
  const conf = r.confidence ?? 0
  if (r.action === 'done' && conf >= 0.6) { console.log(`step ${step}: done (${Math.round(conf * 100)}%) — ${page.url()}`); break }
  if (r.action === 'done') { console.log(`step ${step}: maybe done (${Math.round(conf * 100)}%), looking again`); history.push('checked'); if (++lowRuns >= 2) { console.log('  stopping: cannot confirm'); break } continue }
  if (r.action === 'stuck' || conf < 0.35) {
    if (++lowRuns >= 2) { console.log(`step ${step}: stuck — ${r.reason || 'low confidence twice'}; a person should take over at ${page.url()}`); break }
    console.log(`step ${step}: unsure (${Math.round(conf * 100)}%), scrolling`); await page.mouse.wheel(0, 600); history.push('scrolled'); continue
  }
  lowRuns = 0
  const el = page.locator(`[data-jev="${r.id}"]`).first()
  if (r.action === 'type') {
    if (!r.text) { console.log(`step ${step}: field "${r.label}" needs a value none was given for — stopping for a person`); break }
    await el.click({ timeout: 5000 }).catch(() => {}); await el.fill(r.text, { timeout: 5000 }).catch(async () => { await page.keyboard.type(r.text) })
    await page.keyboard.press('Enter').catch(() => {})
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(800)
    history.push(`typed ${r.value_name} into "${r.label}"`)
    console.log(`step ${step}: typed ${r.value_name} into ${r.label} (${Math.round(conf * 100)}%)`)
  } else {
    // a covered or off-screen target: scroll it in, then fall back to a DOM click
    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
    await el.click({ timeout: 4000 }).catch(() => el.dispatchEvent('click').catch(e => console.log('  click failed:', e.message.split('\n')[0])))
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(800)
    history.push(`clicked "${r.label}"`)
    console.log(`step ${step}: clicked ${r.label} (${Math.round(conf * 100)}%)`)
  }
}
if (opt('shot')) await page.screenshot({ path: opt('shot') })
console.log('final:', await page.title(), '—', page.url())
await browser.close()
