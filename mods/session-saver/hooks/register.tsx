// Session Saver: pairs with unpause.
//   - Names an untitled session after its second turn (Haiku picks 2-4 words), so `unpause`
//     lists "ship-mods" instead of a bare id.
//   - /park [note] saves where you left off and the next step.
//   - A resumed session shows that note above the prompt until you type, and toasts it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Parked } from '../types'

const MODEL = 'haiku'
const NAME_AFTER_TURNS = 2

// Held by the host, so the resume note survives a hot reload of this file.
const resumed = atom({ plugin: 'session-saver', key: 'resumed' } as const, null as Parked | null)

export const register: Register = on => {
  let prompt = ''

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'park', description: 'Save where you left off and the next step, for when you resume', argumentHint: '[note]' })
    return r
  })

  // A resumed session: bring back where it was left.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'resume') {
      const id = await $.session.id()
      const parked = ((await $.store.get(`park:${id}`)) ?? (await $.store.get(`last:${id}`))) as Parked | undefined
      if (parked) {
        await update($, resumed, () => parked)
        $.ui.toast(`Last time (${ago(parked.at)}): ${parked.leftOff}${parked.next ? ` · next: ${parked.next}` : ''}`, { timeoutMs: 8000 })
      }
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    prompt = e.text.slice(0, 600)
    if (await read($, resumed)) await update($, resumed, () => null) // the note has done its job
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      const id = await $.session.id()
      // Without a /park, a resume still shows the last thing asked.
      const last: Parked = { leftOff: `you asked: ${oneLine(prompt, 80)}`, next: '', note: '', at: Date.now() }
      await $.store.set(`last:${id}`, last)
      if ((await $.session.turns()) >= NAME_AFTER_TURNS && !(await $.store.get(`named:${id}`))) {
        await $.store.set(`named:${id}`, true) // one try per session, whatever happens
        void autoname($, id).catch(() => {})
      }
    }
    return r
  })

  on('command.run', { command: 'park' }, async ($, e) => {
    const id = await $.session.id()
    const parked = await summarize($, e.args.trim())
    await $.store.set(`park:${id}`, parked)
    return { text: `Parked. Left off: ${parked.leftOff}${parked.next ? `\nNext: ${parked.next}` : ''}\nResume any time with unpause.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const p = await read($, resumed)
    if (e.props.hasSurvey || !p) return rest
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color="green" bold>{` ↩ Last time (${ago(p.at)}): `}</Text>
          <Text>{p.leftOff}</Text>
          {p.next !== '' && <Text dimColor>{'  ·  next: '}</Text>}
          {p.next !== '' && <Text>{p.next}</Text>}
        </Text>
        {p.note !== '' && <Text dimColor wrap="truncate-end">{`   note: ${p.note}`}</Text>}
        {rest}
      </Box>
    )
  })
}

// Names the session through unpause, only when nobody named it yet.
async function autoname($: EngineInterface, id: string) {
  const list = await $.process.run(['unpause', 'list', '--json'], { timeoutMs: 20_000 })
  const row = (JSON.parse(list.stdout || '[]') as { id: string; custom_title?: string }[]).find(s => s.id === id)
  if (!row || row.custom_title) return

  const messages = (await $.session.messages()).filter(m => m.role === 'user').slice(0, 3)
  const r = await $.model.complete({
    model: MODEL,
    maxTokens: 30,
    system: 'Name a coding session in 2 to 4 lowercase words joined by hyphens (like "ship-mods" or "fix-login-ci"). Reply with the name only.',
    prompt: messages.map(m => m.text.slice(0, 500)).join('\n---\n'),
  })
  if (!r.isAnswered) return
  const name = kebab(r.text)
  if (!name) return
  const done = await $.process.run(['unpause', 'rename', id, name], { timeoutMs: 20_000 })
  if (done.exitCode === 0) $.ui.toast(`Session named "${name}" (rename any time with /rename)`)
}

async function summarize($: EngineInterface, note: string): Promise<Parked> {
  const messages = (await $.session.messages()).slice(-10)
  const r = await $.model.complete({
    model: MODEL,
    maxTokens: 200,
    system:
      'Someone is pausing a coding session and will resume it later. Plain words, no em dashes. ' +
      'Reply with JSON only: {"leftOff": "where things stand, at most 80 characters", "next": "the next step, at most 60 characters"}.',
    prompt: messages.map(m => `${m.role}: ${m.text.slice(0, 600)}`).join('\n'),
  })
  const fallback: Parked = { leftOff: 'parked (no summary)', next: '', note, at: Date.now() }
  if (!r.isAnswered) return fallback
  try {
    const o = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1)) as { leftOff?: string; next?: string }
    return { leftOff: oneLine(o.leftOff ?? '', 80) || fallback.leftOff, next: oneLine(o.next ?? '', 60), note, at: Date.now() }
  } catch {
    return fallback
  }
}

export function kebab(text: string) {
  return text
    .toLowerCase()
    .replace(/["'`.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-')
}

export function ago(at: number, now = Date.now()) {
  const m = Math.round((now - at) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const hours = Math.round(m / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

function oneLine(text: string, max: number) {
  const t = text.replace(/\s+/g, ' ').replace(/\s*—\s*/g, ', ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
