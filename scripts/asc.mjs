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
const KEY_ID = process.env.ASC_KEY_ID
const ISSUER = process.env.ASC_ISSUER_ID

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
    throw new Error('Set ASC_KEY_ID and ASC_ISSUER_ID (App Store Connect → Users and Access → Integrations).')
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
  } else if (cmd === 'set-promo' || cmd === 'set-keywords') {
    const field = cmd === 'set-promo' ? 'promotionalText' : 'keywords'
    const limit = cmd === 'set-promo' ? 170 : 100
    if (value == null) throw new Error(`Give the text: node scripts/asc.mjs ${cmd} <appId> "<text>"`)
    if (value.length > limit) throw new Error(`${field} is ${value.length} characters; Apple's limit is ${limit}.`)
    const vs = await versions(appId)
    const target = cmd === 'set-keywords' ? vs.find(v => EDITABLE.has(v.state)) : vs[0]
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
  } else {
    console.log('commands: whoami | get <appId> | set-promo <appId> "<text>" | set-keywords <appId> "<kw>"')
  }
} catch (e) {
  console.error('\n' + e.message + '\n')
  process.exit(1)
}
