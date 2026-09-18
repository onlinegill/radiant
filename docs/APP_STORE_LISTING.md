# Radiant — App Store Connect fields

Everything below is drafted to Apple's character limits and checked against what
the app actually does. Counts are in brackets.

---

## App information

**Bundle ID** — `com.templetongroup.radiant`
**SKU** — `radiant-ios-1`
**Primary language** — English (U.S.)
**Category** — Primary: **Productivity**. Secondary: **Developer Tools**.

> Not "Utilities": the app's job is getting work done in a conversation.
> Developer Tools as secondary because the provider/API-key audience lives there.

---

## Name and subtitle

**App name** (30 max)
```
Radiant - Local AI Chat
```
*(23)*

> "Radiant — Local AI" was already taken — App Store names are globally unique
> and a name can be held by a record that never shipped, so it is invisible.
> This one is accurate, which matters more than it sounds: guideline 2.3 rejects
> a name that promises something the app does not do. It is a local AI chat app,
> and that is what it now says.
>
> ⚠️ THE NAME ON THE PHONE IS UNAFFECTED. The Home screen icon reads **Radiant**,
> from CFBundleDisplayName in the app bundle. Only the store listing changed.

**Subtitle** (30 max)
```
Open AI models, on your iPhone
```
*(30 — exactly at the limit)*

---

## Promotional text (170 max — editable without a new build)

```
Download an open model and talk to it anywhere — on a plane, underground, with
no signal. Nothing you send it leaves your phone.
```
*(129)*

---

## Description (4000 max)

```
Radiant runs open AI models directly on your iPhone.

Download a model once and it works anywhere — on a plane, underground, with no
signal at all. Nothing you send it leaves the device, because there is nowhere
for it to go: no account, no sign-in, and no server of ours in between.

CHOOSE FROM 44 MODELS

Models from Google, Meta, Mistral, Microsoft, IBM, Alibaba, NVIDIA, DeepSeek,
Liquid AI, Hugging Face and more — grouped by who made them, from 0.2 GB up.

Every model is labeled for YOUR iPhone before you download it: Runs well, Runs
tight, or Won't run. That verdict is measured against the memory iOS actually
grants an app on your specific device, not a guess from the spec sheet — so you
know before you spend the download.

BUILT FOR THE PHONE

· Conversations are kept and named, so you can pick one up later
· Switch models mid-conversation without losing what you were saying
· Twelve color themes, four appearance modes, and your own text size
· Full Dynamic Type and VoiceOver support

BRING YOUR OWN KEY, OPTIONALLY

If you want a model too large for any phone, add your own API key for Anthropic,
OpenAI, OpenRouter, xAI, Nous, DeepSeek, Kimi, GLM, MiniMax, Groq or Mistral. Keys are
held in the iOS Keychain. The line under every chat title tells you which model
is answering and where it runs, so you always know whether you are on-device or
online.

Radiant is a Templeton Technologies product.
```

---

## Keywords (100 max, comma-separated, no spaces after commas)

```
offline,private,llm,assistant,coding,code,gemma,qwen,llama,mistral,on-device,gpt
```
*(79)*

> ⚠️ "local", "AI" and "chat" were REMOVED because they are now in the app name,
> and Apple already indexes every word of the name — repeating them wastes
> characters that could buy another search term.
>
> "coding" and "code" earn the developer search traffic WITHOUT claiming it in
> the name. Keywords are search intent; the name is a claim about the app, and
> only one of those is held to guideline 2.3. The iPhone app is not a coding
> assistant — that is the Mac app.

---

## URLs

**Support URL** — `https://www.templetongroup.dev/showcase/radiant/`
**Marketing URL** — `https://www.templetongroup.dev/showcase/radiant/`
**Privacy Policy URL** —
```
https://www.templetongroup.dev/showcase/radiant/privacy.html
```

> ⚠️ **The `.html` is load-bearing.** `templetongroup.dev` answers 200 for unknown
> paths and serves the homepage — the extensionless `/privacy` returns 327 KB of
> homepage while the `.html` returns the real policy. Verified by content.

---

## Privacy nutrition label

**Answer: "Data Not Collected" for every category.**

There is no analytics SDK, no advertising identifier, and no Templeton server
that receives anything. Two flows send data off-device, both user-initiated and
both going to the user's own service, not to us:

