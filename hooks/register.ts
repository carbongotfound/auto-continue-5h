import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionAppendInput, SessionRateLimit } from 'claude-code'

import type { Wake } from '../types'

const CANCEL = 'continue-cancel'
const MARGIN_MS = 60_000 // a moment past the reset, as clocks differ
const TICK_MS = 30_000 // polled, not one long timer: a sleeping laptop would run that late

// Claude Code's words for these, as its transcripts have them. The older name of the 5-hour limit is "session limit".
const FIVE_HOUR = /^You've hit your (5-hour|session) limit/i
const OTHER_LIMIT = /^You've hit your .*limit/i
const BUILT_IN = /^Usage limit reached.*continuing automatically/i
const UNNAMED = /^\[?Usage limit reached/i

const wake = atom({ plugin: 'auto-continue-5h', key: 'wake' } as const, null)

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const show = ($: EngineInterface, w: Wake | null) => $.ui.status(w?.by === 'mod' ? `continue at ${clock(w.at)} (/${CANCEL})` : undefined)

async function set($: EngineInterface, w: Wake | null) {
  await update($, wake, () => w)
  show($, w)
}

/** A row that says "limit" but not which: 5-hour only if that window is nearly full and no other is full. */
const fiveHourIsFull = (limits: SessionRateLimit[]) =>
  limits.some(l => l.kind === 'five_hour' && l.percentUsed >= 90) && !limits.some(l => l.kind !== 'five_hour' && l.percentUsed >= 100)

async function arm($: EngineInterface, by: Wake['by'], isNamed: boolean) {
  const { rateLimits } = await $.session.usage()
  if (!isNamed && !fiveHourIsFull(rateLimits)) return
  const resets = rateLimits.find(l => l.kind === 'five_hour')?.resetsAt
  const at = resets ? Date.parse(resets) : NaN
  if (!(at > (await $.clock.now()))) {
    if (by === 'mod') $.ui.toast('5-hour limit hit, but its reset time is unknown: not continuing by itself.')
    return
  }
  const now = await read($, wake)
  if (now?.at === at && (now.by === 'built-in' || now.by === by)) return // already set, or Claude Code's own took it
  await set($, { at, by })
  if (by === 'mod') $.ui.toast(`5-hour limit: typing "continue" at ${clock(at)}.`)
}

/** Only the engine's own rows: the model, a tool or the person can say these words too. */
const fromEngine = (e: SessionAppendInput) =>
  e.origin.kind === 'model' ? e.origin.model === '<synthetic>' : e.message.type === 'system' || e.message.isMeta === true

const textOf = (e: SessionAppendInput) =>
  e.message.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join(' ').trim()

async function heard($: EngineInterface, text: string) {
  if (BUILT_IN.test(text)) return arm($, 'built-in', true)
  if (FIVE_HOUR.test(text)) return arm($, 'mod', true)
  if (OTHER_LIMIT.test(text)) return set($, null)
  if (UNNAMED.test(text)) return arm($, 'mod', false)
}

async function tick($: EngineInterface) {
  const w = await read($, wake)
  if (!w || (await $.clock.now()) < w.at + MARGIN_MS) return
  await set($, null)
  if (w.by === 'mod') void $.prompt.submit({ text: 'continue', asUser: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: CANCEL, description: 'Cancel the "continue" waiting for the 5-hour limit to reset' })
    show($, await read($, wake)) // a reload keeps the wake, not the status or the timer
    $.clock.every(TICK_MS, () => void tick($))
    return next(e)
  })

  on('command.run', { command: CANCEL }, async $ => {
    const was = await read($, wake)
    await set($, null)
    return { text: was?.by === 'mod' ? `Cancelled the "continue" at ${clock(was.at)}.` : 'No "continue" is waiting.' }
  })

  on('session.append', async ($, e, next) => {
    const kept = await next(e)
    if (e.agentId === undefined && fromEngine(e)) await heard($, textOf(e))
    return kept
  })

  on('classic.StopFailure', async ($, e, next) => {
    const done = await next(e)
    if (e.error === 'rate_limit') await heard($, e.error_details ?? e.last_assistant_message ?? 'Usage limit reached')
    return done
  })

  on('prompt.submit', async ($, e, next) => {
    // The person is back and typed something themselves. If the limit still stands, its refusal sets the wake again.
    if ((e.origin?.kind === 'composer' || e.origin?.kind === 'bridge') && !e.command) await set($, null)
    return next(e)
  })
}
