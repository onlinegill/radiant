/**
 * What this machine is, and where its things are.
 *
 * ⚠️ THE POINT OF THIS FILE IS THAT IT IS THE ONLY ONE THAT ASKS. Before it,
 * Radiant contained exactly ONE `process.platform` check in the whole tree —
 * the app menu in `electron/updater.cjs`. Everything else named macOS
 * unconditionally: `open`, `screencapture`, `sips`, `osascript`, `sw_vers`,
 * `scutil`, `/Applications/Google Chrome.app`. That is not a codebase that
 * happens to be Mac-only; it is a codebase with nowhere to put anything else.
 *
 * So this module adds no features and changes no behavior on a Mac. Every
 * function below returns exactly what the hardcoded value used to be when
 * `process.platform === 'darwin'`. What it adds is a seam: one place that
 * knows, so the next platform is a case in a switch rather than a rewrite.
 *
 * ⚠️ DERIVE, DO NOT SHELL OUT, WHEN THE ANSWER IS ON DISK. Same lesson as
 * `refreshRemoteUrl()` in index.js — a detector that shells out to a binary
 * that is not where you guessed reports "no" when the answer is "yes". The
 * Chrome and Tailscale lookups here walk real paths and check the executable
 * bit; they never ask a shell where something is.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

export const IS_MAC = process.platform === 'darwin'
export const IS_LINUX = process.platform === 'linux'
export const IS_WINDOWS = process.platform === 'win32'

/**
 * The word the UI uses for the machine Radiant is running on.
 *
 * Roughly 250 user-visible strings say "Mac" — "on this Mac", "your other
 * Macs", "transcribed on this Mac". They are correct today and must stay
 * correct; this is what they become when the answer is not always "Mac".
 */
export function deviceNoun () {
  if (IS_MAC) return 'Mac'
  if (IS_WINDOWS) return 'PC'
  return 'computer'
}

/**
 * The shell the AGENT's run_command speaks — [binary, argsPrefix].
 *
 * bash is hardcoded in three spawners (tools.js newJob/runShell, index.js
 * runCheckCommand). There is no bash on a stock Windows PC, so on win32 the
 * agent gets PowerShell instead — and the tool description must say so, or
 * the model keeps emitting `ls -la ~ | head -50` and it dies on spawn.
 * powershell.exe (5.1) ships with every Windows 10/11; pwsh 7 may not exist.
 */
export function agentShell (command) {
  if (IS_WINDOWS) return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]]
  return ['bash', ['-lc', command]]
}

/** The word the run_command tool description uses for the shell. */
export function agentShellNoun () {
  return IS_WINDOWS ? 'PowerShell' : 'bash'
}

/**
 * Spawn spec for "a command typed the way a terminal would take it".
 *
 * MCP servers configured with a shell-shaped command (`PATH=… npx -y x`, a
 * pipe) are handed to a shell rather than looked up as an executable — and
 * `bash -lc` does not exist on Windows, so on win32 the line goes through
 * cmd.exe instead. Same idea as agentShell(), for spawners that are not the
 * agent's own run_command.
 */
export function shellSpawn (line) {
  if (IS_WINDOWS) return { command: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', line] }
  return { command: defaultShell(), args: ['-lc', line] }
}

/**
 * Resolve a bare command word to something CreateProcess can actually run.
 *
 * On Windows the npm-shim world is `npx.cmd`, `npm.cmd` — spawning the bare
 * name without shell:true dies with ENOENT, which is how every stdio MCP
 * server configured as `npx -y …` failed to connect with an opaque error.
 * where.exe finds the real file (libuv runs .cmd/.bat through cmd.exe
 * itself, so the resolved path spawns fine). Non-Windows: returned unchanged.
 */
export function resolveCommand (command) {
  if (!IS_WINDOWS || !command || typeof command !== 'string') return command
  if (/[\\/]/.test(command)) return command // already a path — leave it alone
  try {
    const hit = execFileSync('where.exe', [command], { timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] })
      .toString().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      .find(p => /\.(cmd|bat|exe|com)$/i.test(p))
    if (hit) return hit
  } catch {}
  return command
}

/**
 * How to hand a path to the desktop's file manager.
 *
 * `open` is macOS-only. On Linux `xdg-open` is the freedesktop.org standard and
 * is present on every desktop that has a file manager at all; if it is missing,
 * there is no sane fallback and the caller should report the failure rather
 * than guess at nautilus/dolphin/thunar.
 */
export function openCommand () {
  if (IS_MAC) return 'open'
  if (IS_WINDOWS) return 'explorer'
  return 'xdg-open'
}

/** Directories worth searching for a binary, in the order they should win. */
function binDirs () {
  const home = os.homedir()
  const fromPath = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  return [
    ...fromPath,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/snap/bin',
    path.join(home, '.local', 'bin')
  ]
}

/** First path in `candidates` that exists and is executable, or null. */
export function firstExecutable (candidates) {
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); return c } catch { /* next */ }
  }
  return null
}

/** First of `names` found on PATH (and the usual extra dirs), or null. */
export function onPath (names) {
  const dirs = binDirs()
  for (const name of names) {
    const hit = firstExecutable(dirs.map(d => path.join(d, name)))
    if (hit) return hit
  }
  return null
}

