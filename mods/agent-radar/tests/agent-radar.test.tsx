import { describe, expect, test } from 'claude-code/testing'

import { describe as label, elapsed } from '../hooks/register'

const PANE = { component: 'Pane', requestId: 'agent-radar', props: { title: 'Agent Radar', isFocused: true, bodyColumns: 100, placement: 'dock' } }

// Stands for the engine beneath the mod.
function engine(on: any) {
  const toasts: string[] = []
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Run the sweep', toolUses: [] }, { role: 'assistant', text: 'Sweep is at trial 12 of 40.', toolUses: [] }] }))
  return { toasts }
}

describe('agent-radar', () => {
  test('helpers', () => {
    expect(elapsed({ startedAt: 0, endedAt: 252_000 })).toBe('4m 12s')
    expect(elapsed({ startedAt: 0, endedAt: 9_000 })).toBe('9s')
    expect(label({ tool: 'mcp__plugin_playwright_playwright__browser_click' })).toBe('browser: click')
  })

  test('a spawned agent shows in the pane, opens to its messages, and toasts when done', async ($, on) => {
    const { toasts } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.agent.spawn({ prompt: 'run it', description: 'sweep runner' } as any)

    const r = await $.command.run({ command: 'agents', args: '' } as any)
    expect(r.text).toBe('1 running, 0 finished')

    const ui = await $.ui.mount({ plugin: 'agent-radar', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: /1 running · 0 finished/ })).toBeDefined()
    expect(await ui.find({ key: 'agent-a1' })).toBeDefined()

    await ui.press({ key: 'agent-a1' })
    expect(await ui.find({ type: 'Text', text: /Sweep is at trial 12 of 40/ })).toBeDefined()
    await ui.press({ key: 'back' })

    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, agentId: 'a1' } as any)
    expect(toasts[0]).toMatch(/^✓ sweep runner done \(\d+s · 0 tools\)$/)
    expect(await ui.find({ type: 'Text', text: /0 running · 1 finished/ })).toBeDefined()
    await ui.unmount()
  })
})
