/**
 * Skill categories — one table for the server and the UI.
 *
 * ⚠️ FORTY-FIVE SKILLS IN ONE FLAT LIST. Tony: "my skills list is already
 * starting to grow. we should have a category selector in the skills settings
 * and in the chat skills selector a toggle like in the model selector." A
 * skill file carries no category, so one is GUESSED from its name and
 * description the first time it is read, and the person can correct it in
 * Settings — the correction is saved on the skill and wins forever after.
 * The guess is a heuristic and says so by being editable; "Other" is the
 * honest answer when nothing matches, never a wrong confident one.
 */
export const SKILL_CATEGORIES = ['Coding', 'Apple', 'Design', 'Writing', 'Research', 'Quality', 'Ops', 'Business', 'Other']

// Order matters: the first rule whose pattern matches wins. Strong, specific
// words come first (a commit-message skill is Coding even though it "writes";
// a smoke test is Quality even on macOS), the broad nets last.
const RULES = [
  ['Quality', /\b(star system|rating loop|gauntlet|dogfood|smoke|lint|security|exploratory qa|qa\b)\b/i],
  ['Ops', /\b(deploy(ment)?|release|ci\/cd|docker|kubernetes|k8s|infra|devops|issue-to-pr|production loop)\b/i],
  ['Business', /\b(marketing|sales|seo|aeo|invoice|finance|legal|investor|pricing|revenue|crm)\b/i],
  ['Coding', /\b(commit|diffs?|refactor|methodolog|yagni|stdlib|architecture|api client|http client|hidden api|coding guidelines|senior-dev|game or app|spec, tickets)\b/i],
  ['Apple', /\b(swift|swiftui|swiftdata|core data|xcode|ios|macos|watchos|visionos|app store|expo)\b/i],
  ['Design', /\b(design|ui|ux|brand|palette|colou?r|typograph|layout|motion|animation|frontend|taste|slop|glassmorphism|scroll|interfaces?|shadcn|tokens|polish)\b/i],
  ['Quality', /\b(audit|review|verif|test(ing|s)?|tdd|test first)\b/i],
  ['Writing', /\b(writ(e|ing|er)|article|blog|copywriting|newsletter|email|documentation|translat|english)\b/i],
  ['Research', /\b(research|search|analy|benchmark|last ?30 ?days|discover|investigat|competit)\b/i],
  ['Coding', /\b(code|coding|api|git|typescript|python|react|node|repo|engineer|dev|plan|build)\b/i]
]

export function guessCategory (skill) {
  const hay = `${skill?.name || ''} ${skill?.description || ''} ${String(skill?.content || '').slice(0, 300)}`
  for (const [cat, re] of RULES) if (re.test(hay)) return cat
  return 'Other'
}

/** The category to show: the saved one if valid, else the guess. */
export function categoryOf (skill) {
  return SKILL_CATEGORIES.includes(skill?.category) ? skill.category : guessCategory(skill)
}