/**
 * The Chrome that Radiant drives, or null when there is none.
 *
 * ⚠️ THIS RETURNING null IS A REAL ANSWER, NOT AN ERROR. The caller used to
 * test `fs.existsSync('/Applications/Google Chrome.app/…')`, which off a Mac is
 * false forever — so "enable browser control" was a button that could only ever
 * fail, with a message ("Google Chrome is not installed.") that was wrong about
 * why. A null here means say so honestly and offer the extension bridge, which
 * is platform-neutral and already ships.
 *
 * Chromium counts. It takes the same `--remote-debugging-port` and
 * `--user-data-dir` flags, which is all the CDP path uses.
 */
export function chromeBinary () {
  if (IS_MAC) {
    return firstExecutable([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
    ])
  }
  if (IS_WINDOWS) {
    const bases = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
    return firstExecutable(bases.map(b => path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe')))
  }
  return onPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'])
}

/** The `tailscale` CLI, or null. Best effort — nothing depends on finding it. */
export function tailscaleBinary () {
  const extra = IS_MAC ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'] : []
  return firstExecutable(extra) || onPath(['tailscale'])
}

/**
 * The login shell for the terminal panel.
 *
 * `$SHELL` is set in every session that has one; the fallback only matters when
 * it is not, and then guessing zsh off a Mac is guessing wrong.
 */
export function defaultShell () {
  if (process.env.SHELL) return process.env.SHELL
  if (IS_WINDOWS) return process.env.COMSPEC || 'cmd.exe'
  return IS_MAC ? '/bin/zsh' : '/bin/bash'
}

/**
 * The environment a person's terminal has — PATH above all — for processes
 * that must find the same `node`, `npx`, `uvx` or `python` the person does.
 *
 * ⚠️ A GUI APP INHERITS launchd's PATH, NOT THE SHELL'S. /usr/bin:/bin and
 * little else. An MCP server configured as `npx -y some-server` failed with
 * ENOENT on a Mac where npx sits in ~/.nvm or /opt/homebrew, and the person
 * tried `PATH=/where/node npx …` as the command — which then fails too,
 * because the spawner looked for an executable named "PATH=…". iandouglas,
 * issue #15. The login shell is asked once, on first use, for what it would
 * give a terminal; a shell that fails to answer within two seconds leaves the
 * app's own environment untouched rather than blocking startup.
 */
let loginEnvCache = null
export function loginEnv () {
  if (loginEnvCache) return loginEnvCache
  let path = ''
  if (!IS_WINDOWS) {
    try {
      path = execFileSync(defaultShell(), ['-ilc', 'echo __RADIANT_PATH__=$PATH'], { timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().split('\n').map(l => l.trim()).filter(l => l.startsWith('__RADIANT_PATH__=')).pop()?.slice('__RADIANT_PATH__='.length) || ''
    } catch { path = '' }
  }
  const merged = [...new Set([...(path ? path.split(':') : []), ...(process.env.PATH || '').split(':')].filter(Boolean))].join(':')
  loginEnvCache = { ...process.env, PATH: merged }
  return loginEnvCache
}

/** Trim and return stdout, or '' when the command is missing or fails. */
function quietly (bin, args) {
  try { return execFileSync(bin, args, { timeout: 2000 }).toString().trim() } catch { return '' }
}

/**
 * The processor's marketing name — "Apple M2 Pro", "AMD Ryzen 7 5800X".
 *
 * Used by the Models screen to answer "will this fit". `os.cpus()[0].model` is
 * the floor and is never empty; the platform lookups only sharpen it.
 */
export function cpuName () {
  const fallback = os.cpus()[0]?.model || 'Unknown CPU'
  if (IS_MAC) return quietly('sysctl', ['-n', 'machdep.cpu.brand_string']) || fallback
  if (IS_LINUX) {
    try {
      const line = fs.readFileSync('/proc/cpuinfo', 'utf8').split('\n').find(l => /^model name\s*:/.test(l))
      if (line) return line.split(':').slice(1).join(':').trim()
    } catch { /* fall through */ }
  }
  return fallback
}

/**
 * A human OS version — "15.6", "Ubuntu 24.04.1 LTS".
 *
 * ⚠️ THE UI PREFIXES THIS WITH "macOS". Whoever renders it must ask
 * `deviceNoun()`/`IS_MAC` too, or a Linux box reads "macOS Ubuntu 24.04".
 */
export function osVersion () {
  if (IS_MAC) return quietly('sw_vers', ['-productVersion'])
  if (IS_LINUX) {
    try {
      const rel = fs.readFileSync('/etc/os-release', 'utf8')
      const m = rel.match(/^PRETTY_NAME="?([^"\n]+)"?/m)
      if (m) return m[1]
    } catch { /* fall through */ }
  }
  return os.release()
}

/**
 * The name the user gave this machine, as it should appear in the Devices pane.
 *
 * `os.hostname()` is the floor. On a Mac it comes back as "dev-mbp.local" and
 * the suffix is noise, which is why the caller trimmed it; `scutil` gives the
 * real Sharing name when it can be reached.
 */
export function computerName () {
  const bare = os.hostname().replace(/\.local$/, '')
  if (IS_MAC) return quietly('scutil', ['--get', 'ComputerName']) || bare
  if (IS_LINUX) return quietly('hostnamectl', ['--static']) || bare
  return bare
}

/**
 * Sync folders are deliberately NOT here.
 *
 * `/api/sync-targets` in index.js reasons at length about why iCloud is offered
 * without being verified, and about two separate wrong guesses a stat call made
 * on Tony's machines. That reasoning belongs next to the code it defends, and
 * lifting it into a helper would restate it badly. The call site takes an
 * `IS_MAC` guard and grows a Linux branch of its own instead.
 */