| Flow | Goes to | Ours? |
|---|---|---|
| Messages to a cloud model the user configured | That provider, under their policy | No |
| Model weight downloads | Hugging Face | No |

Apple does not count either as collection by the developer.

---

## REJECTED 2026-09-14 — 5.1.1(i) and 5.1.2(i): consent before a cloud provider

Reviewed on an iPad Air 11-inch (M3), version 1.0 (6), submission
4cc9084e-2de8-437a-9ced-494c5f0ff170, review date September 14, 2026. Verbatim:

> The app appears to share the user's personal data with a third-party AI
> service but the app does not clearly explain what data is sent, identify who
> the data is sent to, and ask the user's permission before sharing the data.
> […] Note that only including this information in the app's Terms of Service
> or Privacy Policy is not sufficient.

**The finding is correct.** Settings → Providers takes an API key and the next
message goes to that provider; the privacy policy said so, the app did not, and
the app never asked. A NEW BUILD is required — this is in-app behaviour.

### What build 7 does

- `src/mobile/ConsentSheet.jsx` + `consent.js`: before the first message to a
  provider, a sheet titled "Send your messages to <Provider>?" says what is
  sent (the messages in that chat, attached images, the replies), where it
  goes (the provider, by name and host, under its own policy — not to us),
  what is not sent, how to withdraw (remove the key), with a link to the
  policy, and **Allow / Not now**. Nothing is sent until Allow.
- It is asked at the two doors: saving a provider key (ProvidersScreen) and
  the first cloud send (MobileChat), per provider. Removing the key revokes.
- `scripts/test-ui.mjs` drives it in the running phone UI: sheet appears, names
  OpenRouter, sends nothing on Not now, sends on Allow, never asks twice.
- Privacy policy (privacy.html, updated 14 Sept 2026): what is sent, to whom,
  the single use, each provider's policy (every URL fetched, title checked),
  that we do not audit them, and withdrawal.

### Done 2026-09-14, each verified by reload

- Subtitle → **"Open models, on your phone"** (26). The standing decision from
  2026-09-10; "fully offline" was untrue once a key is added — the same fact
  Apple has now raised.
- App Review Information → Notes replaced (3,481 chars): the response to this
  rejection with how to see the sheet, the 10 Sept response once (it had been
  pasted twice), and a body that no longer says "nothing you type leaves the
  device".
- Build 7 archived (`~/Library/Developer/Xcode/Archives/2026-09-14/
  Radiant-build7.xcarchive`) and uploaded with `xcodebuild -exportArchive …
  exportOptions-upload.plist` ("Upload succeeded"). ⚠️ The upload needs an
  Apple ID signed in to Xcode → Settings → Accounts; it failed with "No
  Accounts" until Tony signed in, and then worked with cloud-managed signing —
  no local Apple Distribution certificate exists on this Mac and none was
  needed.
- Reply to App Review drafted (the text is the same substance as the notes'
  first section) — sent with the resubmission, after build 7 is attached.

## Driving App Store Connect from here — `scripts/asc.mjs`

⚠️ **"Only Tony can drive App Store Connect" was true of the WEB UI and nobody
had tested whether it was true of App Store Connect.** It is not. The API takes
a key generated once, and metadata, builds, TestFlight and submissions are then
reachable from a script. Tony: "why cant you handle the keywords... you ask me
to constantly to intervene."

**The one-time setup (about two minutes, and only he can do it** — generating an
API key requires Account Holder or Admin):

1. App Store Connect → **Users and Access** → **Integrations** → **App Store
   Connect API** → **Team Keys**
2. **+**, name it `radiant-cli`, access **App Manager**, Generate
3. Download the `.p8` — **Apple only offers it once** — and put it at
   `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`
4. Copy the **Key ID** and the **Issuer ID** from that page

Then, and from then on without him:

```bash
export ASC_KEY_ID=<key id>
export ASC_ISSUER_ID=<issuer id>
node scripts/asc.mjs whoami                       # apps this key can see
node scripts/asc.mjs get 6804891721               # the live listing, field by field
node scripts/asc.mjs set-promo 6804891721 "..."   # live, no review
node scripts/asc.mjs set-keywords 6804891721 "…"  # needs an editable version
```

The key is read from disk, never printed, never committed, never passed as an
argument; the token it mints lasts 20 minutes. Every write reads the field back
afterwards and fails if Apple accepted the request but the value does not match
— a 204 means accepted, not stored.

