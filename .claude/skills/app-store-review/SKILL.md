---
name: app-store-review
description: >-
  Get an iOS/iPadOS app through App Store review and keep it there — preparing a
  submission, reading App Store Connect instead of guessing, answering a 2.1
  information request, fixing a metadata rejection without a new build, and
  the App Store Connect traps that cost a round trip each. Use when the user
  says "submit to the App Store", "Apple rejected the app", "what's the status
  of the submission", "fill in TestFlight", "app privacy", "age rating", or
  anything about App Store Connect. Learned the hard way shipping Radiant for
  iPhone (two rejections, one lost day, a subtitle that was both rejections at
  once).
---

# App Store Review — what actually happens, and what to do about it

This is a working protocol, not Apple's documentation. Every rule in it was
paid for by a real round trip on a real app (Radiant for iPhone, 2026-08 to
2026-09). Where a rule looks paranoid, the reference files say what it cost.

It is model- and harness-agnostic. "Open App Store Connect" means: drive a
browser if you have one, and otherwise write the exact steps for the user. Only
the account holder can press Submit, reply to App Review, or upload a build —
prepare everything, then hand over, and never report a step as done that you
did not see finish.

## Rule zero: read App Store Connect before you trust anything

The status of a submission lives in exactly one place:

    https://appstoreconnect.apple.com/apps/<app id>/distribution/reviewsubmissions

Not in your notes, not in the last commit message, not in the project file's
build number, not in what the user remembers. Every one of those went stale on
Radiant — a status doc said "Waiting for Review" for **nine days** while the
app had been REJECTED, and a whole day of work was done on a build that was not
in the queue at all. Reading the page costs one navigation. Do it first, every
time the task touches the submission, and write what you saw (status, build
number, date) into whatever record you keep, dated.

Corollary: **a prediction of why Apple will reject is worth nothing.** Radiant's
notes predicted guideline 1.2 twice; Apple raised 2.1, then 5.0.0 + 5.2.5. Do
not build a fix for a rejection that has not happened.

## The workflow

### 1. Before the first submission — the checklist

Work through `reference/checklist.md` in full. The items that bite:

- **The name must be unique across the whole store** and can be held by an app
  that never shipped. Have a second name ready.
- **Name and subtitle must not contain Apple trademarks** (`iPhone`, `iPad`,
  `Apple`, `Mac`). The description may mention them; the subtitle reads as
  branding and is held to guideline 5.2.5.
- **Say nothing that reads as another company's brand.** "Open AI models"
  (meaning open-weight) was read as **OpenAI** and triggered China's
  deep-synthesis rule (5.0.0). Write "open-weight" or "open models".
- **If the app can send anything to a third party — even optionally, even with
  the user's own API key — the app itself must disclose and ask first.**
  Guidelines 5.1.1(i) and 5.1.2(i): before the first byte goes to a cloud AI
  service (or any third party), the app shows what is sent, to whom (by name),
  what it is used for, and gets an explicit Allow / Not now. A privacy policy
  saying the same thing does not count — Apple's own words: *"only including
  this information in the app's Terms of Service or Privacy Policy is not
  sufficient."* The policy must ALSO state what data, how it is collected, all
  uses, and that the third party protects it. Radiant lost a review cycle to
  this with a bring-your-own-key provider list; the sheet took an afternoon
  after the rejection and would have taken an hour before it. Build it before
  the first submission.
- **Every claim in the metadata must be true when a reviewer pokes at it.**
  "Fully offline" is false the moment the app accepts a cloud API key. A
  subtitle can be shorter than the truth; it cannot be bigger.
- **App Privacy has a Publish button.** Saving the answers is a draft. The
  submit button then refuses with "an Admin must provide information about the
  app's privacy practices", which does not sound like "you forgot to publish".
  Verifying a value reloads correctly is not verifying the section is done.
- **Age rating: do not chase 4+ with an app that generates text.** Answer as
  the closest shipped peer did (look them up on the store), plus whatever your
  app adds. A reviewer who types a rude question and gets a rude answer has
  caught a false declaration (2.3).
- **Review notes are capped at 4,000 characters** and a 4,151-character draft
  is refused with no useful message. Write them in a file, count, then paste.
- **Fetch every URL you enter** and check the *title* of what comes back. A
  site that answers 200 with its homepage for unknown paths makes a typo look
  fine.
- **Run the app on a physical device before uploading** if any code path
  cannot run in the Simulator (anything using Metal/GPU: MLX, Core ML on GPU,
  camera). "Verified in the Simulator" is not a claim you can make about it.

