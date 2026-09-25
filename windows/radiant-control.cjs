#!/usr/bin/env node
/**
 * Radiant desktop control helper for Windows — the Win32 counterpart to
 * native/RadiantControl.swift (macOS) and gnome/radiant-control.cjs (Linux),
 * speaking the same command language so server/computer.js does not have to
 * care which one it is talking to.
 *
 * `screensize`, `move`, `click`, `doubleclick`, `rightclick`, `drag`, `scroll`,
 * `type`, `key` and `permissions` behave exactly as the other helpers' do.
 * The macOS-only commands (`dictate`, the iCloud commands) are absent on
 * purpose: they ask Apple frameworks about services this platform does not
 * have, and answering them with a guess would be worse than not answering.
 *
 * ⚠️ THIS IS A SCRIPT, NOT A COMPILED BINARY, AND THAT IS THE POINT. The macOS
 * helper has to be Mach-O because CGEvent and Speech are Apple frameworks. Here
 * the whole job is driving user32 and System.Windows.Forms through the copy of
 * Windows PowerShell that ships with every Windows 10/11, so a compiled
 * artefact would buy nothing and cost a toolchain, a build step in `dist`, and
 * one more thing that can ship for the wrong architecture.
 *
 * ⚠️ PHYSICAL PIXELS EVERYWHERE, ON PURPOSE. screensize reports the virtual
 * screen's physical pixel bounds and screenshot captures those same pixels, so
 * the image the model sees and the space its clicks are interpreted in agree
 * 1:1 with no DPI scaling step to get wrong — the same rule the Linux helper
 * carries about the X root window.
 *
 * ⚠️ ONE powershell.exe PER COMMAND. Startup costs a few hundred milliseconds,
 * the same order as the Linux helper's xdotool round-trips, and keeping each
 * command in its own process means a failure cannot poison the next one.
 */
'use strict'
const { execFileSync } = require('child_process')

const args = process.argv.slice(2)
const cmd = args[0]

const PS = 'powershell.exe'
// -STA: powershell.exe defaults to MTA, where System.Windows.Forms.Clipboard
// throws. The type command's paste path needs the clipboard, so every command
// runs single-threaded apartment; nothing else here cares either way.
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-Command']

function ps (script, timeout = 30000) {
  return execFileSync(PS, [...PS_ARGS, script], { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 }).trim()
}

function fail (message) {
  process.stderr.write(String(message) + '\n')
  process.exit(1)
}

/** Base64 the text so PowerShell never has to quote it. */
function b64 (s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
}
const decodeB64 = b => `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b}'))`

const WINFORMS = `Add-Type -AssemblyName System.Windows.Forms, System.Drawing;`