⚠️ **Keywords still need an editable version.** They belong to a version and a
live one is locked; the script says exactly that instead of returning Apple's
bare 409. Promotional text is the exception and can be set on the live version
at any time.

## 1.1 is staged — 2026-09-17, via `scripts/asc.mjs`

Nothing is submitted. Version 1.1 exists in PREPARE_FOR_SUBMISSION, which is
invisible to the store and deletable, and is what unlocks the fields that are
read-only once a version is on sale.

| Field | 1.1 |
|---|---|
| **Age rating** | override **EIGHTEEN_PLUS** → computes to **17+** (was 12+/13+) |
| Keywords | brand names out, 97/100 used |
| Description | "CHOOSE FROM 53 MODELS" (was 44) |
| What's New | written |
| Promotional text | re-set — see the warning below |

**The age rating was raised with the OVERRIDE, not by changing content
answers.** Every questionnaire row still says what it said, and those answers
were argued for below and remain true. The override is the field Apple provides
for "rate this higher than my answers imply"; editing the rows to move the
rating would be falsifying a declaration, which is guideline 2.3. Tony's call:
"change the age rating. i dont care" — after a recommendation of 17+, because
the app can download models with their safety training deliberately removed.

⚠️ **A NEW VERSION DOES NOT INHERIT PROMOTIONAL TEXT.** 1.1 came up with it
empty while 1.0 still had it. Anything not re-set on the new version is
silently dropped the moment that version ships. Re-set from 1.0's copy.

⚠️ **The age rating and the keywords live on DIFFERENT records.** Keywords are
on the version localization; the age rating is on the app-level `appInfo`, and
once a version is on sale there are TWO appInfos — the live one first in the
list and read-only. Writing to `data[0]` gives "this age rating declaration is
not editable", which names the symptom and not the cause.

**Still to do before 1.1 is submitted:** attach build 19 (the rating prompt),
and check the screenshots — four on iPhone of a possible ten, one on iPad.

## The listing, read from the API — corrected 2026-09-17

⚠️ **THE EARLIER AUDIT ON THIS PAGE WAS WRONG AND HAS BEEN DELETED.** It said
promotional text was empty and keywords were probably empty. Both were already
set. The mistake was reading `itunes.apple.com/lookup`, which **does not expose
keywords at all** (they are never public) and does not reliably return
promotional text — and then reporting "empty" for "not present in this
response". Absence of evidence was reported as evidence of absence, and it sent
Tony looking for a problem that did not exist.

Read it with `node scripts/asc.mjs get 6804891721`, which asks App Store
Connect itself. What is actually there on 1.0 (READY_FOR_SALE):

| Field | State |
|---|---|
| keywords | **set** — 76 of 100 characters used |
| promotionalText | **set** |
| description | 1,413 chars (says "44 models"; the catalogue ships 53) |
| whatsNew | empty — correct for a 1.0 |
| marketing / support URL | both set |

### What is actually worth changing, with 1.1

Small, and none of it urgent:

- **24 unused keyword characters.** The budget is 100 and 76 are used.
- **Four third-party brand names** — `gemma`, `qwen`, `llama`, `mistral`. They
  are live and Apple accepted them, but `gpt` was struck from this same field
  under the 5.0.0 citation, so the precedent exists. The models stay named in
  the description, which is held to a looser standard.
- **The description undersells it**: 44 models claimed, 53 shipped.

Proposed for 1.1 (97/100, no brand names, nothing repeated from the name or
subtitle):

```
offline,private,llm,assistant,coding,code,on-device,privacy,ondevice,opensource,nointernet,secure
```

⚠️ **So the ranking problem is not empty metadata.** The keywords were always
reasonable. It is a day-old app with **zero ratings**, which is the input the
listing cannot fix and the app can — hence the rating prompt in iOS build 19.

## ✅ APPROVED — 1.0 (build 7), 2026-09-16

Apple accepted 1.0 on build 7, after two rejections:

| | |
|---|---|
| 2.1 Information Needed | 2026-08-25 — answered same evening, but a rejected version does not re-enter the queue by replying; it sat nine days unnoticed |
| 5.0.0 + 5.2.5 | "Open AI models" read as OpenAI (China deep-synthesis rule) and "iPhone" in the subtitle — one 30-character subtitle carried both citations |
| 5.1.1(i) / 5.1.2(i) | no in-app disclosure before data went to a third party — fixed with the consent sheet in build 7 |

