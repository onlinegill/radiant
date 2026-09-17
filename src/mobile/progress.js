/**
 * What to print while a download runs.
 *
 * ⚠️ THIS LIVED INSIDE ModelsScreen.jsx, WHERE NO TEST COULD REACH IT. The
 * Hugging Face row then read `progress[id]` as a NUMBER and multiplied it —
 * but the hook stores an OBJECT, { pct, done, total } — so the row rendered
 * "Downloading… NaN%". Tony: "i got Downloadin: NaN or something like that."
 * The formatter itself was always correct; the bug was a second place doing
 * its own arithmetic on a shape it had guessed. Pure logic, one home, one
 * test — the same rule DownloadMath.swift already follows for this exact
 * class of bug.
 *
 * A percent when the total is known; the megabytes when it is not — never
 * "0%" for ten minutes, which is what a fraction-only relay produced. null
 * means "say Downloading…", never a made-up number.
 */
export const progressText = (p) => {
  if (!p) return null
  if (typeof p.pct === 'number' && Number.isFinite(p.pct)) return `${Math.round(p.pct * 100)}%`
  const done = Number(p.done)
  if (Number.isFinite(done) && done > 0) {
    return done >= 1e9 ? `${(done / 1e9).toFixed(1)} GB` : `${Math.round(done / 1e6)} MB`
  }
  return null
}
