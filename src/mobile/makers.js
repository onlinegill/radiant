/**
 * Grouping models by who made them.
 *
 * Plain .js, not inside MakerSection.jsx, so it can be imported by a test that
 * runs under bare node — the component cannot, and a rule the tests cannot
 * reach is a rule that drifts.
 */

/**
 * Group models by maker, makers A to Z and models A to Z inside each.
 *
 * ⚠️ ALPHABETICAL, BECAUSE NOBODY COULD TELL WHAT THE ORDER WAS. It used to be
 * biggest shelf first, with each shelf in the published list's order — a rule
 * you had to be told. Tony: "Also make the model list alphabetical. I'm not
 * sure what order they're in right now." Names compare as numbers where they
 * have numbers, so "Qwen 3 1.7B" sits before "Qwen 3 4B" and "Gemma 3 4B"
 * before "Gemma 3 12B".
 *
 * Derived from the rows rather than a hard-coded order, so adding a model in
 * the Swift catalogue files it under its maker with no change here.
 */
const collate = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function byMaker (rows) {
  const groups = new Map()
  for (const m of rows || []) {
    const k = m.maker || 'Other'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(m)
  }
  return [...groups.entries()]
    .map(([maker, models]) => ({ maker, models: models.sort((a, b) => collate.compare(a.name || '', b.name || '')) }))
    .sort((a, b) => collate.compare(a.maker, b.maker))
}