### 1b. The app has to survive being live, not just pass review

⚠️ **THIS SECTION EXISTS BECAUSE THE SKILL DID NOT HAVE IT.** Everything above
gets a binary through review. None of it makes the app a product once it is on
sale, and Radiant shipped 1.0 with no way to rate it — discovered a day after
launch, by the owner, not by the checklist. His words: "not being able to rate
the app is a crippling problem."

Review these **before the first submission**, because two of them cannot be
fixed without another review cycle.

**A rating prompt. Non-negotiable.** Ratings are a ranking input, and a new app
has none. No ratings means no ranking means no downloads means no ratings —
the loop does not break on its own, and every week without the prompt is a week
of installs that could have left one and did not. Implement
`AppStore.requestReview(in: scene)` (iOS 18+), falling back to
`SKStoreReviewController.requestReview(in: scene)`, and:

- ask **after a success the person can feel**, never on launch, never mid-task.
  Radiant asks after a model finishes downloading AND the person has had a real
  conversation — they have seen it work twice, on their own device;
- ask **once**, and record that you asked **before** the call, so a slow or
  failing request cannot produce a second prompt. The system caps it at three a
  year, but "the system will stop me" is not a reason to ask twice;
- it must never block, branch or report failure. The system decides whether a
  prompt actually appears and never tells you;
- **verify the class is in the shipped binary.** A new plugin/source file that
  is not in the Xcode target's Sources phase compiles nothing, and the call is
  refused at runtime where a `catch` swallows it. `strings -a <binary> | grep
  <ClassName>` — do not trust BUILD SUCCEEDED.

**Keywords, or nobody finds it.** 100 characters, comma-separated, **no spaces
after the commas** (a space costs a character and buys nothing). Do not repeat
words already in the name or subtitle — those are indexed and a repeat wastes
the budget. No competitor brand names and no other companies' model names: the
description is held to a looser standard than keywords, so name the models
there instead. A day after Radiant launched it was findable at #17 for one
narrow phrase and nowhere in the top 40 for anything else, including its own
name — indexed, but ranking nowhere, which is the normal state of an app with
no ratings and empty keywords.

**Promotional text.** 170 characters, sits above the description, and is the
**only** listing field that can be changed at any time with no review. Not
indexed for search, so it is for what changes — a new feature, a moment — not
for keywords. Radiant shipped with it empty.

**Then look at the app the way a stranger will**, before the reviewer does:
first launch with no data, the empty states, what the first sixty seconds asks
of someone who has never seen it, and whether anything a new user hits first is
half-built. A reviewer opens the app cold; so does every download.

### 2. While it is in review — statuses and what they mean

| Status | Meaning | Do |
|---|---|---|
| Waiting for Review | in the queue | nothing; do not resubmit, do not touch the build |
| In Review | a person has it | nothing |
| Rejected — *Information Needed* (2.1) | not a violation; questions | answer in App Review **and** paste the answers into Review Notes; no button to press, the reply is the resubmission |
| Rejected — a guideline number | a finding | see step 3 |
| Pending Developer Release | approved, held | the user presses Release |
| Removed | you pulled it | a fresh submission is needed |

**"Missing Test Information" is a TestFlight warning, not an App Store one.** It
gates *external* TestFlight testing only and does not block review. It lives
under TestFlight → Test Information, a different tab with its own fields. Fill
it (it takes ten minutes; `reference/checklist.md` lists the fields), but do not
read it as a problem with the submission.

### 3. When it is rejected — read it like this

1. Copy the rejection text verbatim into your record, with the guideline
   numbers, the submission ID, the reviewed device, and the date.
2. For each citation, find **the exact field** that contains the flagged
   words. Apple quotes them. Search name, subtitle, description, keywords,
   promotional text, review notes, screenshots, what's-new — separately.
   One 30-character subtitle carried both of Radiant's citations.
3. Decide: **metadata-only fix, or new build?** Most first-app rejections are
   metadata. A metadata fix needs no upload and keeps the same binary.
4. Read Apple's *Next Steps* literally — they often name the cheap option
   (deselect the China mainland storefront rather than strip every OpenAI
   reference and hold an MIIT licence you do not have).
5. Make the edits. **Verify each by reloading the page.** App Store Connect
   greys its Save button whether or not the write reached the server.
