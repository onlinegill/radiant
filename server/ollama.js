import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'

// macOS GUI apps (launched from Finder/Dock) don't inherit the shell PATH, so a
// bare `spawn('ollama')` fails with ENOENT even though `ollama` works in a
// terminal. Resolve the real binary and give spawned processes an augmented PATH.
const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', path.join(os.homedir(), '.local/bin')]

export const SPAWN_ENV = { ...process.env, PATH: [...EXTRA_DIRS, process.env.PATH || ''].filter(Boolean).join(':') }

// ⚠️ THE AGENT'S COMMANDS DO NOT GET THE SECRETS. A command the model runs —
// `env`, a script that prints its environment, a crash dump — would show every
// API key and token sitting in Radiant's own process environment, and that
// output goes straight back into the transcript and to the provider. Any
// variable whose NAME looks like a credential is dropped before the shell
// starts (the rule DeepSeek Harness ships, and the one we lacked). Radiant's
// own tools (Ollama, Hermes) keep SPAWN_ENV; only the model's shell gets this.
//
// Known limit, stated so nobody thinks it is airtight: run_command uses a
// login shell, so a key exported from ~/.zshrc comes back. This closes the
// path from Radiant's process; it cannot close the one from the user's profile.
// not AUTH: SSH_AUTH_SOCK is how git reaches the agent, and it holds no secret
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL/i
export function scrubbedEnv (env = SPAWN_ENV) {
  const out = {}
  for (const [k, v] of Object.entries(env)) if (!SECRET_NAME.test(k)) out[k] = v
  return out
}

// ⚠️ EVERY SPAWNED TOOL NEEDS THIS, NOT JUST OLLAMA. The Hermes relay called
// bare spawn('hermes') and died with ENOENT for every user who launched Radiant
// from the Dock, while working perfectly from a terminal — which is exactly how
// it got tested. Resolve through here, and pass SPAWN_ENV.
const cache = new Map()
export function resolveBin (name, envVar) {
  if (cache.has(name)) return cache.get(name)
  const set = v => { cache.set(name, v); return v }
  if (envVar && process.env[envVar] && fs.existsSync(process.env[envVar])) return set(process.env[envVar])
  for (const d of EXTRA_DIRS) { const p = path.join(d, name); if (fs.existsSync(p)) return set(p) }
  try {
    const p = execSync(`command -v ${name}`, { env: SPAWN_ENV, encoding: 'utf8' }).trim()
    if (p && fs.existsSync(p)) return set(p)
  } catch {}
  return set(name) // last resort; ENOENTs if genuinely not installed
}

export const ollamaBin = () => resolveBin('ollama', 'OLLAMA_BIN')
export const hermesBin = () => resolveBin('hermes', 'HERMES_BIN')