const MOUSE_CS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RMouse {
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@;`

/**
 * SendKeys cannot emit the Windows key, so Win combinations go through
 * keybd_event: VK_LWIN down, the SendKeys chord, VK_LWIN up in a finally so a
 * failure can never leave the Windows key stuck down.
 */
const WINKEY_CS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RKey {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@;`
const VK_LWIN = 91
const KEYEVENTF_KEYUP = 2

/**
 * ⚠️ cmd MEANS "THE COPY MODIFIER", NOT "THE WINDOWS KEY". A model that has been
 * told it is driving a desktop emits "cmd+c" for copy, and mapping cmd to Win
 * literally would send Win+C — which on Windows opens the widgets board. Ctrl is
 * what the user's own hands would press for the same intent, so that is the
 * honest translation, matching the Linux helper.
 *
 * ⚠️ super/win/windows MEANS THE REAL WINDOWS KEY, NOT NOTHING. SendKeys cannot
 * emit the Windows key at all, so the modifier used to be mapped to the empty
 * string — which silently turned "win+l" into "l" and reported success. That is
 * the exact lie this file refuses to tell anywhere else. The Windows key now
 * goes through keybd_event (VK_LWIN held across the SendKeys call, released in
 * a finally), matching the Linux helper, where super is a real key xdotool
 * presses. If keybd_event ever fails, the finally still releases the key.
 */
const MODIFIERS = {
  cmd: '^', command: '^', meta: '^',
  ctrl: '^', control: '^',
  shift: '+',
  alt: '%', option: '%', opt: '%',
  super: 'WIN', win: 'WIN', windows: 'WIN'
}

/** Names the other helpers accept, in the spelling SendKeys wants. */
const KEYS = {
  return: '{ENTER}', enter: '{ENTER}',
  tab: '{TAB}',
  space: ' ',
  delete: '{BACKSPACE}', backspace: '{BACKSPACE}',
  forwarddelete: '{DELETE}', del: '{DELETE}',
  escape: '{ESC}', esc: '{ESC}',
  left: '{LEFT}', right: '{RIGHT}', up: '{UP}', down: '{DOWN}',
  home: '{HOME}', end: '{END}',
  pageup: '{PGUP}', pagedown: '{PGDN}',
  insert: '{INSERT}',
  printscreen: '{PRTSC}'
}

/**
 * ⚠️ A MODIFIER WE DO NOT KNOW IS A REFUSAL, NOT A SHRUG — the same gate the
 * Linux helper carries. A bad translation presses the wrong keys, exits 0, and
 * reports success to the model. That is the only thing in this file that can be
 * wrong in silence, which is exactly why it must not be.
 *
 * Returns { sendKeys, win }: the SendKeys string for everything SendKeys can
 * express, and whether the Windows key must be held across it via keybd_event.
 */
function sendKeysFor (spec) {
  const parts = String(spec == null ? '' : spec).split('+').map(s => s.trim())
  if (parts.length === 0 || parts.some(p => !p)) {
    throw new Error(`"${spec}" is not a key combination Radiant can press.`)
  }
  const key = parts.pop()
  let mods = ''
  let win = false
  for (const m of parts) {
    const mapped = MODIFIERS[m.toLowerCase()]
    if (mapped === undefined) throw new Error(`"${m}" is not a modifier Radiant knows how to press on this desktop.`)
    if (mapped === 'WIN') { win = true; continue }
    mods += mapped
  }
  const low = key.toLowerCase()
  // the Windows key on its own (opens Start), alone or held with other modifiers
  if (low === 'win' || low === 'super' || low === 'windows') {
    return { sendKeys: mods, win: true }
  }
  const named = KEYS[low] || (/^f([1-9]|1[0-9]|2[0-4])$/.test(low) ? `{${low.toUpperCase()}}` : null)
  if (!named) {
    if (key.length !== 1) throw new Error(`"${key}" is not a key Radiant knows how to press on this desktop.`)
    return { sendKeys: mods + escapeSendKeys(key), win }
  }
  return { sendKeys: mods + named, win }
}

/** Escape SendKeys' own metacharacters: + ^ % ~ ( ) { } [ ] */
function escapeSendKeys (text) {
  return text.replace(/([+^%~(){}\[\]])/g, '{$1}').replace(/\r\n|\r|\n/g, '{ENTER}').replace(/\t/g, '{TAB}')
}

module.exports = { sendKeysFor }
if (require.main !== module) return

switch (cmd) {
  /**
   * ⚠️ ASK THE SYSTEM, DO NOT ASSUME. Windows puts no TCC-style gate in front
   * of these APIs: when powershell.exe runs, the calls below work. Reporting
   * "not granted" here would be the lie the macOS status poll used to tell in
   * the other direction.
   */
  case 'permissions': {
    process.stdout.write(JSON.stringify({ screenRecording: true, accessibility: true }))
    break
  }

  /**
   * The whole virtual screen (all monitors), in physical pixels — the same
   * pixels `screenshot` captures, so the mapping cannot drift by one monitor.
   */
  case 'screensize': {
    const out = ps(`${WINFORMS}
      $v = [System.Windows.Forms.SystemInformation]::VirtualScreen;
      "$($v.Width) $($v.Height)"`)
    if (!/^\d+ \d+$/.test(out)) fail('Could not determine the screen size.')
    process.stdout.write(out)
    break
  }

  case 'screenshot': {
    const dest = args[1]
    if (!dest) fail('screenshot needs an output path.')
    const destB64 = b64(dest)
    ps(`${WINFORMS}
      $v = [System.Windows.Forms.SystemInformation]::VirtualScreen;
      $bmp = New-Object System.Drawing.Bitmap($v.Width, $v.Height);
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen($v.X, $v.Y, 0, 0, $v.Size);
      $bmp.Save(${decodeB64(destB64)}, [System.Drawing.Imaging.ImageFormat]::Png);
      $g.Dispose(); $bmp.Dispose();`)
    break
  }

  case 'move': {
    const x = Number(args[1]); const y = Number(args[2])
    if (!Number.isFinite(x) || !Number.isFinite(y)) fail('move needs x and y.')
    ps(`${WINFORMS}[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`)
    break
  }

  case 'click':
  case 'rightclick':
  case 'doubleclick': {
    const x = Number(args[1]); const y = Number(args[2])
    if (!Number.isFinite(x) || !Number.isFinite(y)) fail(`${cmd} needs x and y.`)
    const down = cmd === 'rightclick' ? '0x0008' : '0x0002'
    const up = cmd === 'rightclick' ? '0x0010' : '0x0004'
    const taps = cmd === 'doubleclick'
      ? `[RMouse]::mouse_event(${down},0,0,0,0); [RMouse]::mouse_event(${up},0,0,0,0); Start-Sleep -Milliseconds 80;`
      : ''
    ps(`${WINFORMS}${MOUSE_CS}
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y});
      Start-Sleep -Milliseconds 30;
      ${taps}[RMouse]::mouse_event(${down},0,0,0,0);
      [RMouse]::mouse_event(${up},0,0,0,0);`)
    break
  }

  case 'drag': {
    const [x1, y1, x2, y2] = args.slice(1, 5).map(Number)
    if ([x1, y1, x2, y2].some(n => !Number.isFinite(n))) fail('drag needs x1 y1 x2 y2.')
    ps(`${WINFORMS}${MOUSE_CS}
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x1}, ${y1});
      Start-Sleep -Milliseconds 60;
      [RMouse]::mouse_event(0x0002,0,0,0,0);
      Start-Sleep -Milliseconds 60;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x2}, ${y2});
      Start-Sleep -Milliseconds 60;
      [RMouse]::mouse_event(0x0004,0,0,0,0);`)
    break
  }

  case 'scroll': {
    const x = Number(args[1]); const y = Number(args[2]); const dy = Number(args[3])
    if (!Number.isFinite(x) || !Number.isFinite(y)) fail('scroll needs x and y.')
    // ⚠️ NOT `dy || 0`-style truthiness: asking to scroll by nothing must move
    // nothing, and a non-number must not become a scroll. Positive dy is up,
    // matching the other helpers.
    if (!Number.isFinite(dy) || dy === 0) break
    const clicks = Math.min(50, Math.max(1, Math.round(Math.abs(dy) / 40)))
    const delta = (dy > 0 ? 1 : -1) * 120 * clicks
    ps(`${WINFORMS}${MOUSE_CS}
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y});
      [RMouse]::mouse_event(0x0800,0,0,${delta},0);`)
    break
  }

  case 'type': {
    // ⚠️ NOT THROUGH A SHELL, AND NOT SPLIT ON SPACES. The text is whatever the
    // model produced — quotes, backticks, newlines, a semicolon. It travels as
    // base64 inside the PowerShell script, which is the only reason this is safe
    // to hand a string that came out of a language model.
    const text = args.slice(1).join(' ')
    // ⚠️ A TIMEOUT THAT DOES NOT SCALE CUTS THE TEXT IN HALF — the same rule the
    // Linux helper carries. The half already typed is in the user's document,
    // where nothing can take it back.
    const budget = 30000 + text.length * 20
    const textB64 = b64(text)
    const script = `${WINFORMS}
      Add-Type -AssemblyName System.Windows.Forms;
      $text = ${decodeB64(textB64)};
      $wshell = New-Object -ComObject WScript.Shell;`
    // Short plain-ASCII text goes keystroke by keystroke; anything long or
    // non-ASCII goes through the clipboard and a paste, which is instant and
    // exact where SendKeys would be slow or lossy. The previous clipboard text
    // is saved and restored afterwards, so from the user's side the clipboard
    // only changes for the moment of the paste. (Only text is preserved: if
    // the clipboard held an image or files, those are replaced. The paste
    // itself is asynchronous, so a short sleep keeps the restore from racing
    // it — a heuristic, not a guarantee.)
    if (text.length <= 2000 && /^[\x20-\x7E\r\n\t]*$/.test(text)) {
      const keys = escapeSendKeys(text)
      const keysB64 = b64(keys)
      ps(`${script}$wshell.SendKeys(${decodeB64(keysB64)});`, budget)
    } else {
      ps(`${script}
        $prevText = $null; $hadText = $false
        try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $prevText = [System.Windows.Forms.Clipboard]::GetText(); $hadText = $true } } catch {}
        [System.Windows.Forms.Clipboard]::SetText($text);
        $wshell.SendKeys('^v');
        Start-Sleep -Milliseconds 400;
        try { if ($hadText) { [System.Windows.Forms.Clipboard]::SetText($prevText) } else { [System.Windows.Forms.Clipboard]::Clear() } } catch {}`, budget)
    }
    break
  }

  case 'key': {
    let press
    try {
      press = sendKeysFor(args[1])
    } catch (e) {
      fail(e.message)
    }
    const keysB64 = b64(press.sendKeys)
    let body = `$wshell.SendKeys(${decodeB64(keysB64)});`
    if (press.win) {
      body = `${WINKEY_CS}
        [RKey]::keybd_event(${VK_LWIN}, 0, 0, [UIntPtr]::Zero);
        try { ${body} } finally { [RKey]::keybd_event(${VK_LWIN}, 0, ${KEYEVENTF_KEYUP}, [UIntPtr]::Zero); }`
    }
    ps(`${WINFORMS}
      $wshell = New-Object -ComObject WScript.Shell;
      ${body}`)
    break
  }

  default:
    fail(`usage: radiant-control <permissions|screensize|screenshot|move|click|rightclick|doubleclick|drag|scroll|type|key> ...`)
}