6. Resubmit. For a metadata fix this is **two buttons on two pages**: on the
   version page, **Update Review** moves the item from Rejected to Ready for
   Review; only then does **Resubmit to App Review** on the submission page
   become enabled. The second is greyed out until the first is pressed, and
   nothing says so.
7. Record the new status, dated, and stop predicting.

`reference/rejections.md` has the four Radiant rejections in full — the text,
the field, the fix, the buttons — including the one that needed a new build.

### 4. When a new build is needed while one is in the queue

A submitted binary cannot be edited. Raise the build number (read it from the
project file — it has drifted from every note that recorded it), archive,
upload. While the state is *Waiting for Review* or *In Review*, use **Remove
this version from review** first, attach the new build, submit again — that
keeps the same version listing. Once it is *Pending Developer Release* or on
sale, the new build is an update instead.

### 5. After approval

**Being approved is not being found.** Check where the app actually ranks
rather than assuming the store will surface it: `itunes.apple.com/search?
term=<...>&entity=software&country=us&limit=50` and look for your `trackId`,
and `itunes.apple.com/lookup?id=<id>` for what the listing really holds
(promotional text, release notes, screenshot counts, description). Search a few
terms including the app's **own name**. Found by developer name but not by app
name means it is indexed and ranking nowhere — a keywords and ratings problem,
not a propagation one. Do not report "the index hasn't caught up" without
measuring; that was said about Radiant and was wrong.

Nothing in the store updates itself. Metadata edits (promotional text, review
notes, what's-new for the next version) do not need a build; the subtitle,
name, screenshots and description are tied to a version and change with the
next submission. Keep a list of "change on the next submission" items in your
record — Radiant's is the subtitle — and put it in front of the user as part of
the next build's checklist. Do not assume they remembered.

## Uploading a build from the command line

`xcodebuild -exportArchive -archivePath <.xcarchive> -exportOptionsPlist
<plist with destination: upload> -allowProvisioningUpdates` uploads without
Xcode's GUI — but it reads the Apple ID from **Xcode → Settings → Accounts**.
"exportArchive Failed to Use Accounts" / "No Accounts" means nobody is signed
in on this Mac; the log also says "No signing certificate iOS Distribution
found", which is a red herring — once an account is signed in, cloud-managed
signing supplies the certificate and no local Distribution identity is needed.
Ask the user to sign in, rerun, look for "Upload succeeded" and
"EXPORT SUCCEEDED". Processing on Apple's side takes several minutes before
the build can be attached to a version.

## Driving App Store Connect with a browser

- **Two kinds of fields refuse programmatic value-setting.** React-controlled
  inputs ignore `.value =` — the field stays empty and Save never enables. Click
  and type, or set through the native value descriptor and dispatch `input`
  then `change`. The TestFlight *Beta App Description* is a `contenteditable`
  div, not a textarea; a `querySelectorAll('textarea')` sweep misses it.
- **Reload after every save** and read the value back. Greyed Save proves
  nothing.
- **The "Publish" on App Privacy is separate from Save.** Look for it.
- **Storefront availability** is under Pricing and Availability, a different
  page from the version; deselecting a country there is what "not distribute in
  China" means.
- Only the account holder can sign in. Do not handle credentials; have them
  sign in, then continue.

## Screen recordings for App Review

Apple asks for one when they cannot see the feature work (2.1). Rules that each
cost a take on Radiant:

- **Check the status bar before believing an offline demo.** Airplane Mode with
  Wi-Fi re-enabled shows a Wi-Fi fan; Wi-Fi off with cellular up shows "5G+".
  The take that counts shows Airplane Mode on and *no* radio in the status bar.
- **Do not put a hallucination in front of the reviewer of an AI app.** A tiny
  model inventing history is not a demo. Use a prompt with a short, checkable
  answer (a haiku, a unit conversion).
- Record on a physical device; the Simulator is not accepted for this.

## Keeping the record

Keep one file in the repo (Radiant uses `docs/APP_STORE_LISTING.md`): every
metadata field's current text with its character count, the privacy answers and
why, the age rating answers and why, each rejection verbatim with the fix, and
a dated status line that says *when it was last read from App Store Connect*.
Headings that state a status go stale; prefer "checked 2026-09-10: Waiting for
Review, build 6" to "Waiting for Review".

## What this skill does not do

It does not decide the product's content policy, it does not enrol the
developer account, and it does not convert an Individual enrolment to an
Organization (that is a D-U-N-S number plus a support request, and it updates
the seller name on shipped apps without a resubmission — so it never blocks a
release).
