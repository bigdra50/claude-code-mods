import { describe, expect, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'snake', props: { title: 'Snake', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 } } }

// Stands for the engine beneath the mod.
function engine(on: any, saved: Record<string, unknown>, opened: string[]) {
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('store.get', (_$: any, e: any) => ({ value: saved[e.key] }))
  on('store.set', (_$: any, e: any) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  on('ui.open', (_$: any, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

describe('snake mod', () => {
  test('plays while Claude works and pauses when it is done', async ($, on) => {
    const opened: string[] = []
    engine(on, {}, opened)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)

    const ui: any = await $.ui.mount({ plugin: 'snake', surface: 'terminal', ...PANE } as any)
    await ui.resize({ columns: 40, rows: 12, in: 'snake' })
    await ui.advance(120)
    expect(await ui.find({ type: 'Text', text: /score 0/, in: 'snake' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Claude's done, your turn/, in: 'snake' })).toBeDefined()

    await $.turn.start({ text: 'go', turnId: 't1' } as any)
    expect(opened).toEqual(['snake'])
    await ui.advance(240)
    expect(await ui.find({ type: 'Text', text: /Claude's done, your turn/, in: 'snake' })).toBeUndefined()
    await ui.key({ key: 'down', in: 'snake' })
    await ui.advance(120)

    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await ui.advance(120)
    expect(await ui.find({ type: 'Text', text: /Claude's done, your turn/, in: 'snake' })).toBeDefined()
    await ui.unmount()
  })

  test('a score from the game raises and saves the best', async ($, on) => {
    const saved: Record<string, unknown> = { best: 4 }
    engine(on, saved, [])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const ui: any = await $.ui.mount({ plugin: 'snake', surface: 'terminal', ...PANE } as any)
    await ui.resize({ columns: 40, rows: 12, in: 'snake' })
    await ui.advance(120)
    expect(await ui.find({ type: 'Text', text: /best 4/, in: 'snake' })).toBeDefined()

    await ui.post({ score: 7 })
    expect(saved.best).toBe(7)
    expect(await ui.find({ type: 'Text', text: /best 7/, in: 'snake' })).toBeDefined()

    await ui.post({ score: 2 })
    expect(saved.best).toBe(7)
    await ui.unmount()
  })

  test('the spinner shows the score only while playing', async ($, on) => {
    engine(on, {}, [])
    on('ui.render', ($: any, e: any) => {
      // Stands for the engine's spinner: draws the message, or the word.
      const { Text } = $.ui.resolve(e)
      return Text({ children: e.props.message ?? e.props.word })
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const SPINNER = { component: 'Spinner', props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' } }

    await $.turn.start({ text: 'go', turnId: 't1' } as any)
    const pane: any = await $.ui.mount({ plugin: 'snake', surface: 'terminal', ...PANE } as any)
    await pane.post({ score: 3 })
    const spin = await $.ui.mount({ plugin: 'snake', surface: 'terminal', ...SPINNER } as any)
    expect(await spin.find({ type: 'Text', text: /Thinking · 🐍 3 \(best 3\)/ })).toBeDefined()
    await spin.unmount()

    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    const after = await $.ui.mount({ plugin: 'snake', surface: 'terminal', ...SPINNER } as any)
    expect(await after.find({ type: 'Text', text: /^Thinking$/ })).toBeDefined()
    await after.unmount()
    await pane.unmount()
  })
})
