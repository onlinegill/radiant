// SSR smoke test: renders every Settings tab with async state still null
// (the exact condition of first paint in the standalone Settings window).
// Catches render crashes — undeclared variables, null derefs — before they
// ship as white screens / dead tabs. Run: node scripts/test-settings-render.mjs
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const dir = mkdtempSync(join(tmpdir(), 'settings-render-'))
const bundle = join(dir, 'settings.cjs')
try {
  execFileSync('npx', ['esbuild', 'src/components/Settings.jsx', '--bundle',
    '--platform=node', '--format=cjs', '--external:react', '--external:react-dom',
    `--outfile=${bundle}`, '--log-level=error'], { cwd: process.cwd() })

  // resolve react from this repo even though the bundle lives in /tmp
  const Module = require('node:module')
  const origResolve = Module._resolveFilename
  Module._resolveFilename = function (req, ...rest) {
    if (req === 'react' || req === 'react-dom/server') {
      return origResolve.call(this, req, { ...rest[0], paths: [join(process.cwd(), 'node_modules')] }, ...rest.slice(1))
    }
    return origResolve.call(this, req, ...rest)
  }

  const React = require('react')
  const { renderToString } = require('react-dom/server')
  globalThis.window = {}
  try { Object.defineProperty(globalThis, 'navigator', { value: { clipboard: null }, configurable: true }) } catch {}
  const Settings = require(bundle).default

  const config = {
    platform: 'win32', serverHost: '', settings: { theme: 'dark' },
    providers: [], credentials: {}, agents: [], skills: [], mcpServers: []
  }
  const noop = () => {}
  const tabs = ['guide', 'providers', 'models', 'agents', 'skills', 'mcp',
    'memory', 'devices', 'appearance', 'chrome', 'voice', 'agent', 'about']
  let failures = 0
  const render = (tab, plat) => {
    const c = plat ? { ...config, platform: plat } : config
    renderToString(React.createElement(Settings, {
      config: c, initialTab: tab, embedded: true,
      onSettings: noop, onConfigChange: noop, onModelsChanged: noop, onClose: noop
    }))
  }
  for (const tab of tabs) {
    try { render(tab); console.log('  ok  ', tab) }
    catch (e) { failures++; console.log('  FAIL', tab, '-', e.constructor.name + ':', String(e.message).split('\n')[0]) }
  }
  for (const plat of ['darwin', 'linux']) {
    try { render('agent', plat); console.log('  ok  ', 'agent@' + plat) }
    catch (e) { failures++; console.log('  FAIL', 'agent@' + plat, '-', String(e.message).split('\n')[0]) }
  }
  console.log(failures ? `\n${failures} tab(s) crash on first render` : '\nall settings tabs render on first paint')
  process.exit(failures ? 1 : 0)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
