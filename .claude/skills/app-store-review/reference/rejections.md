# Three real rejections, and what each one taught

App: Radiant - Local AI Chat (iOS), Apple ID 6804891721. Dates 2026.

## 1. 2026-08-25 — Guideline 2.1, Information Needed

**What Apple said:** seven questions about how the app works, and a request for
a screen recording made on a physical device.

**What it is:** not a violation. Apple's standard request for a new app it
cannot fully exercise. No code change.

**What was done:** six answers written into App Review Notes (the 4,000-cap
refused a 4,151-character draft — with no message that said why); the seventh
was a screen recording, which only the account holder could make on a phone.
Answers sent as a reply in App Review with two recordings attached, and the
same answers pasted into the Notes field so the next reviewer sees them.

**The trap:** "Resubmit to App Review" stays greyed out after a 2.1 reply. The
reply *is* the resubmission. Nobody went looking for a button, but the record
said so in case someone did.

**The recording:** took four takes. Take 1 had Airplane Mode on but Wi-Fi
re-enabled (a Wi-Fi fan in the status bar proves nothing about offline). Take 2
was truly offline but the 350M model invented Civil War history — not a demo
for a reviewer of an AI app. Take 3 had cellular still up ("5G+"). Take 4:
Airplane Mode on, no radio in the status bar, a clean haiku.

**The record then said "Waiting for Review" for nine days while the app was
REJECTED.** A rejected version does not re-enter the queue because you replied;
it has to be resubmitted, and nobody knew because nobody looked. See Rule zero.

## 2. 2026-09-09 — "Missing Test Information"

**What it looked like:** a red warning on the app, read as a problem with the
App Store submission.

**What it is:** TestFlight → Test Information, every field empty. It gates
*external* TestFlight testing and nothing else. The App Store review
information was already complete.

**What was done:** the seven TestFlight fields filled, both URLs fetched and
their page titles checked (the site answers 200 with its homepage for unknown
paths, so a status code alone proves nothing). The Beta App Description is a
contenteditable div, invisible to a textarea sweep; two other fields are
React-controlled and ignore `.value =` — click and type, or set through the
native descriptor and dispatch `input` + `change`.

## 3. 2026-09-10 — Guidelines 5.0.0 and 5.2.5, one field

**What Apple said:**

- *5.0.0 Legal: Preamble* — "the app appears to be associated with ChatGPT …
  the app's metadata includes the following references to ChatGPT and/or
  OpenAI." (China's deep-synthesis rules.)
- *5.2.5 Legal: Intellectual Property – Apple Products* — "Terms for iPhone in
  the app subtitle in an inappropriate manner."

**Where it was:** the subtitle, **"Open AI models, on your iPhone"** — 30
characters carrying `iPhone` (5.2.5) and `Open AI` (read as OpenAI, 5.0.0).
The phrase meant open-weight models. Nobody outside the project reads it that
way. `iPhone` in the *description* was not cited: the subtitle is held to a
branding standard the description is not.

| Field | Contained | Fix |
|---|---|---|
| subtitle | `iPhone`, `Open AI` | rewritten, no trademark, no brand-shaped phrase |
| description | `open AI models`, `OpenAI` | `open AI` → `open-weight`; the OpenAI in the list of providers kept (true, permitted outside China) |
| keywords | `gpt` | removed |
| review notes | `OpenAI` | kept, with a paragraph at the top addressing the citation |

**The China decision:** Apple's Next Steps offered "deselect the China mainland
storefront". The alternative — strip every OpenAI reference *and* disable the
OpenAI provider in a China build *and* hold an MIIT deep-synthesis licence — was
not really available to a solo developer. Availability went to 174 countries;
China mainland Not Available. Suppressing the metadata alone would have been a
claim a reviewer disproves by opening Settings → Providers.

**Resubmission, metadata only, same binary:** on the version page **Update
Review** (Rejected → Ready for Review), then on the submission page **Resubmit
to App Review**, which is greyed out until the first is pressed. Two buttons,
two pages. Every edited field verified by reload. Same day: Waiting for Review.

**The lesson that came after:** the replacement subtitle, "Open models, fully
offline", is itself untrue once a user adds a cloud key. The user caught it the
same evening. It changes on the *next* submission to "Open models, on your
phone" — the queue was not touched. A subtitle can be smaller than the truth;
it cannot be bigger.

## The prediction was wrong every time

The record predicted guideline 1.2 (AI-generated content with no filter or
report path) before both real rejections. Apple raised 2.1, then 5.0.0 + 5.2.5.
1.2 has still never been raised. Do not pre-build a fix for a rejection that
has not happened; do read the one you got, word by word.

## 4. 2026-09-14 — Guidelines 5.1.1(i) and 5.1.2(i), consent before a third-party AI service

**What Apple said:** "The app appears to share the user's personal data with a
third-party AI service but the app does not clearly explain what data is sent,
identify who the data is sent to, and ask the user's permission before sharing
the data." And: "only including this information in the app's Terms of Service
or Privacy Policy is not sufficient."

**What it is:** correct. The app let a user paste an API key for a cloud
provider and then sent the conversation there. The privacy policy said so; the
app never did, and never asked.

**What was done (a new build, unavoidably):** a consent sheet per provider —
what is sent, where (provider named with its host, under its own policy, not
to us), what is not sent, how to withdraw, a policy link, Allow / Not now —
shown when a key is saved and before the first message to that provider;
removing the key revokes. The privacy policy rewritten for the same four
points with every provider's policy linked (each URL fetched, title checked)
and a line saying we do not audit them. Review notes rewritten; the old body
still said "nothing you type leaves the device", the same overclaim. The
subtitle "fully offline" changed with the same submission for the same reason.

**The lesson:** if the app can send anything to a third party — even
optionally, even with the user's own key — the app itself must say what, to
whom, and ask first, before the first byte. A policy page does not count.
Write that sheet before the first submission; it is a day's work after a
rejection and an hour before one.
