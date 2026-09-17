/**
 * App Store Connect, from here — so nobody has to be walked through a form.
 *
 * ⚠️ THIS EXISTS BECAUSE "ONLY TONY CAN DRIVE APP STORE CONNECT" WAS A
 * CONSTRAINT NOBODY HAD TESTED. It is true of the WEB UI, which needs his Apple
 * ID and a 2FA prompt. It is not true of App Store Connect itself: the API
 * takes a key he generates once, and after that metadata, builds, TestFlight
 * and submissions are all reachable from a script. Tony: "why cant you handle
 * the keywords... you ask me to constantly to intervene." Fair, and this is the
 * answer rather than another set of click-by-click instructions.
 *
 * ⚠️ THE KEY IS A CREDENTIAL AND IS TREATED LIKE ONE. It is read from disk at
 * ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8 (Apple's own location) or
 * from ASC_KEY_PATH. It is never printed, never committed, never passed as an
 * argument, and the token minted from it lives 20 minutes.
 *
 *   ASC_KEY_ID=ABC123  ASC_ISSUER_ID=<uuid>  node scripts/asc.mjs <command>
 *
 *   whoami                       the apps this key can see
 *   get <appId>                  the live listing: name, subtitle, keywords,
 *                                promotional text, description, what's new
 *   set-promo <appId> "<text>"   promotional text — editable on a LIVE app
 *                                with no review at all
 *   set-keywords <appId> "<kw>"  keywords — only on an EDITABLE version; says
 *                                so plainly if the live one is locked
 *
 * Every write prints what it changed, from what, to what.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const API = 'https://api.appstoreconnect.apple.com/v1'

/**
 * The two ids, from the environment or from ~/.appstoreconnect/radiant.env.
 *
 * ⚠️ A FILE, SO IT SURVIVES THE SHELL. Exported variables live as long as one
 * terminal; this has to work from any session, months later, without anyone
 * being asked for them again. The .p8 is NOT in here — it stays a file in
 * private_keys/, and nothing prints either.
 */
function ids () {
  const out = { ASC_KEY_ID: process.env.ASC_KEY_ID, ASC_ISSUER_ID: process.env.ASC_ISSUER_ID }
  if (out.ASC_KEY_ID && out.ASC_ISSUER_ID) return out
  const cfg = path.join(os.homedir(), '.appstoreconnect', 'radiant.env')
  if (fs.existsSync(cfg)) {
    for (const line of fs.readFileSync(cfg, 'utf8').split('\n')) {
      const m = /^\s*(ASC_KEY_ID|ASC_ISSUER_ID)\s*=\s*(.+?)\s*$/.exec(line)
      if (m && m[2]) out[m[1]] = out[m[1]] || m[2]
    }
  }
  return out
}
const { ASC_KEY_ID: KEY_ID, ASC_ISSUER_ID: ISSUER } = ids()

