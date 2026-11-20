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
// A wall-clock time as the band writes it, in the local zone: "1:48 PM".
const clock = (ms: number) => {
  const t = new Date(ms)
  const hr = t.getHours()
  return `${hr % 12 || 12}:${String(t.getMinutes()).padStart(2, '0')} ${hr < 12 ? 'AM' : 'PM'}`
}

const reading = (five: number, fiveLeft: number | null, seven: number, sevenLeft: number | null) => ({
  context: {},
  rateLimits: [
    { kind: 'five_hour', percentUsed: five, ...(fiveLeft === null ? {} : { resetsAt: at(fiveLeft) }) },
    { kind: 'seven_day', percentUsed: seven, ...(sevenLeft === null ? {} : { resetsAt: at(sevenLeft) }) }
  ],
  changed: ['rateLimits']
})

// 5h 41%, 10m left; 7d 78% with 8h40m left, so 95% of the week is gone: under pace.
const normal = reading(41, 10 * M, 78, 8 * H + 40 * M)
// 5h 88% with 3h12m left (1h48m in): at that pace it is full in about 15 minutes. 7d 52% with 68% gone.
const danger = reading(88, 3 * H + 12 * M, 52, 53 * H)
const dangerFull = clock(NOW + ((12 * 108) / 88) * M)
// 5h spent, back in 1h24m; 7d 40%.
const spent = reading(100, H + 24 * M, 40, 53 * H)
// 7d 68% with 92h left, so 45% of the week is gone: ahead of pace.
const ahead = reading(18, 4 * H, 68, 92 * H)

const wire = ($: any, on: any) => {
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('ui.render', engineBand as any)
  return mock.clock(on, { now: NOW })
}

const mount = ($: any, surface: string, extra: object = {}) =>
  $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: { ...props, ...extra } })

test('before any reading both limits show -- and no small print', async ($, on) => {
  wire($, on)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await mount($, surface)
    const t = await shown(ui)
    for (const s of surface === 'terminal' ? ['5h', '7d', '--'] : ['5-hour', '7-day', '--']) expect(t).toContain(s)
    for (const s of ['resets', 'xpected', 'pace']) expect(t).not.toContain(s)
    await ui.unmount()
  }
})

test('the band shows no context figures', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect(await shown(ui)).not.toContain('ctx')
    await ui.unmount()
  }
})

test('desktop: a big 5h number, and the 7d bar against what was expected by now', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const s of [
    '41% of the 5-hour limit used',
    '5-hour limit used',
    'resets in 10m',
    '7-day limit',
    '78% used',
    'resets in 8h 40m',
    'Expected by now: ',
    '"95%"',
    'Under pace',
    '"paddingX":2',
    '│',
    '"type":"Svg"'
  ])
    expect(t).toContain(s)
  expect(t).toContain('7-day limit: 78% used, 95% expected by now, under pace, resets in 8h 40m')
  // 5h green by level, 7d amber by level.
  expect(t).toContain('#2da44e')
  expect(t).toContain('#d29922')
  await ui.unmount()
})

test('desktop: a 5h limit on course to run out says when', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(danger)
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const s of ['88%', '#e5534b', `at this pace, full by ~${dangerFull}`, 'resets in 2d 5h', '"68%"', 'Under pace'])
    expect(t).toContain(s)
  expect(t).not.toContain('resets in 3h 12m')
  await ui.unmount()
})

test('desktop: a spent 5h limit gives the time it is back', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(spent)
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const s of ['100%', '#e5534b', `back at ${clock(NOW + H + 24 * M)} (in 1h 24m)`]) expect(t).toContain(s)
  await ui.unmount()
})

test('desktop: a week ahead of pace turns the 7d figure amber', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(ahead)
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const s of ['68% used', '"45%"', 'Ahead of pace', '#d29922', 'resets in 4h']) expect(t).toContain(s)
  await ui.unmount()
})

test('phone: the two limits stack, no divider, expected beside the 7d figure', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const ui = await mount($, 'mobile')
  const t = await shown(ui)
  for (const s of ['"flexDirection":"column"', '41% of the 5-hour limit used', '5-hour limit used', '78% used', 'expected ', '"95%"']) expect(t).toContain(s)
  expect(t).not.toContain('│')
  expect(t).not.toContain('Expected by now')
  await ui.unmount()
})

test('terminal: the 5h number and note, then the 7d bar with a pace marker and the verdict', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const ui = await mount($, 'terminal')
  const l = await line(ui)
  expect(l).toContain('5h  41% resets in 10m      │  7d ')
  expect(l).toContain('7d ████████████░░░│░  78% · expected 95% ✓')
  await ui.unmount()
})

test('terminal: forecast, spent and ahead-of-pace lines', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(danger)
  let ui = await mount($, 'terminal')
  expect(await line(ui)).toContain(`5h  88% full by ~${dangerFull}`)
  await ui.unmount()
  await ($ as any).session.measure(spent)
  ui = await mount($, 'terminal')
  expect(await line(ui)).toContain(`5h 100% back at ${clock(NOW + H + 24 * M)}`)
  await ui.unmount()
  await ($ as any).session.measure(ahead)
  ui = await mount($, 'terminal')
  expect(await line(ui)).toContain('7d ███████│████░░░░░  68% · expected 45% ⚠')
  await ui.unmount()
})

test('terminal: the 7d half stays put while the 5h note changes', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const a = await mount($, 'terminal')
  const la = await line(a)
  await a.unmount()
  await ($ as any).session.measure(danger)
  const b = await mount($, 'terminal')
  const lb = await line(b)
  await b.unmount()
  expect(la.indexOf('│  7d')).toBe(lb.indexOf('│  7d'))
})

test('terminal: a narrow line drops "expected", then the 5h note, but keeps the verdict', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const mid = await mount($, 'terminal', { bodyColumns: 60 })
  const m = await line(mid)
  expect(m).toContain('resets in 10m')
  expect(m).not.toContain('expected')
  expect(m).toContain('78% ✓')
  await mid.unmount()
  const tight = await mount($, 'terminal', { bodyColumns: 44 })
  const t = await line(tight)
  expect(t).toContain('41%')
  expect(t).not.toContain('10m')
  expect(t).toContain('78% ✓')
  await tight.unmount()
})

test('terminal: ascii glyphs for fonts that draw the symbols wide', { options: { terminalGlyphs: 'ascii' } }, async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(normal)
  const ui = await mount($, 'terminal')
  const l = await line(ui)
  expect(l).toContain('|  7d ############---|-  78%  expected 95% ok')
  for (const s of ['█', '░', '│', '✓']) expect(l).not.toContain(s)
  await ui.unmount()
})

test('the countdowns move on with the clock and the 5h note drops once its window resets', async ($, on) => {
  const clk = wire($, on)
  mock.store(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  await ($ as any).session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await ($ as any).session.measure(danger)
  const ui = await mount($, 'desktop')
  await clk.advance(2 * H)
  expect(await shown(ui)).toContain('resets in 2d 3h')
  await clk.advance(2 * H)
  const t = await shown(ui)
  expect(t).not.toContain('full by')
  expect(t).toContain('resets in 2d 1h')
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
  await ($ as any).session.measure(reading(10, null, 95, null))
  const ui = await mount($, 'desktop')
  const t = await shown(ui)
  for (const c of ['#f85149', '#2da44e']) expect(t).toContain(c)
  expect(t).not.toContain('#e5534b')
  await ui.unmount()
})
