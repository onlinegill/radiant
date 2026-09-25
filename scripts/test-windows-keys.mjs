/**
 * Does the Windows helper press the keys it was asked for?
 *
 * ⚠️ THIS IS THE ONE PART OF THE HELPER THAT CAN BE WRONG IN SILENCE. Everything
 * else there moves a real mouse or fails loudly. A bad translation presses the
 * wrong keys, exits 0, and tells the model it worked — and the model believes
 * it, because there is nothing to believe otherwise.
 *
 * Three rules it has to keep:
 *   · cmd MEANS THE COPY MODIFIER. A model told it is driving a desktop emits
 *     "cmd+c"; mapping cmd to Win literally would open the widgets board.
 *     Ctrl is what the user's own hands would press for the same intent.
 *   · super/win/windows MEANS THE REAL WINDOWS KEY. SendKeys cannot emit it,
 *     so it used to map to the empty string — silently turning "win+l" into
 *     "l". It now goes through keybd_event, held across the SendKeys chord.
 *   · A MODIFIER WE DO NOT KNOW IS A REFUSAL, NOT A SHRUG. Dropping it and
 *     pressing the bare key turns "fn+left" into "Left" and reports success.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { sendKeysFor } = require('../windows/radiant-control.cjs')

let pass = 0, fail = 0
const results = []
const ok = (what, cond) => { cond ? pass++ : fail++; results.push(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`) }
const is = (what, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want)
  ok(`${what} → ${JSON.stringify(want)}${same ? '' : `, got ${JSON.stringify(got)}`}`, same)
}
const refuses = (what, spec) => {
  let threw = false
  try { sendKeysFor(spec) } catch { threw = true }
  ok(`${what} is refused rather than guessed`, threw)
}

// the intent-preserving translation
is('cmd+c', sendKeysFor('cmd+c'), { sendKeys: '^c', win: false })
is('command+a', sendKeysFor('command+a'), { sendKeys: '^a', win: false })
is('meta+v', sendKeysFor('meta+v'), { sendKeys: '^v', win: false })
is('ctrl+c stays itself', sendKeysFor('ctrl+c'), { sendKeys: '^c', win: false })
is('cmd+shift+z keeps both', sendKeysFor('cmd+shift+z'), { sendKeys: '^+z', win: false })
is('opt maps to alt', sendKeysFor('opt+tab'), { sendKeys: '%{TAB}', win: false })

// ⚠️ the Windows key is real now, not the empty string
is('super+l holds Win', sendKeysFor('super+l'), { sendKeys: 'l', win: true })
is('win+r holds Win', sendKeysFor('win+r'), { sendKeys: 'r', win: true })
is('windows+e holds Win', sendKeysFor('windows+e'), { sendKeys: 'e', win: true })
is('win+shift+s keeps shift too', sendKeysFor('win+shift+s'), { sendKeys: '+s', win: true })
is('win+ctrl+esc keeps ctrl too', sendKeysFor('win+ctrl+esc'), { sendKeys: '^{ESC}', win: true })
is('bare win opens Start', sendKeysFor('win'), { sendKeys: '', win: true })

// names the other helpers accept, in the spelling SendKeys wants
is('return', sendKeysFor('return'), { sendKeys: '{ENTER}', win: false })
is('enter is the same key', sendKeysFor('enter'), { sendKeys: '{ENTER}', win: false })
is('escape', sendKeysFor('escape'), { sendKeys: '{ESC}', win: false })
is('esc', sendKeysFor('esc'), { sendKeys: '{ESC}', win: false })
is('delete is backspace', sendKeysFor('delete'), { sendKeys: '{BACKSPACE}', win: false })
is('forwarddelete is not', sendKeysFor('forwarddelete'), { sendKeys: '{DELETE}', win: false })
is('pagedown', sendKeysFor('pagedown'), { sendKeys: '{PGDN}', win: false })
is('space', sendKeysFor('space'), { sendKeys: ' ', win: false })
is('f5 is uppercased', sendKeysFor('f5'), { sendKeys: '{F5}', win: false })
is('a plain letter is left alone', sendKeysFor('a'), { sendKeys: 'a', win: false })
is('SendKeys metacharacters are escaped', sendKeysFor('ctrl+['), { sendKeys: '^{[}', win: false })

// ⚠️ the cases that used to lie
refuses('an unknown modifier (fn)', 'fn+left')
refuses('a typo for a modifier', 'ctrlx+c')
refuses('a combo with no key at all', 'ctrl+')
refuses('a bare plus', '+')
refuses('an empty spec', '')

console.log(results.join('\n'))
console.log(`\n${pass}/${pass + fail} passed  ·  the Windows helper presses what it was asked for`)
process.exit(fail ? 1 : 0)
