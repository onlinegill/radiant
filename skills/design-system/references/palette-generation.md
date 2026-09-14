# Palette Generation — deriving a full palette from a brand colour

Reference for **Mode 1 step 4** (propose a design token set) and **Mode 2 dimension 8**
(accessibility / contrast).

Generating a palette from a brand colour has a small number of failure modes that are easy to hit
and hard to walk back, because they reach every screen at once. This is the method that avoids
them, with the reasoning, so the agent can apply it rather than pattern-match it.

---

## 1. A brand colour is a *feature* until it is proven readable

The most common generated-palette bug: take the brand hex, assign it to `--accent`, use `--accent`
for links and labels. For roughly half of real brand colours this produces text nobody can read.

Worked example. A catering client's brand gold is `#D9C756`:

| Pair | Contrast | WCAG |
|---|---|---|
| `#D9C756` on white | **1.71:1** | fails 4.5:1 body **and** 3:1 UI |
| `#D9C756` on `#1A1A1A` | 10.16:1 | passes |

So split every seed into two roles:

- **Feature** — the raw brand colour. Fills, selection stripes, chips, chart series, badges.
  Anywhere contrast carries no meaning.
- **Accent** — a derivative that clears 4.5:1 against the surface it sits on. Every piece of text.

Derive the accent by walking lightness along the seed's **own hue**, preserving hue and chroma, until
it clears the floor. Gold resolves to `#83751D` (4.64:1).

**Leave a passing seed alone.** A seed that already clears the floor must come back unchanged —
navy `#1B365D` (12.12:1) and teal `#17677A` (6.45:1) both derive at ΔL 0%. An engine that only
intervenes when a measurement demands it can be trusted not to quietly redesign a brand that was
fine. One that always "adjusts" cannot.

---

## 2. Do the work in OKLCH. Never HSL.

HSL's lightness is `(max+min)/2` — arithmetic, not perceptual. Two colours at the same HSL lightness
can differ enormously in real brightness:

| Space | Colour | Stated lightness | WCAG luminance |
|---|---|---|---|
| HSL | `#FFFF00` yellow | L 50% | **0.928** |
| HSL | `#0000FF` blue | L 50% | **0.072** |
| OKLCH | `#928A07` yellow | L 0.62 | 0.243 |
| OKLCH | `#5A83DA` blue | L 0.62 | 0.235 |

A **12.9× luminance gap** in HSL against a **3% gap** in OKLCH. A ramp built by holding HSL lightness
fixed across hues looks evenly spaced in the numbers and visibly uneven on screen — worst for
yellows and oranges, which is exactly where brand colours cluster.

Use OKLCH (or HCT) to **place** colours. Use WCAG relative luminance to **verify** them. They are
different jobs; don't substitute one for the other.

If the target codebase has no colour library, OKLCH conversion is about 25 lines — Oklab's published
matrices, then `C = hypot(a,b)`, `H = atan2(b,a)`. When a chroma is out of sRGB gamut, reduce chroma
and keep lightness and hue; that preserves the ramp's evenness, which is the thing the ramp is for.

---

## 3. Emit a 12-step ramp with per-step meaning

Mature systems converge on 10–13 steps (Carbon 10, Radix 12, Material 13). Prefer **12** with
Radix's semantics, because a step that says what it is *for* lets a component pick a token without a
judgement call:

| Steps | Purpose |
|---|---|
| 1–2 | app background, subtle background |
| 3–5 | component background — rest / hover / pressed |
| 6–8 | borders — subtle, interactive, strong / focus |
| 9–10 | solid brand fill — rest / hover |
| 11–12 | text — low contrast / high contrast |

**Step 9 is the raw brand colour; steps 11–12 are the text.** They are different steps by design —
the same feature/accent split as §1, arrived at independently. If a generated token set has one
`--brand` doing both jobs, that is the bug.

Ship the ramp only if it passes: **step 11 on step 2 ≥ 4.5:1**, and **step 12 on step 2 ≥ 7:1**.

---

## 4. Expose four knobs, not ten

Systems that genuinely generate from a seed converge on four user-facing inputs:

1. **Seed** — one to three brand colours.
2. **Style** — a *named* preset (muted / vibrant / neutral / expressive). Each pins a chroma target
   and hue-rotation angle internally.
3. **Contrast** — standard / medium / high.
4. **Mode** — light / dark / system.

