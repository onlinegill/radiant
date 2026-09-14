# Pre-submission checklist

Tick every line by *looking*, not by remembering. "Verified by reload" means
you saved, reloaded the page, and read the value back.

## App information
- [ ] Bundle ID, SKU, primary language set
- [ ] Category chosen for what the app *does*, not where similar apps sit
- [ ] Seller name is what the user wants (an Individual enrolment shows the
      person's legal name and cannot be changed in App Store Connect — it needs
      a D-U-N-S number and an org conversion; this does not block release)

## Name and subtitle (30 characters each)
- [ ] Name is available — the store checks uniqueness on save; have a fallback
- [ ] Neither contains `iPhone`, `iPad`, `Apple`, `Mac`, `iOS` (5.2.5)
- [ ] Neither contains a phrase a stranger would read as another company's
      brand — `Open AI` reads as OpenAI (5.0.0); write `open-weight`
- [ ] Subtitle is true in every configuration the app allows (a cloud key
      makes "fully offline" false)
- [ ] Character counts written down next to the text

## Description (4,000), promotional text (170), keywords (100)
- [ ] Every feature claimed exists in the build being submitted
- [ ] Optional cloud/network features described as optional, with where the
      data goes
- [ ] Keywords: no competitor brand names, no `gpt` if you are not OpenAI
- [ ] Promotional text is the one field editable without a new build — use it
      for anything that may change

## URLs
- [ ] Support URL, marketing URL, privacy policy URL each fetched; read the
      *title* of the page that came back, not just the status code
- [ ] The marketing page is about *this* product (Radiant's pointed at the
      Mac app — consistent, but a decision, not an accident)

## App Privacy
- [ ] Every data category answered from the code, not from hope
- [ ] Data the user sends to *their own* third-party service (their API key,
      their provider) is not developer collection — say so in the record
- [ ] **Publish pressed.** Saved answers are a draft; the submit button
      refuses with a message about an Admin needing to provide privacy
      information

## Age rating
- [ ] Answered as the closest shipped peer did, plus what this app adds
- [ ] For anything that generates text: profanity, mature themes, violence
      rows at Infrequent/Mild at least — do not declare None to chase 4+
- [ ] Features step (parental controls, UGC, messaging between users,
      advertising) answered against the code
- [ ] Note what would change the answers (e.g. a field for arbitrary model
      repos would reopen the content rows)

## App Review Information
- [ ] Sign-in required: unchecked if there is no login; otherwise a working
      demo account
- [ ] Contact name, phone, email
- [ ] Review notes ≤ 4,000 characters — count before pasting; say how to test,
      what needs Wi-Fi, what a reviewer on a smaller device will see and why
      that is intentional
- [ ] If the app looks like a web wrapper (WKWebView UI), say what native work
      it does and how to prove it (Airplane Mode after a download)

## Build
- [ ] Build number higher than every build already uploaded — read it from
      the project file, not a note
- [ ] Any path the Simulator cannot run (GPU, camera, on-device ML) exercised
      on a physical device in a Release build before upload
- [ ] Any data the app fetches at launch (catalogues, remote config) validated
      by a script that fails on a bad entry — a bad publish reaches every
      device at once
- [ ] Screenshots for the required device slots, RGB, no alpha channel

## TestFlight → Test Information (separate tab, gates external testing only)
- [ ] Beta App Description (a contenteditable div — click and type)
- [ ] Feedback email
- [ ] Marketing and privacy URLs (fetch them)
- [ ] Contact block, sign-in required, review notes

## Record
- [ ] `docs/APP_STORE_LISTING.md` (or equivalent) holds all of the above with
      a dated "read from App Store Connect on <date>: <status>, build <n>"