What shipped: the consent sheet (`ConsentSheet.jsx` / `consent.js`), the
rewritten privacy policy, and the subtitle **"Open models, on your phone"**.

⚠️ **Read the live status from App Store Connect before acting on this** —
`node scripts/asc.mjs get 6804891721`. Checked 2026-09-18 10:00 ET: **1.1
(build 21) READY_FOR_SALE**, 1.0 READY_FOR_SALE. 1.1 was submitted 2026-09-17
17:04 ET by `asc.mjs submit` and approved overnight with no questions. It
carries the Hugging Face search (unfiltered), Archive, the keyboard fix, the
unsent-message fix, the byline link, and the **17+ age rating** answered for
an open model list — that answer is on record now and does not need
re-answering unless the app changes again. `CURRENT_PROJECT_VERSION` is 21.
Screenshots are still 1.0's (4 iPhone 6.7", 1 iPad 12.9"); replace with the
next submission.

---

### Build 11 uploaded 2026-09-15 6:29 PM — TestFlight; supersedes 10

Master `470f554`: the Hugging Face search is no longer filtered. The
uncensored/abliterated word filter is removed on Tony's instruction. Verified
absent from the archived bundle before upload. Not attached to the submission
— and the age-rating questionnaire now definitely has to be re-answered on an
open, unfiltered list before anything after build 7 is submitted.

### Build 10 uploaded 2026-09-15 5:45 PM — TestFlight; supersedes 9

Master `41d87a3`. Build 9's keyboard fix did not work on a device: it drove
`--rx-kb` from visualViewport, which with `Keyboard.resize: 'none'` reports the
keyboard late or not at all, so nothing was ever lifted. The height now comes
from the Keyboard plugin's `keyboardWillShow`. The UI gate raises a real plugin
event with the viewport untouched, which is the only way to test the device
path. Same rule as 8 and 9: not attached to the submission, age rating first.

### Build 9 uploaded 2026-09-15 1:27 PM — TestFlight; supersedes 8

Master `2c9ab1b`: the keyboard no longer covers a field at the foot of a
screen (Tony hit it on the Hugging Face search box in build 8). Same rule as
build 8: not attached to the submission, age rating first.

### Build 8 uploaded 2026-09-15 1:04 PM — for TestFlight, NOT attached to the submission

Tony was away from his devices and asked for TestFlight. Build 8 = master
`0a056ac` (Hugging Face search on the Models page). Archived at
`~/Library/Developer/Xcode/Archives/2026-09-15/Radiant-build8.xcarchive`,
uploaded with `exportOptions-upload.plist` ("Upload succeeded"). The version
1.0 submission still holds build 7, Waiting for Review; build 8 was not
attached and must not be until the age-rating questionnaire is answered again
(see Age rating — the model list is no longer closed).

### Resubmitted 2026-09-14 10:15 AM — read from App Store Connect, not inferred

Build 7 attached to version 1.0 (remove build 6 with the red minus, Add Build,
pick 7, Save — verified by reload), **Update Review** on the version page,
the reply posted in App Review (Messages: 3, mine at 10:14 AM), then
**Resubmit to App Review**. Submission 4cc9084e-2de8-437a-9ced-494c5f0ff170,
iOS App 1.0, **1.0 (7), Waiting for Review**.

### ⚠️ The upload needs an Apple ID in Xcode

`xcodebuild -exportArchive` with the upload plist reads the account from
Xcode. "exportArchive Failed to Use Accounts / No Accounts" means nobody is
signed in on this Mac — not a certificate problem, even though the log also
says "No signing certificate iOS Distribution found". Sign in (Xcode →
Settings → Accounts) and rerun; cloud signing handles the certificate.

## REJECTED 2026-09-10 — guideline 5, and ONE FIELD CAUSED BOTH HALVES

Reviewed on an **iPad Air 11-inch (M3)**, version 1.0 (6). Submission ID
4cc9084e-2de8-437a-9ced-494c5f0ff170. Two citations:

- **5.0.0 Legal: Preamble** — China's deep-synthesis (DST) rules. *"the app
  appears to be associated with ChatGPT … the app's metadata includes the
  following references to ChatGPT and/or OpenAI."*
- **5.2.5 Legal: Intellectual Property – Apple Products** — *"Terms for iPhone
  in the app subtitle in an inappropriate manner."*

