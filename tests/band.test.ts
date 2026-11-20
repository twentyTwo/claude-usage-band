import { test, expect, mock } from 'claude-code/testing'

const props = { hasSurface: false, hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 120, scroll: { bodyRows: 4 }, view: {} } as any

// Stands for the engine's own band: an empty Box, so a plugin that passes is still a valid tree.
const engineBand = ($: any, e: any) => h($.ui.resolve(e).Box, {})
const shown = async (ui: any) => JSON.stringify(await ui.drawn())
// The terminal line as plain text, its Text leaves joined in order.
const line = async (ui: any) => {
  const out: string[] = []
  const walk = (n: any) => {
    if (typeof n === 'string') out.push(n)
    else if (Array.isArray(n)) n.forEach(walk)
    else if (n && typeof n === 'object') {
      if (typeof n.props?.label === 'string') return
      walk(n.children ?? n.props?.children)
    }
  }
  walk(await ui.drawn())
  return out.join('')
}

const NOW = Date.parse('2026-11-20T10:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const M = 60000
const H = 60 * M

// The kit's "normal" state: 5h 41% with 10m left (97% gone); 7d 78% with 8h40m left (95% gone).
const normal = {
  context: {},
  rateLimits: [
    { kind: 'five_hour', percentUsed: 41, resetsAt: at(10 * M) },
    { kind: 'seven_day', percentUsed: 78, resetsAt: at(8 * H + 40 * M) }
  ],
  changed: ['rateLimits']
}
// The kit's "danger" state: 5h 88% with 3h12m left (36% gone); 7d 52% with 2d5h left (68% gone).
const danger = {
  ...normal,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 88, resetsAt: at(3 * H + 12 * M) },
    { kind: 'seven_day', percentUsed: 52, resetsAt: at(53 * H) }
  ]
}

const wire = ($: any, on: any) => {
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('ui.render', engineBand as any)
  return mock.clock(on, { now: NOW })
}

const mount = ($: any, surface: string, extra: object = {}) =>
  $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: { ...props, ...extra } })

test('before any reading both limits show -- and no words', async ($, on) => {
  wire($, on)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await mount($, surface)
    const t = await shown(ui)
    for (const s of ['5h', '7d', '--']) expect(t).toContain(s)
    expect(t).not.toContain('gone')
    await ui.unmount()
  }
})

test('the band shows no context figures any more', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect(await shown(ui)).not.toContain('ctx')
    await ui.unmount()
  }
})

test('desktop: one padded row, percent, time gone and countdown, with a hairline between', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const s of ['41%', '78%', '"97% gone · resets in 10m"', '"95% gone · resets in 8h40m"', '"paddingX":2', '│', '"type":"Svg"'])
    expect(t).toContain(s)
  expect(t).toContain('5-hour limit: 41% used, 97% of time gone · resets in 10m')
  expect(t).toContain('#2da44e')
  expect(t).toContain('#d29922')
  await ui.unmount()
})

test('desktop danger: red 5h ahead of pace, days and hours for 7d', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(danger)
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const s of ['88%', '#e5534b', '36% gone · resets in 3h12m', '68% gone · resets in 2d5h']) expect(t).toContain(s)
  await ui.unmount()
})

test('phone: the limits stack, with the short words and no divider', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const ui = await mount($, 'mobile')
  const t = await shown(ui)
  expect(t).toContain('"flexDirection":"column"')
  expect(t).toContain('97% gone · resets in 10m')
  expect(t).not.toContain('"97% of time gone · resets in 10m"')
  expect(t).not.toContain('│')
  await ui.unmount()
})

test('terminal: one line of dots with a pace marker, percent and words', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const ui = await mount($, 'terminal')
  const l = await line(ui)
  expect(l).toContain('5h ●●●●○○○○○│○  41% · 97% gone · 10m')
  expect(l).toContain('7d ●●●●●●●●○│○  78% · 95% gone · 8h40m')
  await ui.unmount()
})

test('terminal: a narrow line drops the time gone, then the countdown', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const mid = await mount($, 'terminal', { bodyColumns: 60 })
  const m = await line(mid)
  expect(m).toContain('10m')
  expect(m).not.toContain('gone')
  await mid.unmount()
  const tight = await mount($, 'terminal', { bodyColumns: 44 })
  const t = await line(tight)
  expect(t).toContain('41%')
  expect(t).not.toContain('10m')
  await tight.unmount()
})

test('terminal: ascii glyphs for fonts that draw the symbols wide', { options: { terminalGlyphs: 'ascii' } }, async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const ui = await mount($, 'terminal')
  const l = await line(ui)
  expect(l).toContain('5h ####-----|-  41%  97% gone  10m')
  expect(l).not.toContain('●')
  await ui.unmount()
})

test('the countdown moves on with the clock and drops once the window resets', async ($, on) => {
  const clock = wire($, on)
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  await ($ as any).session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await ($ as any).session.measure(danger)
  const ui = await mount($, 'desktop')
  await clock.advance(2 * H)
  expect(await shown(ui)).toContain('resets in 1h12m')
  await clock.advance(2 * H)
  const t = await shown(ui)
  expect(t).not.toContain('h12m')
  expect(t).toContain('resets in 2d1h')
  await ui.unmount()
})

test('a reading without rate limits keeps the last figures', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  await ($ as any).session.measure({ ...normal, rateLimits: [], changed: ['context'] })
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const s of ['41%', '78%', 'resets in 10m']) expect(t).toContain(s)
  await ui.unmount()
})

test('a new session starts with the limits saved by the last one', async ($, on) => {
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('ui.render', engineBand as any)
  await ($ as any).session.measure(normal)
  await ($ as any).session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const s of ['41%', '78%', 'resets in 10m']) expect(t).toContain(s)
  await ui.unmount()
})

test('band yields to a survey', async ($, on) => {
  wire($, on)
  const ui = await mount($, 'terminal', { hasSurvey: true })
  expect(await shown(ui)).not.toContain('5h')
  await ui.unmount()
})

test('fixed mode gives each limit its own color regardless of percentage', { options: { colorMode: 'fixed' } }, async ($, on) => {
  wire($, on)
  await ($ as any).session.measure({
    ...normal,
    rateLimits: [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 95 }]
  })
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const c of ['#f85149', '#2da44e']) expect(t).toContain(c)
  expect(t).not.toContain('#e5534b')
  await ui.unmount()
})
