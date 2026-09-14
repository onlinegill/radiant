/**
 * Permission to send chat content to a cloud provider — asked once, per
 * provider, before anything leaves the phone.
 *
 * ⚠️ APPLE 5.1.1(i) / 5.1.2(i), 2026-09-14: "the app appears to share the
 * user's personal data with a third-party AI service but the app does not
 * clearly explain what data is sent, identify who the data is sent to, and ask
 * the user's permission before sharing the data." The privacy policy said it;
 * the app did not, and Apple's note is explicit that the policy alone is not
 * sufficient. So this is the record of the person's answer, and every path
 * that can send a message to a provider checks it first.
 *
 * Kept in localStorage: it is a preference, not a secret, and the phone keeps
 * its keys in the Keychain and its settings here already.
 */
const KEY = 'radiant.phone.cloudConsent'

function read () {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

/** ISO date the person allowed this provider, or null. */
export function consentFor (providerId) {
  const at = read()[providerId]
  return typeof at === 'string' ? at : null
}

export function hasConsent (providerId) { return Boolean(consentFor(providerId)) }

export function grantConsent (providerId) {
  const v = read(); v[providerId] = new Date().toISOString()
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch {}
}

export function revokeConsent (providerId) {
  const v = read(); delete v[providerId]
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch {}
}

/** Host shown to the person, from the provider's base URL. */
export function providerHost (provider) {
  try { return new URL(provider.baseUrl).host } catch { return provider.baseUrl }
}