Material deliberately exposes the style *name* and never the underlying chroma and rotation numbers,
on the reasoning that raw chroma controls in non-designer hands produce bad palettes. Follow that:
derive everything else. **If a component needs a colour that isn't a role, the role set is wrong —
that is not licence to add a knob.**

A fifth per-role override is reasonable when the audience is developers rather than end users.

For harmony, the source-level default (Material's TonalSpot) is: **secondary = seed hue at lower
chroma; tertiary = seed hue rotated +60°.** Colour-wheel vocabulary — triadic, complementary,
split-complementary — appears nowhere in the rationale. The 60° is a tuned constant. Don't restate
the folklore as if it were the algorithm.

---

## 5. Never derive semantic colours from the seed

Error, warning and success are a **fixed, independent family**. Material and Carbon both ship them
untouched by the primary seed.

This is the only thing that survives a hostile brand. A lime-branded product whose "success" green is
also generated from the seed produces a screen where a confirmation and a decorative chip are the
same colour.

Add one check: **if the seed's hue is within ~25° of a semantic hue, flag it.** The fix is to
separate the semantic by chroma and lightness — never by hue, since moving the hue stops red reading
as red.

---

## 6. Dark mode is a role remap, not an inversion

- Reassign roles to **different steps of the same ramp**. Do not reverse the ramp.
- **Never pure black.** Baseline near `#121212`. Pure black removes any ability to express elevation
  and makes light text harsher.
- Brand colour on dark surfaces goes **lighter and slightly desaturated** — high chroma at high
  luminance vibrates against a dark ground.

This matters for Mode 2 dimension 6 ("Dark mode — complete or half-done?"): a dark theme built by
inverting a light ramp is *half-done by construction*, even when every token is present.

---

## 7. Stress-test before claiming the generator is safe

A generator that claims to handle any brand is only worth believing if it has been attacked. Keep two
deliberately awful seeds in the test set:

- **Near-white and semantically colliding** — e.g. lime `#D4FF00`. Breaks the contrast floor and the
  semantic check at once.
- **Almost no chroma** — e.g. pale pink `#FFD9E8`. The furthest a seed can get from usable.

Both must still produce a ramp that passes §3. Label them clearly as tests wherever they surface, so
nobody mistakes a crash-test dummy for a candidate brand.

---

## 8. Audit hook (Mode 2, dimension 8)

Contrast scoring should be **computed, not eyeballed**. For each text/background pair actually used:

1. Resolve both to hex (follow CSS variables to their computed value).
2. WCAG 2.1 relative luminance, then `(L_light + 0.05) / (L_dark + 0.05)`.
3. Floors: **4.5:1** body text, **3:1** large text (≥18.66px bold / ≥24px) and interface elements.
4. Report the measured ratio and the file:line, not a verdict. "1.71:1 against a 4.5:1 floor" is
   actionable; "low contrast" is not.

Two traps worth encoding:

- **A text-shadow improves legibility but contributes nothing to the WCAG ratio.** A scrim carries
  compliance; the shadow is why the scrim can stay light. Say both halves or neither.
- **Text over imagery or video** has no single background colour. Sample the actual pixels behind the
  text and score against the 95th-percentile-brightest background pixel, not the average — the
  average hides the worst case, which is the case that fails.

---

## Sources

Primary, worth reading before changing any of the above:

- [material-color-utilities — dynamic colour scheme](https://github.com/material-foundation/material-color-utilities/blob/main/concepts/dynamic_color_scheme.md) and [`scheme_tonal_spot.dart`](https://github.com/material-foundation/material-color-utilities/blob/main/dart/lib/scheme/scheme_tonal_spot.dart) — the actual constants
- [Radix Colors — understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) — the 12 steps and their meanings
- [Carbon Design System — colour](https://carbondesignsystem.com/elements/color/overview/)
- [Google Design — dark theme](https://design.google/library/material-design-dark-theme) — the `#121212` baseline
- [Oklab](https://en.wikipedia.org/wiki/Oklab_color_space) · [Verou — LCH in CSS](https://lea.verou.me/blog/2020/04/lch-colors-in-css-what-why-and-how/)
- [APCA](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html) — candidate WCAG 3 method; worth tracking, not yet the gate

Judgement-call territory, corroborated by practice but not specified by any standard: semantic-colour
collision handling, and the exact step count within the 10–13 range.
