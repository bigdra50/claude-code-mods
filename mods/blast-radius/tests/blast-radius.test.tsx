import { describe, expect, test } from 'claude-code/testing'

import { classify } from '../hooks/register'

const PANE = { component: 'Pane', requestId: 'blast-radius', props: { title: 'Blast Radius', isFocused: true, bodyColumns: 100, placement: 'dock' } }

// Stands for the engine beneath the mod: tools run, a 9-file build folder, panes that open.
function engine(on: any, ran: string[]) {
  on('tool.call', (_$: any, e: any) => {
    ran.push(e.command)
    return { result: {}, text: 'ok' }
  })
  on('process.run', async (_$: any, e: any) => {
    const argv: string[] = e.argv
    if (argv[0] === 'sleep') await new Promise(done => (globalThis as any).setTimeout(done, 5)) // a real wait, so the hold loop yields
    const stdout = argv[0] === 'bash'
      ? ['S 1126', ...Array.from({ length: 9 }, (_, i) => `F build/chunk-${i}.js`)].join('\n')
      : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
}

async function heldPane($: any) {
  for (let i = 0; i < 50; i++) {
    const ui = await $.ui.mount({ plugin: 'blast-radius', surface: 'terminal', ...PANE })
    if (await ui.find({ type: 'Text', text: /held a command/ })) return ui
    await ui.unmount()
  }
  throw new Error('nothing was held')
}

describe('blast-radius', () => {
  test('classifies only the risky commands', () => {
    expect(classify('rm -rf build')?.risk).toBe('delete')
    expect(classify('cd web && rm -r dist')).toEqual({ risk: 'delete', cwd: 'web', targets: ['dist'] })
    expect(classify('git push --force origin main')?.risk).toBe('force-push')
    expect(classify('git push -f')?.risk).toBe('force-push')
    expect(classify('npx prisma migrate deploy')?.risk).toBe('migration')
    expect(classify('rm file.txt')).toBeNull()
    expect(classify('git push origin main')).toBeNull()
    expect(classify('ls -la && echo rm -rf')).toBeNull()
  })

  test('Cancel refuses the command with the reason', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /delete 9 files \(1\.1 MB\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /build\/chunk-0\.js/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    const r: any = await call
    expect(r.deny).toMatch(/the user pressed Cancel\. It would have: delete 9 files/)
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test('Proceed runs the command as written', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    await ui.press({ key: 'proceed' })
    await call
    expect(ran).toEqual(['rm -rf build'])
    await ui.unmount()
  })

  test('lists files from the folder being deleted', async ($, on) => {
    on('tool.call', () => ({ result: {}, text: 'ok' }) as any)
    on('process.run', async (_$: any, e: any) => {
      if (e.argv[0] === 'sleep') await new Promise(done => (globalThis as any).setTimeout(done, 5))
      const stdout = e.argv[0] === 'bash' ? 'S 4\nF /tmp/deep/demo/build/chunk-1.js' : ''
      return { value: { exitCode: 0, stdout, stderr: '' } } as any
    })
    on('ui.open', () => ({ value: { isPlaced: true } }) as any)
    on('ui.close', () => ({ value: undefined }) as any)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/deep/demo/build' } as any)
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /^  build\/chunk-1\.js$/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    await call
    await ui.unmount()
  })

  test('a safe command is never held', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    await $.tool.call({ tool: 'Bash', command: 'ls -la' } as any)
    expect(ran).toEqual(['ls -la'])
  })
})
