// Skills carry a category; the guess is editable and the correction wins.
import { guessCategory, categoryOf, SKILL_CATEGORIES } from '../server/skill-categories.js'
import fs from 'node:fs'
let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL', what) } }
const g = (name, description = '') => guessCategory({ name, description })
ok(g('paul-hudson-swiftui', 'SwiftUI guidance') === 'Apple', 'Swift is Apple')
ok(g('Conventional commits', 'Commit messages in Conventional Commits format.') === 'Coding', 'a commit skill is Coding, not Writing')
ok(g('dogfood', 'Exploratory QA of web apps') === 'Quality', 'QA is Quality')
ok(g('master-design', 'Design, build, audit, and polish interfaces') === 'Design', 'a design skill that also audits is Design')
ok(g('seo-aeo-command-center', 'Audit and design a multi-brand SEO platform') === 'Business', 'SEO beats audit and design')
ok(g('english-please', '') === 'Writing', 'plain English is Writing, even with no description')
ok(g('templeton-production-loop', 'Human-gated GitHub issue-to-PR delivery system') === 'Ops', 'issue-to-PR delivery is Ops')
ok(g('xyzzy', '') === 'Other', 'nothing matched → Other, never a confident wrong answer')
ok(categoryOf({ name: 'Brand palette', category: 'Business' }) === 'Business', 'a saved category wins over the guess')
ok(categoryOf({ name: 'Brand palette', category: 'Nonsense' }) === 'Design', 'an unknown saved value falls back to the guess')
ok(SKILL_CATEGORIES.includes('Other') && SKILL_CATEGORIES.length >= 8, 'the table has Other and a real spread')
const cfg = fs.readFileSync('server/config.js', 'utf8')
ok(/category: categoryOf\(sk\), categoryGuessed/.test(cfg), 'publicConfig stamps every skill with its category and whether it was guessed')
ok(/'enabled', 'category'\]/.test(fs.readFileSync('server/index.js', 'utf8')), 'PATCH /api/skills/:id accepts category')
const st = fs.readFileSync('src/components/Settings.jsx', 'utf8')
ok(/cat-chip/.test(st) && /cat-select/.test(st), 'Settings has the chips and the per-skill select')
const chat = fs.readFileSync('src/components/Chat.jsx', 'utf8')
ok(/SKILL_MENU_COLLAPSED/.test(chat) && /model-group-label/.test(chat), 'the chat menu folds by category and remembers it')
// ⚠️ THE HEADERS ARE ALPHABETICAL, not the order SKILL_CATEGORIES declares.
// Tony: "the skils list in the chat box should be alphabetical." The skills
// inside each group were already sorted; the group headers were not.
ok(/\(a === 'Other'\) - \(b === 'Other'\) \|\| a\.localeCompare\(b\)/.test(chat),
   'the chat menu sorts its category headers alphabetically, Other last')
const order = [...SKILL_CATEGORIES].sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b))
ok(order[0] === 'Apple' && order[order.length - 1] === 'Other',
   `that sort really is alphabetical with Other last: ${order.join(' ')}`)

console.log(`\n${pass}/${pass + fail} passed  ·  skills have categories; the guess is editable`)
process.exit(fail ? 1 : 0)