function keyPath () {
  if (process.env.ASC_KEY_PATH) return process.env.ASC_KEY_PATH
  return path.join(os.homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${KEY_ID}.p8`)
}

/**
 * A 20-minute ES256 token, signed with the .p8.
 *
 * ⚠️ ieee-p1363, NOT der. JWS wants the raw r||s pair; Node's default DER
 * encoding produces a token Apple rejects with a 401 that says nothing useful.
 */
function token () {
  if (!KEY_ID || !ISSUER) {
    throw new Error('No API key configured. Fill in ASC_KEY_ID and ASC_ISSUER_ID in ~/.appstoreconnect/radiant.env (App Store Connect → Users and Access → Integrations).')
  }
  const file = keyPath()
  if (!fs.existsSync(file)) throw new Error(`No private key at ${file}. Put the .p8 Apple gave you there.`)
  const key = fs.readFileSync(file, 'utf8')
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const header = enc({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })
  const now = Math.floor(Date.now() / 1000)
  const payload = enc({ iss: ISSUER, iat: now, exp: now + 20 * 60, aud: 'appstoreconnect-v1' })
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${sig.toString('base64url')}`
}

async function call (method, endpoint, body) {
  const res = await fetch(endpoint.startsWith('http') ? endpoint : `${API}${endpoint}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch {}
  if (!res.ok) {
    // Apple's errors are readable; surfacing the detail beats a bare status.
    const detail = (json?.errors || []).map(e => `${e.title}: ${e.detail}`).join('; ')
    throw new Error(`${method} ${endpoint} → ${res.status}${detail ? ` — ${detail}` : ` — ${text.slice(0, 300)}`}`)
  }
  return json
}

/** The version rows, newest first, with their editable state. */
async function versions (appId) {
  const r = await call('GET', `/apps/${appId}/appStoreVersions?limit=10&fields[appStoreVersions]=versionString,appStoreState,platform,createdDate`)
  return r.data.map(v => ({ id: v.id, version: v.attributes.versionString, state: v.attributes.appStoreState }))
}

// ⚠️ A LIVE VERSION'S METADATA IS READ-ONLY. Keywords, description, name and
// subtitle belong to a version, and once it is on sale Apple locks them — the
// API returns 409 rather than a message a person would understand. These are
// the states in which a write is actually accepted.
const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED',
  'METADATA_REJECTED', 'WAITING_FOR_REVIEW', 'INVALID_BINARY'
])

async function localization (versionId) {
  const r = await call('GET', `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=20`)
  return r.data.find(l => l.attributes.locale === 'en-US') || r.data[0]
}


/**
 * The appInfo that can actually be written to.
 *
 * ⚠️ NOT data[0]. Once a version is on sale there are TWO appInfos — the live
 * one and the one belonging to the next version — and the live one is first in
 * the list and read-only. Picking it produces "this age rating declaration is
 * not editable", which names the symptom and not the cause.
 */
async function editableAppInfo (appId) {
  const r = await call('GET', `/apps/${appId}/appInfos?limit=10`)
  const rows = r.data.map(i => ({ id: i.id, state: i.attributes.appStoreState || i.attributes.state }))
  const hit = rows.find(i => EDITABLE.has(i.state))
  if (!hit) throw new Error(`No editable app info — states: ${rows.map(r => r.state).join(', ')}. Create the next version first.`)
  return hit
}

const cmd = process.argv[2]
const appId = process.argv[3]
const value = process.argv[4]

try {
  if (cmd === 'whoami') {
    const r = await call('GET', '/apps?limit=20&fields[apps]=name,bundleId,sku')
    for (const a of r.data) console.log(`  ${a.id}  ${a.attributes.name}  (${a.attributes.bundleId})`)
  } else if (cmd === 'get') {
    const vs = await versions(appId)
    console.log('versions:')
    for (const v of vs) console.log(`  ${v.version}  ${v.state}${EDITABLE.has(v.state) ? '  ← editable' : ''}`)
    const loc = await localization(vs[0].id)
    const a = loc.attributes
    console.log(`\nlisting (${a.locale}) on ${vs[0].version}:`)
    for (const k of ['keywords', 'promotionalText', 'description', 'whatsNew', 'marketingUrl', 'supportUrl']) {
      const v = a[k]
      const shown = v == null || v === '' ? '(empty)' : (k === 'description' ? `${String(v).length} chars` : v)
      console.log(`  ${k.padEnd(16)} ${shown}`)
    }
  } else if (cmd === 'set-promo' || cmd === 'set-keywords' || cmd === 'set-whatsnew') {
    // ⚠️ A NEW VERSION DOES NOT INHERIT PROMOTIONAL TEXT. It came up empty on
    // 1.1 while 1.0 still had it, so anything not re-set is silently dropped
    // the moment the new version ships.
    const field = cmd === 'set-promo' ? 'promotionalText' : cmd === 'set-keywords' ? 'keywords' : 'whatsNew'
    const limit = cmd === 'set-promo' ? 170 : cmd === 'set-keywords' ? 100 : 4000
    if (value == null) throw new Error(`Give the text: node scripts/asc.mjs ${cmd} <appId> "<text>"`)
    if (value.length > limit) throw new Error(`${field} is ${value.length} characters; Apple's limit is ${limit}.`)
    const vs = await versions(appId)
    const target = cmd === 'set-promo' ? vs[0] : vs.find(v => EDITABLE.has(v.state))
    if (!target) {
      throw new Error(`No editable version. Keywords belong to a version and the live one is locked (${vs[0].version} is ${vs[0].state}). Create the next version first, then run this again.`)
    }
    const loc = await localization(target.id)
    const before = loc.attributes[field]
    await call('PATCH', `/appStoreVersionLocalizations/${loc.id}`, {
      data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { [field]: value } }
    })
    const after = (await localization(target.id)).attributes[field]
    console.log(`${field} on ${target.version} (${target.state})`)
    console.log(`  was: ${before || '(empty)'}`)
    console.log(`  now: ${after || '(empty)'}`)
    // ⚠️ READ IT BACK. A 204 means Apple accepted the request, not that the
    // field holds what you sent.
    if (after !== value) throw new Error('Apple accepted the write but the field does not match what was sent.')
  } else if (cmd === 'set-age') {
    // ⚠️ THE OVERRIDE, NOT THE CONTENT ANSWERS. The questionnaire rows are
    // accurate and were argued for in docs/APP_STORE_LISTING.md; changing them
    // to move the rating would be falsifying a declaration, which is guideline
    // 2.3. The override exists precisely so a developer can say "rate this
    // higher than my answers imply" — raising it is always safe, lowering it
    // never is.
    const info = await editableAppInfo(appId)
    const id = info.id
    const field = process.argv[5] === 'v1' ? 'ageRatingOverride' : 'ageRatingOverrideV2'
    console.log(`editing app info ${id} (${info.state})`)
    const before = (await call('GET', `/appInfos/${id}/ageRatingDeclaration`)).data.attributes
    await call('PATCH', `/ageRatingDeclarations/${id}`, {
      data: { type: 'ageRatingDeclarations', id, attributes: { [field]: value } }
    })
    const after = (await call('GET', `/appInfos/${id}/ageRatingDeclaration`)).data.attributes
    console.log(`${field}`)
    console.log(`  was: ${before[field] ?? '(unset)'}`)
    console.log(`  now: ${after[field] ?? '(unset)'}`)
    if (after[field] !== value) throw new Error('Apple accepted the write but the field does not match.')
  } else if (cmd === 'get-desc' || cmd === 'set-desc') {
    // ⚠️ THROUGH A FILE, NOT AN ARGUMENT. A 4,000-character description with
    // apostrophes and em dashes does not survive a shell, and the failure is
    // silent mangling rather than an error.
    const vs = await versions(appId)
    const target = cmd === 'set-desc' ? vs.find(v => EDITABLE.has(v.state)) : vs[0]
    if (!target) throw new Error(`No editable version (${vs[0].version} is ${vs[0].state}).`)
    const loc = await localization(target.id)
    if (cmd === 'get-desc') { fs.writeFileSync(value, loc.attributes.description || ''); console.log(`wrote ${loc.attributes.description?.length || 0} chars from ${target.version} to ${value}`); }
    else {
      const text = fs.readFileSync(value, 'utf8')
      if (text.length > 4000) throw new Error(`description is ${text.length} characters; Apple's limit is 4000.`)
      await call('PATCH', `/appStoreVersionLocalizations/${loc.id}`, {
        data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { description: text } }
      })
      const after = (await localization(target.id)).attributes.description
      console.log(`description on ${target.version}: ${loc.attributes.description?.length || 0} → ${after.length} chars`)
      if (after !== text) throw new Error('Apple accepted the write but the stored description differs.')
    }
  } else if (cmd === 'new-version') {
    // ⚠️ CREATES AN EDITABLE SLOT. NOTHING IS SUBMITTED. A version in
    // PREPARE_FOR_SUBMISSION is invisible to the store and can be deleted; it
    // is what unlocks keywords, description and the age rating, all of which
    // belong to a version and are read-only once one is on sale.
    if (!value) throw new Error('Give the version: node scripts/asc.mjs new-version <appId> 1.1')
    const existing = (await versions(appId)).find(v => v.version === value)
    if (existing) { console.log(`${value} already exists — ${existing.state}`); }
    else {
      await call('POST', '/appStoreVersions', {
        data: {
          type: 'appStoreVersions',
          attributes: { platform: 'IOS', versionString: value },
          relationships: { app: { data: { type: 'apps', id: appId } } }
        }
      })
      console.log(`created ${value}`)
    }
    for (const v of await versions(appId)) console.log(`  ${v.version}  ${v.state}${EDITABLE.has(v.state) ? '  ← editable' : ''}`)
  } else if (cmd === 'allbuilds') {
    const r = await call('GET', `/builds?filter[app]=${appId}&limit=50&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate,expired`)
    console.log('total returned:', r.data.length)
    for (const b of r.data) {
      const a = b.attributes
      console.log(`  ${a.version.padEnd(5)} ${a.processingState.padEnd(10)} expired=${a.expired}  ${(a.uploadedDate||'').slice(0,19)}`)
    }
  } else if (cmd === 'builds') {
    // ⚠️ NOT sort=-version. Apple sorts it as a STRING, so "8" comes above
    // "19" and the newest build vanishes off the bottom of the list. Sort by
    // upload date, which is what "newest" actually means here.
    const r = await call('GET', `/builds?filter[app]=${appId}&limit=8&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate,expired`)
    for (const b of r.data) {
      const a = b.attributes
      console.log(`  build ${a.version.padEnd(4)} ${a.processingState.padEnd(10)} uploaded ${(a.uploadedDate||'').slice(0,19)}  id=${b.id}`)
    }
  } else if (cmd === 'attach') {
    // ⚠️ THE BUILD MUST BE VALID FIRST. Attaching one that is still PROCESSING
    // fails in a way that reads like the build does not exist.
    const version = process.argv[5]
    if (!value || !version) throw new Error('node scripts/asc.mjs attach <appId> <versionString> <buildNumber>')
    const vs = await versions(appId)
    const target = vs.find(v => v.version === value)
    if (!target) throw new Error(`No version ${value}`)
    const r = await call('GET', `/builds?filter[app]=${appId}&filter[version]=${version}&limit=1`)
    const build = r.data[0]
    if (!build) throw new Error(`No build ${version} found for this app`)
    if (build.attributes.processingState !== 'VALID') throw new Error(`Build ${version} is ${build.attributes.processingState}, not VALID yet.`)
    await call('PATCH', `/appStoreVersions/${target.id}`, {
      data: { type: 'appStoreVersions', id: target.id, relationships: { build: { data: { type: 'builds', id: build.id } } } }
    })
    const back = await call('GET', `/appStoreVersions/${target.id}/build?fields[builds]=version`)
    console.log(`attached build ${back.data.attributes.version} to ${value}`)
    if (back.data.attributes.version !== version) throw new Error('Apple accepted the write but a different build is attached.')
  } else if (cmd === 'infos') {
    const r = await call('GET', `/apps/${appId}/appInfos?limit=10`)
    for (const i of r.data) {
      const a = i.attributes
      console.log(`  ${i.id}  state=${a.appStoreState || a.state}  age=${a.appStoreAgeRating || '-'}`)
    }
  } else if (cmd === 'age') {
    // The declaration hangs off a version, not the app.
    const vs = await versions(appId)
    const v = vs[0]
    // ⚠️ WHERE THIS LIVES MOVED. It used to hang off the version; Apple's
    // newer model puts it on the app-level appInfo, and the version
    // relationship 404s with "the relationship does not exist".
    const infos = await call('GET', `/apps/${appId}/appInfos?limit=10`)
    const info = infos.data[0]
    const r = await call('GET', `/appInfos/${info.id}/ageRatingDeclaration`)
    console.log('appInfo:', info.id, '| state:', info.attributes?.appStoreState || info.attributes?.state)
    const a = r.data.attributes
    console.log(`age rating declaration id ${r.data.id} (version ${v.version} is ${v.state}):`)
    for (const [k, val] of Object.entries(a)) {
      if (val === null || val === false || val === 'NONE') continue
      console.log(`  ${k.padEnd(46)} ${val}`)
    }
    console.log('\n  (fields at NONE/false/null hidden — full set:)')
    console.log('  ' + Object.keys(a).join('\n  '))
  } else {
    console.log('commands: whoami | get <appId> | age <appId> | set-promo <appId> "<text>" | set-keywords <appId> "<kw>"')
  }
} catch (e) {
  console.error('\n' + e.message + '\n')
  process.exit(1)
}
