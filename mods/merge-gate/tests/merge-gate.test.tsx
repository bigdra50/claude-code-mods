import { describe, expect, test } from 'claude-code/testing'

import { countChecks, isOllama } from '../hooks/register'

const LUNA_REVIEW = `codex review -c 'model="gpt-5.6-luna"' --base main --title "Add mods"`
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 } }

// Stands for the engine beneath the mod: a repo with PR #42, its checks, the Codex config, a dialog.
function engine(on: any, opts: { config?: string; checks?: object[]; answer?: string } = {}) {
  const ran: string[] = []
  const store = new Map<string, unknown>()
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
    const question = e.questions[0].question
    return { result: { questions: e.questions, answers: { [question]: opts.answer ?? 'Hold' } }, text: '' }
  })
  on('tool.call', (_$: any, e: any) => {
    ran.push(e.command)
    return { result: {}, text: 'ok' }
  })
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('fs.read', () => ({ value: opts.config ?? 'model = "gpt-6-astra"\n' }))
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  on('process.run', (_$: any, e: any) => {
    const argv = (e.argv as string[]).join(' ')
    const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } })
    if (argv.startsWith('git rev-parse')) return ok('/repo\n')
    if (argv.startsWith('git branch')) return ok('feat/mods\n')
    if (argv.startsWith('gh pr view')) return ok(JSON.stringify({ number: 42, title: 'Add mods', headRefName: 'feat/mods', state: 'OPEN' }))
    if (argv.startsWith('gh pr checks')) return ok(JSON.stringify(opts.checks ?? [{ name: 'test', bucket: 'pass' }]), 1)
    return ok('')
  })
  return { ran, store }
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })

describe('merge-gate', () => {
  test('helpers', () => {
    expect(isOllama('model = "gpt-6-astra"')).toBe(false)
    expect(isOllama('openai_base_url = "http://127.0.0.1:11434/v1"')).toBe(true)
    expect(isOllama('model = "gemma4:128k"')).toBe(true)
    expect(countChecks(JSON.stringify([{ name: 'a', bucket: 'pass' }, { name: 'b', bucket: 'fail' }, { name: 'c', bucket: 'pending' }])))
      .toEqual({ pass: 1, fail: 1, pending: 1, failing: ['b'] })
  })

  test('Codex: Ollama config is refused, the model must be luna, one pass per PR', async ($, on) => {
    const { ran } = engine(on, { config: 'openai_base_url = "http://127.0.0.1:11434/v1"\n' })
    await start($)
    const r: any = await $.tool.call({ tool: 'Bash', command: LUNA_REVIEW } as any)
    expect(r.deny).toMatch(/points at Ollama/)
    expect(ran).toEqual([])
  })

  test('Codex: wrong model refused, first luna pass runs, second refused', async ($, on) => {
    const { ran } = engine(on)
    await start($)
    const wrong: any = await $.tool.call({ tool: 'Bash', command: 'codex review --base main' } as any)
    expect(wrong.deny).toMatch(/gpt-5\.6-luna only/)
    await $.tool.call({ tool: 'Bash', command: LUNA_REVIEW } as any)
    const again: any = await $.tool.call({ tool: 'Bash', command: LUNA_REVIEW } as any)
    expect(again.deny).toMatch(/one pass per PR/)
    expect(ran).toEqual([LUNA_REVIEW])
  })

  test('codex exec is never run', async ($, on) => {
    const { ran } = engine(on)
    const r: any = await $.tool.call({ tool: 'Bash', command: 'codex exec "fix it"' } as any)
    expect(r.deny).toMatch(/review only/)
    expect(ran).toEqual([])
  })

  test('merge is held when CI fails and Codex has not run', async ($, on) => {
    const { ran } = engine(on, { checks: [{ name: 'lint', bucket: 'fail' }], answer: 'Hold' })
    await start($)
    const r: any = await $.tool.call({ tool: 'Bash', command: 'gh pr merge 42 --squash' } as any)
    expect(r.deny).toMatch(/1 failing \(lint\); Codex has not reviewed it/)
    expect(ran).toEqual([])
  })

  test('merge goes through when CI is green and Codex ran', async ($, on) => {
    const { ran } = engine(on)
    await start($)
    await $.tool.call({ tool: 'Bash', command: LUNA_REVIEW } as any)
    await $.tool.call({ tool: 'Bash', command: 'gh pr merge 42 --squash' } as any)
    expect(ran).toEqual([LUNA_REVIEW, 'gh pr merge 42 --squash'])
  })

  test('the band shows the PR and stacks over what was there; /gate explains', async ($, on) => {
    engine(on, { checks: [{ name: 'test', bucket: 'pass' }, { name: 'lint', bucket: 'fail' }] })
    await start($)
    const r = await $.command.run({ command: 'gate', args: '' } as any)
    expect(r.text).toMatch(/PR #42: Add mods/)
    expect(r.text).toMatch(/Not ready to merge/)
    const ui = await $.ui.mount({ plugin: 'merge-gate', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: / ⛙ PR #42 / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /CI ✗ 1 failing/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Codex 0\/1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await ui.unmount()
  })
})
