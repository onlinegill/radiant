// The catalogue is generated, so what needs asserting is that the SHAPE the UI
// depends on survives: every model has a maker, ids are unique, and the
// recommended model still exists. A picker whose hero resolves to nothing is a
// blank screen, and that has shipped before.
import { readFileSync } from 'node:fs'
import { byMaker } from '../src/mobile/makers.js'
import { fitOf, FITS_NO } from '../src/mobile/fit.js'

const swift = readFileSync('apps/ios/ios/App/App/plugins/LocalModels.swift', 'utf8')
const rows = [...swift.matchAll(/Entry\(id: "([^"]+)", name: "([^"]+)", maker: "([^"]+)",\s*\n\s*blurb: "([^"]*)",\s*\n\s*gb: ([\d.]+)/g)]
  .map(m => ({ id: m[1], name: m[2], maker: m[3], blurb: m[4], sizeGB: parseFloat(m[5]) }))

let pass = 0, fail = 0
const is = (name, got, want) => {
  if (got === want) { pass++; return }
  fail++; console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

is('every entry parsed', rows.length >= 40, true)
is('every model has a maker', rows.every(r => r.maker), true)
is('every model has a blurb', rows.every(r => r.blurb.length > 10), true)
is('ids are unique', new Set(rows.map(r => r.id)).size, rows.length)
is('sizes are plausible', rows.every(r => r.sizeGB > 0.1 && r.sizeGB < 30), true)
// ⚠️ The picker's hero resolves to this id; losing it renders a blank hero.
is('the recommended model still exists', rows.some(r => r.id === 'qwen3-1.7b'), true)

const groups = byMaker(rows)
is('grouped into shelves', groups.length > 8, true)
is('no shelf is empty', groups.every(g => g.models.length > 0), true)
is('every model lands in exactly one shelf',
  groups.reduce((n, g) => n + g.models.length, 0), rows.length)
const collate = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const sorted = xs => xs.every((x, i) => i === 0 || collate.compare(xs[i - 1], x) <= 0)
is('makers are A to Z', sorted(groups.map(g => g.maker)), true)
is('models are A to Z inside each maker', groups.every(g => sorted(g.models.map(m => m.name))), true)
is('numbers sort as numbers, not text', byMaker([{ maker: 'Q', name: 'Qwen 3 8B' }, { maker: 'Q', name: 'Qwen 3 1.7B' }, { maker: 'Q', name: 'Qwen 3 14B' }])[0].models.map(m => m.name).join(', '), 'Qwen 3 1.7B, Qwen 3 8B, Qwen 3 14B')

// The list must span far enough that the verdict means something: on a phone
// budget, some run and some do not. A list where everything fits makes the
// label decoration.
const BUDGET = 6e9
const wontRun = rows.filter(r => fitOf(r.sizeGB, BUDGET) === FITS_NO).length
is('some models run on a big phone', wontRun < rows.length, true)
is('some models do not', wontRun > 0, true)

console.log(`${pass}/${pass + fail} passed  ·  ${rows.length} models, ${groups.length} makers, ${wontRun} beyond a 6 GB budget`)
process.exit(fail ? 1 : 0)
