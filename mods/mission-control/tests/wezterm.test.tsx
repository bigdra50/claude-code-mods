import { describe, expect, mock, test } from 'claude-code/testing'

import { wezTermSide } from '../hooks/register'

const PANE = { component: 'Pane', requestId: 'mission-control', props: { title: 'Mission Control', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } }
const WEZTERM = { TERM_PROGRAM: 'WezTerm', WEZTERM_PANE: '7', WEZTERM_EXECUTABLE_DIR: '/Applications/WezTerm.app/Contents/MacOS', TMPDIR: '/tmp/' }
const BIN = '/Applications/WezTerm.app/Contents/MacOS/wezterm'

// Stands for the engine beneath the mod, in a terminal whose variables are `env`.
function engine(on: any, env: Record<string, string>) {
  const runs: string[][] = []
  const alive = new Set<number>()
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  const clock = mock.clock(on)
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: true }))
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }))
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv
    runs.push(argv)
    if (argv[1] === 'cli' && argv[2] === 'split-pane') {
      alive.add(42)
      return { value: { exitCode: 0, stdout: '42\n', stderr: '' } }
    }
    if (argv[1] === 'cli' && argv[2] === 'list') {
      return { value: { exitCode: 0, stdout: JSON.stringify([...alive].map(pane_id => ({ pane_id }))), stderr: '' } }
    }
    if (argv[1] === 'cli' && argv[2] === 'kill-pane') {
      alive.delete(Number(argv[argv.indexOf('--pane-id') + 1]))
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [{ id: 'mission-control', title: 'Mission Control', isShown: true, isFocused: true, isPlaced: true }] }))
  const splits = () => runs.filter(a => a[2] === 'split-pane')
  const kills = () => runs.filter(a => a[2] === 'kill-pane')
  return { runs, clock, splits, kills }
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as any)
  await $.turn.start({ text: 'go', turnId: 't1' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' } as any)
}

describe('mission-control in WezTerm', () => {
  test('a WezTerm pane outside tmux gets the map in a side pane; anywhere else it does not', () => {
    expect(wezTermSide(WEZTERM)).toEqual({ pane: '7', bin: BIN })
    expect(wezTermSide({ ...WEZTERM, TMUX: '/tmp/tmux-501/default,1,0' })).toBeUndefined()
    expect(wezTermSide({ ...WEZTERM, STY: '123.pts' })).toBeUndefined()
    expect(wezTermSide({ ...WEZTERM, TERM_PROGRAM: 'ghostty' })).toBeUndefined()
    expect(wezTermSide({ ...WEZTERM, WEZTERM_PANE: undefined })).toBeUndefined()
    expect(wezTermSide({ ...WEZTERM, WEZTERM_EXECUTABLE_DIR: undefined })).toBeUndefined()
  })

  test('the code view opens the map in a WezTerm pane to the right, once, instead of an image', async ($, on) => {
    const { clock, splits } = engine(on, WEZTERM)
    await start($)
    await $.command.run({ command: 'mission', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE } as any)
    await pane.press({ key: 'code' })
    await clock.advance(800)

    expect(splits()).toHaveLength(1)
    const argv = splits()[0] as string[]
    expect(argv.slice(0, 9)).toEqual([BIN, 'cli', 'split-pane', '--pane-id', '7', '--right', '--percent', '40', '--'])
    expect(argv[9]).toBe('bash')
    expect(argv[10]).toMatch(/\/helper\/mission-map\.sh$/)
    expect(argv[11]).toBe('/tmp/mission-control')

    expect(await pane.find({ type: 'Image' })).toBeUndefined() // WezTerm would draw it in the wrong place
    expect(await pane.find({ type: 'Text', text: /pane on the right/ })).toBeDefined()

    await pane.press({ key: 'code' }) // the side pane is still there: no second one
    await clock.advance(800)
    expect(splits()).toHaveLength(1)
    await pane.unmount()
  })

  test('going back to who, or closing, closes the side pane; code opens a new one', async ($, on) => {
    const { clock, splits, kills } = engine(on, WEZTERM)
    await start($)
    await $.command.run({ command: 'mission', args: 'code' } as any)
    const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE } as any)
    await clock.advance(800)
    expect(splits()).toHaveLength(1)

    await pane.press({ key: 'who' })
    expect(kills()).toEqual([[BIN, 'cli', 'kill-pane', '--pane-id', '42']])

    await pane.press({ key: 'code' })
    await clock.advance(800)
    expect(splits()).toHaveLength(2)

    await pane.press({ key: 'close' })
    expect(kills()).toHaveLength(2)
    await pane.unmount()
  })

  test('outside WezTerm the code view stays an image and opens no pane', async ($, on) => {
    const { clock, splits } = engine(on, { TERM_PROGRAM: 'ghostty', TMPDIR: '/tmp/' })
    await start($)
    await $.command.run({ command: 'mission', args: 'code' } as any)
    const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE } as any)
    await clock.advance(800)
    expect(splits()).toHaveLength(0)
    expect(await pane.find({ type: 'Image' })).toBeDefined()
    await pane.unmount()
  })
})