⚠️ **THE SUBTITLE WAS BOTH REJECTIONS AT ONCE.** It read
**"Open AI models, on your iPhone"** — 30 characters carrying `iPhone`, which is
5.2.5, and `Open AI`, which a reviewer reads as **OpenAI**, which is 5.0.0. The
phrase meant "open-weight models". Nobody outside the project reads it that way,
and the prediction recorded in this file (guideline 1.2, AI content with no
filter) was wrong for the second time running.

⚠️ **THE PREDICTION IN THIS FILE HAS NOW BEEN WRONG TWICE.** It said 1.2. Apple
raised 2.1 the first time and 5.0.0 + 5.2.5 the second. Treat the next guess as
worth exactly nothing.

### Where the flagged terms actually were

| Field | Contained | Action |
|---|---|---|
| subtitle | `iPhone`, `Open AI` | replaced — now **"Open models, fully offline"** (26 chars). ⚠️ **Change to "Open models, on your phone" on the next submission** — see below |
| description | `open AI models`, `OpenAI` | `open AI` → `open-weight`; the OpenAI in the provider list stays, see below |
| keywords | `gpt` | removed |
| review notes | `OpenAI` | kept; a response paragraph added at the top |

`iPhone` in the **description** was NOT cited and stays. Apple flagged the
subtitle specifically, because a subtitle reads as branding.

### The fix taken: China mainland deselected

Apple's own Next Steps offer it: *"you can choose to not distribute this app in
China by deselecting the China mainland storefront"*, and *"Apps with ChatGPT
functionality or metadata references can continue to be used in apps outside of
China."* Availability is now **174 countries**; China mainland reads **Not
Available**.

⚠️ **THE ALTERNATIVE WAS NOT REALLY AVAILABLE.** Keeping China means stripping
every OpenAI reference AND disabling the OpenAI provider in a China build — and
then still needing an MIIT deep-synthesis licence, which a solo developer does
not hold. Suppressing the metadata alone would be a claim Apple can disprove by
opening Settings → Providers.

So the OpenAI mention in the description's provider list is **deliberately kept**.
It is true, it is useful, and outside China it is permitted.

### Resubmitted the same day

All changes are metadata only — **no new build**. 1.0 (6) is still the binary.
On the version page the button is **Update Review** (which moves the item from
Rejected to Ready for Review), and only then does **Resubmit to App Review** on
the submission page become enabled. Two buttons on two pages; the second is
greyed out until the first is pressed. Status now: **Waiting for Review**.

Every field was verified by reloading the page afterwards, because App Store
Connect greys its Save button whether or not the write reached the server.

⚠️ Two App Store Connect fields refuse programmatic value-setting — they are
React-controlled, so assigning `.value` leaves them empty and Save never
enables. Click and type, or set through the native descriptor and dispatch
`input` + `change`.

---

## TestFlight Test Information — filled 2026-09-09

⚠️ **"Missing Test Information" IS A TESTFLIGHT WARNING, NOT AN APP STORE ONE,
and it does not block App Store review.** It was read as a problem with the
submission; it is not. The App Store side was already complete — App Review
Information on the version page had sign-in unchecked, the full contact block,
and 3,600 of the 4,000 characters of notes. Meanwhile every field on
**TestFlight → Test Information** was empty, which is where the warning lives.
It gates EXTERNAL TestFlight testing only. Internal testers work without it.

Checked in App Store Connect, not inferred: iOS App **1.0 Waiting for Review**,
submitted Monday 4:43 PM, build **6** attached. An earlier Thursday submission
shows **Removed**.

Now set (verified by reloading the page, not just by the Save button greying):

| Field | Value |
|---|---|
| Beta App Description | what testers see; names what feedback is useful |
| Feedback Email | tony@templetongroup.com |
| Marketing URL | https://www.templetongroup.dev/showcase/radiant/ |
| Privacy Policy URL | https://www.templetongroup.dev/showcase/radiant/privacy.html |
| Contact | Tony / Ricciardi / 212-517-3001 / tony@templetongroup.com |
| Sign-in required | unchecked — the app has no login |
| Review Notes | 1,248 chars, same substance as the App Store notes |

⚠️ **Both URLs were fetched before saving**, because of the trap already recorded
above: `templetongroup.dev` answers 200 with the homepage for unknown paths.
`/showcase/radiant/` returned 43,466 bytes titled "Radiant: a local coding
harness for Mac"; `/privacy.html` returned 6,695 bytes titled "Privacy —
Radiant". A 200 alone would have proved nothing.

