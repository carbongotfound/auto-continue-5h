import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-07T10:00:00Z')
const RESET = NOW + 3_600_000
const FULL = [
  { kind: 'five_hour', percentUsed: 100, resetsAt: new Date(RESET).toISOString() },
  { kind: 'seven_day', percentUsed: 40, resetsAt: new Date(NOW + 86_400_000).toISOString() },
]

function world(on: any, rateLimits: unknown[] = FULL) {
  const clock = mock.clock(on, { now: NOW })
  const sent: string[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits } }))
  on('command.register', () => ({ value: { command: 'continue-cancel' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('classic.StopFailure', () => ({}))
  on('prompt.submit', (_: unknown, e: { text: string; origin?: { kind: string } }) => {
    if (e.origin?.kind === 'plugin') sent.push(e.text)
    return { text: e.text }
  })
  return { clock, sent }
}

const start = ($: any) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

/** The row Claude Code stores when a limit refuses a request. */
const refusal = ($: any, text: string, extra: object = {}) =>
  $.session.append({
    uuid: 'r' + text.length,
    door: 'response',
    origin: { kind: 'model', model: '<synthetic>' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  })

const notice = ($: any, text: string) =>
  $.session.append({
    uuid: 'n' + text.length,
    door: 'notice',
    origin: { kind: 'engine' },
    message: { type: 'system', content: [{ type: 'text', text }] },
  })

test('a 5-hour limit types continue once, just after the reset', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await refusal($, "You've hit your 5-hour limit · resets 8:40pm (UTC)")
  await clock.advance(3_590_000)
  expect(sent).toEqual([])
  await clock.advance(120_000)
  expect(sent).toEqual(['continue'])
  await clock.advance(3_600_000)
  expect(sent).toEqual(['continue'])
})

test('a weekly limit types nothing', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await refusal($, "You've hit your weekly limit · resets Nov 2, 12pm (UTC)")
  await clock.advance(7_200_000)
  expect(sent).toEqual([])
})

test('a weekly limit after a 5-hour one drops the wait', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await refusal($, "You've hit your 5-hour limit · resets 8:40pm")
  await refusal($, "You've hit your weekly limit · resets Nov 2, 12pm")
  await clock.advance(7_200_000)
  expect(sent).toEqual([])
})

test('Claude Code taking it itself means the mod stays quiet', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await refusal($, "You've hit your 5-hour limit · resets 8:40pm")
  await notice($, 'Usage limit reached · continuing automatically at 8:40pm · esc to cancel')
  await clock.advance(7_200_000)
  expect(sent).toEqual([])
})

test("the words in the model's own reply or a subagent's row don't count", async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await refusal($, "You've hit your 5-hour limit", { origin: { kind: 'model', model: 'claude-opus-5-5' } })
  await refusal($, "You've hit your 5-hour limit", { agentId: 'a1' })
  await clock.advance(7_200_000)
  expect(sent).toEqual([])
})

test('a row that names no limit counts only with the 5-hour window full', async ($, on) => {
  const weekly = [{ kind: 'five_hour', percentUsed: 30, resetsAt: new Date(RESET).toISOString() }, { kind: 'seven_day', percentUsed: 100 }]
  const { clock, sent } = world(on, weekly)
  await start($)
  await notice($, 'Usage limit reached')
  await clock.advance(7_200_000)
  expect(sent).toEqual([])
})

test('the cancel command stops it', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await refusal($, "You've hit your 5-hour limit · resets 8:40pm")
  const r = await ($ as any).command.run({ command: 'continue-cancel', args: '' })
  expect(r.text).toMatch(/Cancelled/)
  await clock.advance(7_200_000)
  expect(sent).toEqual([])
})

test('the person typing cancels it, and a refusal sets it again', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await refusal($, "You've hit your 5-hour limit · resets 8:40pm")
  await ($ as any).prompt.submit({ text: 'hello', origin: { kind: 'composer' } })
  await clock.advance(1_800_000)
  expect(sent).toEqual([])
  await refusal($, "You've hit your 5-hour limit · resets 8:40pm")
  await clock.advance(1_860_000)
  expect(sent).toEqual(['continue'])
})

test('a refused turn the row missed still counts, by its stop failure', async ($, on) => {
  const { clock, sent } = world(on)
  await start($)
  await ($ as any).classic.StopFailure({ hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: "You've hit your 5-hour limit · resets 8:40pm" })
  await clock.advance(3_660_000)
  expect(sent).toEqual(['continue'])
})
