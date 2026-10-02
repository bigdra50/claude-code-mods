import { describe, expect, test } from 'claude-code/testing'

import { attachment, describeAttachment, parsePs } from '../hooks/attach'
import { browserReport, shotName, slug } from '../hooks/register'

const SHARED = '/Users/me/Library/Caches/ms-playwright-mcp/mcp-chrome-265f254'
// Two Claude processes: 100 (us) and 200 (another). Each has a Playwright server.
const ps = (chromeUnder: number, isolated = false) =>
  [
    '100 1 claude',
    '101 100 npm exec @playwright/mcp@latest',
    `102 101 node /x/.bin/playwright-mcp${isolated ? ' --isolated' : ''}`,
    '200 1 claude',
    '201 200 npm exec @playwright/mcp@latest',
    '202 201 node /x/.bin/playwright-mcp',
    `300 ${chromeUnder} /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --no-first-run --user-data-dir=${SHARED} about:blank`,
    '301 300 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (GPU).app/Contents/MacOS/Google Chrome Helper --type=gpu',
  ].join('\n')

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } }

// Stands for the engine beneath the mod: records what the browser tools were called with.
function engine(on: any, other?: object) {
  const ran: any[] = []
  const toasts: string[] = []
  const store = new Map<string, unknown>(other ? [['driver', other]] : [])
  on('tool.call', (_$: any, e: any) => (ran.push(e), { result: {}, text: 'ok' }))
  on('session.id', () => ({ value: 'this-session-id' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', (_$: any, e: any) => {
    const [cmd] = e.argv as string[]
    const stdout = cmd === 'sh' ? '100\n' : cmd === 'ps' ? ps(102) : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  return { ran, toasts }
}

const PW = 'mcp__plugin_playwright_playwright__browser_'

describe('browser-lanes', () => {
  test('helpers', () => {
    expect(slug('Login flow test!')).toBe('login-flow-test')
    expect(shotName('login-test', 3)).toBe('login-test-03.png')
    expect(shotName('main', 1, 'shots/home.png')).toBe('shots/main-home.png')
    expect(shotName('main', 1, 'main-home.png')).toBe('main-home.png')
  })

  test('screenshots are named by who took them; the band shows the driver', async ($, on) => {
    const { ran } = engine(on)
    await $.tool.call({ tool: `${PW}navigate`, url: 'https://example.com' } as any)
    await $.tool.call({ tool: `${PW}take_screenshot`, type: 'png', scale: 'css' } as any)
    await $.tool.call({ tool: `${PW}take_screenshot`, filename: 'home.png', scale: 'css' } as any)
    expect(ran[1].filename).toBe('main-01.png')
    expect(ran[2].filename).toBe('main-home.png')

    const ui = await $.ui.mount({ plugin: 'browser-lanes', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /attached · this session's Chrome · shared profile/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /driving: main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await ui.unmount()
  })

  test('closing the browser frees the lane', async ($, on) => {
    engine(on)
    await $.tool.call({ tool: `${PW}navigate`, url: 'https://example.com' } as any)
    await $.tool.call({ tool: `${PW}close` } as any)
    const ui = await $.ui.mount({ plugin: 'browser-lanes', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /driving:/ })).toBeUndefined()
    await ui.unmount()
  })

  test('another session that just used the browser gets a warning', async ($, on) => {
    const { toasts } = engine(on, { session: 'other-session-xyz', label: 'main', at: Date.now() - 5_000 })
    await $.tool.call({ tool: `${PW}navigate`, url: 'https://example.com' } as any)
    expect(toasts[0]).toMatch(/another Claude session \(other-se, main\) used the browser 5s ago/)
  })

  test('attachment: ours, blocked by another Claude, ready, none', () => {
    const procs = (under: number, iso = false) => parsePs(ps(under, iso))
    expect(attachment(procs(102), 100).state).toBe('attached')
    const blocked = attachment(procs(202), 100, '/Users/me/developer/web', new Map([[200, '/Users/me/developer/web']]))
    expect(blocked.state).toBe('blocked')
    expect(blocked.holder?.claudePid).toBe(200)
    expect(describeAttachment(blocked)).toBe('NOT attached · another Claude (pid 200 in developer/web) holds the shared profile')
    expect(browserReport(blocked)).toMatch(/--isolated/)
    expect(attachment(procs(202), 100, '/Users/me/other', new Map([[200, '/Users/me/developer/web']])).state).toBe('ready') // another folder's profile
    expect(attachment(procs(202, true), 100).state).toBe('ready') // isolated: its own profile, no clash
    expect(attachment(procs(102), 999).state).toBe('none')
  })

  test('/browser explains', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r = await $.command.run({ command: 'browser', args: '' } as any)
    expect(r.text).toMatch(/^Browser: attached/)
  })

  test('other tools pass straight through', async ($, on) => {
    const { ran } = engine(on)
    await $.tool.call({ tool: 'Read', file_path: '/a' } as any)
    expect(ran).toHaveLength(1)
  })
})