⚠️ **The Marketing URL page is about the MAC app.** It is what the App Store
listing already declares, so this is consistent rather than new — but a
TestFlight tester on an iPhone lands on a page about a different product. Worth
a decision, not a silent inheritance.

**Two App Store Connect fields refuse programmatic value-setting.** They are
React-controlled: setting `.value` leaves them empty and the Save button never
enables. Click and type instead, or set through the native descriptor and
dispatch `input` + `change`. The Beta App Description is a contenteditable div,
not a textarea, so it will not appear in a `querySelectorAll('textarea')` sweep.

---

## Submission status — 2026-08-24

**REPLIED 2026-08-25 21:45.** All seven answers sent in App Review with two
screen recordings attached, and the same answers saved in the Notes field.
"Resubmit to App Review" stays greyed out after replying — for a 2.1
information request the reply itself is what goes back to the reviewer, so do
not go looking for a button to press. If the status has not moved in a couple
of days, that button is the fallback. **No new build is needed; the binary was
never at fault.**

⚠️ THE VIDEO TOOK THREE TAKES, AND THE FIRST TWO WERE UNUSABLE FOR THE REASON
THAT MATTERED. Take 1: Airplane Mode on but Wi-Fi re-enabled — the status bar
showed a live Wi-Fi fan, so it proved nothing about offline use. Take 2:
genuinely offline, but the 350M model invented Civil War history ("General Andy
Schmitt", "the Confederate city of App pressed"), which is not something to put
in front of a reviewer of an AI app. Take 3: Wi-Fi off but cellular still up —
"5G+" in the status bar. Take 4 is the one: Airplane Mode itself on, iOS showing
"Disconnecting Nearby Wi-Fi", no Wi-Fi and no cellular in the status bar, and a
clean haiku. **Check the status bar of any offline demo before believing it.**

**REJECTED 2026-08-25 20:59 — Guideline 2.1, Information Needed.** Not a
guideline violation and no code change required: Apple's standard request for
more detail on a new app. They asked for seven things; six are now answered in
the App Review Notes field (capped at 4,000 characters — a 4,151-character
draft was refused). The seventh is a **screen recording made on a physical
device**, which only Tony can produce, and it must be attached to the reply in
App Review.

⚠️ The prediction in this file was wrong. It said the likeliest ground was
guideline 1.2 (AI-generated content with no filter or report path). Apple did
not raise 1.2 at all. Do not treat that prediction as settled — it has not been
tested, because review never got that far.

**SUBMITTED. Status: "1.0 Waiting for Review" as of 2026-08-24 ~23:20.**
Build 1.0 (2) uploaded at 22:59. App ID 6804891721,
bundle `com.templetongroup.radiant`, arm64, iPhone only (device family 1).

Done and verified by reload:

| Item | State |
|---|---|
| Name / subtitle | Radiant - Local AI Chat / "Open models, fully offline" (26) — was "Open AI models, on your iPhone", which drew BOTH halves of the 2026-09-10 rejection. **Pending: "Open models, on your phone"** (26), see next section |
| Category | Productivity, secondary Developer Tools |
| Description, keywords, URLs, copyright, review notes | filled |
| Screenshots | 4 on the 6.9" slot, RGB, no alpha |

### ⚠️ The subtitle is not true, and it changes on the NEXT submission

"Open models, fully offline" was written on 2026-09-10 to get past the rejection,
and it is a categorical claim that stops being true the moment a person adds an
OpenRouter or Anthropic key — which the app invites them to do. Tony, the same
day: *"if we offer open router api and i can chat with a model like kimi k3 via
open router than data is not only on the phone. isn't that contrary to what we
claim?"* Yes. The description, privacy page, review notes and Apple's
questionnaire all say the true thing (on-device by default, the cloud is
opt-in and goes to that provider, not us); only the subtitle overstates it.

**Decision (Tony, 2026-09-10): change the subtitle to "Open models, on your
phone" (26 chars) on the next submission.** Not now — the current one is
Waiting for Review and he chose not to touch the queue. Whoever prepares the
next build: set it in App Store Connect → the version page → Subtitle before
pressing submit, and update the two rows above. It contains neither "iPhone"
nor "Apple", so it does not re-trigger 5.2.5.
| Sign-in required | unchecked — the app has no login |
| App Privacy | Data Not Collected |
| Privacy policy | https://www.templetongroup.dev/showcase/radiant/privacy.html |
| Content rights | yes, third-party content with rights (the open-weight models in the catalogue — 49 at time of writing) |
| Age rating | 13+ — see below |
| Price / availability | free, all 175 countries |
| DSA trader | declared as a trader; NY Certificate of Assumed Name uploaded; **In Review** |
| Export compliance | no prompt — `ITSAppUsesNonExemptEncryption` is false in Info.plist (HTTPS only) |

**Nothing left to do.** Wait for Apple.

### ⚠️ APP PRIVACY HAS A PUBLISH STEP, AND SAVING IS NOT PUBLISHING

This blocked the submission and cost a round trip. The App Privacy answers
were entered and verified-by-reload early in the evening, and the section still
read "Data Not Collected" on screen — but a **Publish** button sat unpressed in
the corner, so the answers were a draft. "Add for Review" refused with *"an
Admin must provide information about the app's privacy practices"*, which
does not sound like "you forgot to publish".

**The lesson generalizes: verifying a value persisted is not verifying the
section is complete.** Reloading proved the draft saved. It could not prove the
draft had been published, because a saved draft and a published label look
identical on that page apart from one button.

### If Apple rejects

Most likely ground is guideline 1.2 — apps surfacing AI-generated content are
sometimes asked for a content filter, a report mechanism and a way to block
abusive users. Radiant has none; the counter-argument, already in the review
notes, is that it runs models on-device with no accounts and no other users to
report or block. If it comes back, the cheap fix is a first-run content
disclaimer plus a report control, not a rebuild.

### ⚠️ The seller name is "Anthony Ricciardi", not Templeton Technologies

The Apple Developer account is an **Individual** enrollment, so App Store
Connect renders Name and Type read-only — this cannot be fixed in ASC. Tony
wants Templeton Technologies. The path is a D-U-N-S number for TEMPLETON
TECHNOLOGIES, INC. (a real NY domestic business corporation, DOS ID 7877951)
plus an individual-to-organization conversion request to Apple Developer
Support. **Converting later updates the seller name on apps already shipped —
no resubmission**, which is why the release did not wait for it.

### ⚠️ What has never been tested

MLX cannot initialize in the iOS Simulator, so until 2026-08-24 the
model-loading and generation path had never run in a Release build. It was
installed to Tony's iPhone 17 Pro Max via devicectl and exercised by hand
before the upload. There is still no automated coverage of it — the 31 runtime
assertions drive the phone UI in Chrome against a stubbed bridge.

---

## Age rating

**Submitted 2026-08-24. Result: 13+** in 172 countries, 12+ in Vietnam and
Korea, A14 in Brazil. On iOS versions earlier than 26 it maps to a global 12+.

### How the answers were chosen

The benchmark is **Locally AI** (by LM Studio) — the closest peer to Radiant on
the store, rated **12+** with four descriptors: Mature/Suggestive Themes,
Horror/Fear, Alcohol-Tobacco-Drugs, and Medical/Treatment, all Infrequent/Mild.
Private LLM sits at 12+, LLM Studio at 9+, Enclave and MLC Chat at 17+.

Radiant differs from Locally in one way that matters: it also reaches cloud
models through OpenRouter, which carries unfiltered models. So the declaration
is Locally's, plus profanity and plus the two lightest violence rows.

⚠️ **DO NOT answer "None" down the content steps to chase a 4+.** The app ships
no content of its own, but it generates text from a model with no content
filter. A reviewer who types a rude question and gets a rude answer has caught
an inaccurate declaration — guideline 2.3, and a rejection costs more than the
rating ever would.

### Step 1 — Features. All eight NO, each verified against the code.

| Question | Answer | Why |
|---|---|---|
| Parental Controls | No | none exist |
| Age Assurance | No | none exists |
| Unrestricted Web Access | No | the only external link is the privacy page, and it opens in Safari |
| User-Generated Content | No | chats are local and never distributed |
| Social Media | No | — |
| Social Media Disabled for Users Under 13 | No | — |
| Messaging and Chat | No | this asks whether users can talk to *each other*. They cannot |
| Advertising | No | — |

### Steps 2–6 — Content

| Item | Answer |
|---|---|
| Profanity or Crude Humor | Infrequent |
| Horror/Fear Themes | Infrequent |
| Alcohol, Tobacco, or Drug Use or References | Infrequent |
| Medical or Treatment Information | Infrequent |
| Health or Wellness Topics | Yes |
| Mature or Suggestive Themes | Infrequent |
| Sexual Content or Nudity | None |
| Graphic Sexual Content and Nudity | None |
| Cartoon or Fantasy Violence | Infrequent |
| Realistic Violence | None |
| Prolonged Graphic or Sadistic Realistic Violence | None |
| Guns or Other Weapons | Infrequent |
| Simulated Gambling · Contests · Gambling · Loot Boxes | None / No |

Step 7 override: **Not Applicable**. No EULA age requirement, no age category.

### Two things that made the low rows defensible (one no longer holds)

All catalogue models are mainstream instruction-tuned releases from Google,
Meta, Mistral, Microsoft, Alibaba, IBM, Nvidia, Liquid, Allen AI and Hugging
Face — nothing abliterated or uncensored. When this was answered (2026-08-24)
there was also no field anywhere in the phone UI for pasting an arbitrary
Hugging Face repo, so the list was closed.

⚠️ **The list is no longer closed as of 2026-09-15, and nothing is filtered
out of it.** Build 7 (Waiting for Review) still has the closed list, but
`master` has "Find more on Hugging Face" at the foot of the Models page
(`src/mobile/HuggingFaceSearch.jsx`): an unrestricted search over Hugging
Face's public MLX models, with download.

It briefly shipped with a regex hiding repos whose name or tags said
uncensored / abliterated / NSFW. That was removed on Tony's instruction
(2026-09-15): *"why did you add a filter like that at all. I would want people
to be able to download and use uncensored models."* It was never a content
review — a word match on repo names — and it contradicted the product's own
proposition. **Do not reintroduce it to make a rating easier.**

**So this questionnaire MUST be answered again before the next submission, on
the basis of an open list**, and the honest answers are very likely stronger
than the ones on record. Reference points for whoever does it:

- The closest shipped peer, **Locally AI (LM Studio), is 12+ with an open
  model list** — the same shape of app and the same freedom.
- Radiant ships no content of its own; a person has to search for, choose and
  download a model deliberately, and any model can then say anything.
- The current answers already assume no content filter on generation (that is
  why "None" was refused down the content steps — see the warning above).
  What changes is that the *catalogue* argument no longer supports the low
  rows; the declaration has to stand on the generation argument alone.
- Expect to raise at least the sexual-content and violence rows from None.
  A 17+ rating is a legitimate outcome and costs nothing; an inaccurate
  declaration is guideline 2.3 and costs a review cycle.

Tony decides the final answers; they must match the build under review.

---

## Review notes

```
Radiant runs open language models entirely on the iPhone using Apple's MLX
framework. No account is required and there is nothing to sign in to — open the
app, choose a model, download it, and it works offline from then on.

TO TEST: tap "Choose a model", open any maker section, and pick Qwen 3 1.7B
(about 1 GB). Please use Wi-Fi. When it finishes, tap New chat. A model must
finish downloading before a conversation is possible; there is no cloud
fallback.

Models are labeled "Runs well", "Runs tight" or "Won't run" against the memory
iOS grants this app on the specific device. On a review device with less memory,
fewer models will be available — this is intentional and honest, not an error.

The interface is a WKWebView, but the app is not a web wrapper: it bundles MLX
Swift, downloads multi-gigabyte model weights, and performs inference on-device.
Enabling Airplane Mode after a download demonstrates this — the app keeps working
with no network at all.

Settings > Providers optionally accepts the user's own API key for a cloud
provider. This is not required, and no key is supplied for review. Keys are
stored in the iOS Keychain.

The app uses the Increased Memory Limit entitlement because model weights must be
resident in memory to run.
```

**Demo account** — not applicable; the app has no login.
**Contact** — a real phone number and email that will be answered.

---

## Screenshots

Required: **6.9"** iPhone. 6.5" is accepted if provided. iPad is NOT required —
the app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`).

Suggested five, in order:

1. **Home** — the lockup, greeting, New chat
2. **Models** — a maker shelf open, showing the Runs well / Runs tight labels
3. **A chat** — a real reply, with the model name and origin in the title
4. **Settings** — themes and text size
5. **Device panel** — the memory readout above the model list

⚠️ Real app, real data. No mockups, no invented UI, no pricing claims or
"#1 app" captions.

---

## Pricing

Decide: free, or paid. Territories: all, unless there is a reason not to.
