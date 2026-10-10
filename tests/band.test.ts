import { test, expect } from 'claude-code/testing'

const props = { hasSurface: false, hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80, scroll: { bodyRows: 4 }, view: {} } as any

// Stands for the engine's own band: an empty Box, so a plugin that passes is still a valid tree.
const engineBand = ($: any, e: any) => h($.ui.resolve(e).Box, {})
const shown = async (ui: any) => JSON.stringify(await ui.drawn())

const rows = [
  { name: 'System prompt', tokens: 4200, kind: 'used' },
  { name: 'System tools', tokens: 11800, kind: 'used' },
  { name: 'MCP tools', tokens: 6100, kind: 'used' },
  { name: 'Custom agents', tokens: 1300, kind: 'used' },
  { name: 'Memory files', tokens: 3400, kind: 'used' },
  { name: 'Skills', tokens: 2200, kind: 'used' },
  { name: 'Messages', tokens: 55000, kind: 'used' },
  { name: 'Free space', tokens: 80000, kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' }
]

const reading = {
  context: { percent: 42.2, tokens: 84000, window: 200000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.4 },
    { kind: 'seven_day', percentUsed: 8 }
  ],
  changed: ['context', 'rateLimits']
}

const wire = ($: any, on: any) => {
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: 0, ...reading, context: { ...reading.context, breakdown: { categories: rows } } } }))
  on('ui.render', engineBand as any)
}

test('before any reading the band shows -- and no category chips', async ($, on) => {
  wire($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props })
    const t = await shown(ui)
    expect(t).toContain('ctx')
    expect(t).toContain('--')
    expect(t).not.toContain('tools')
    await ui.unmount()
  }
})

test('after a measure the band shows the figures and every category chip', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(reading)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props })
    const t = await shown(ui)
    for (const s of ['42%', '23%', '8%', '84k/200k', 'sys', 'tools', 'mcp', 'agents', 'mem', 'skills', 'msgs', '55k', '11.8k'])
      expect(t).toContain(s)
    expect(t).not.toContain('Free')
    expect(t).toContain(surface === 'desktop' ? 'Svg' : '●')
    await ui.unmount()
  }
})

test('band yields to a survey', async ($, on) => {
  wire($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: { ...props, hasSurvey: true } })
  expect(await shown(ui)).not.toContain('ctx')
  await ui.unmount()
})

test('fixed mode gives each meter its own color regardless of percentage', { options: { colorMode: 'fixed' } }, async ($, on) => {
  wire($, on)
  await ($ as any).session.measure({
    ...reading,
    context: { percent: 10, tokens: 20000, window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 10 }]
  })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props })
  const t = await shown(ui)
  for (const c of ['#f0883e', '#f85149', '#2da44e']) expect(t).toContain(c)
  await ui.unmount()
})

test('the band is centered across its width with a divider between context and limits', async ($, on) => {
  wire($, on)
  await ($ as any).session.measure(reading)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props })
    const t = await shown(ui)
    expect(t).toContain('"justifyContent":"center"')
    expect(t).toContain('"width":80')
    expect(t).toContain('│')
    await ui.unmount()
  }
})
