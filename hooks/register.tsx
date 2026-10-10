import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Slice, Usage } from '../types'

const empty: Usage = { context: null, fiveHour: null, sevenDay: null, tokens: null, window: null, detail: [] }
const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, empty)

type Snapshot = {
  context: { percent?: number; tokens?: number; window?: number }
  rateLimits: { kind: string; percentUsed: number }[]
}

const toUsage = (s: Snapshot, detail: Slice[]): Usage => ({
  context: s.context.percent ?? null,
  fiveHour: s.rateLimits.find(r => r.kind === 'five_hour')?.percentUsed ?? null,
  sevenDay: s.rateLimits.find(r => r.kind === 'seven_day')?.percentUsed ?? null,
  tokens: s.context.tokens ?? null,
  window: s.context.window ?? null,
  detail
})

const fmt = (n: number | null) => (n === null ? '--' : `${Math.round(n)}%`)
const clamp = (n: number) => Math.max(0, Math.min(100, n))
const GREY = '#8b8b8b'

const levelTone = (n: number | null) => (n === null ? GREY : n < 60 ? '#2da44e' : n < 85 ? '#d29922' : '#e5534b')

type Key = 'context' | 'fiveHour' | 'sevenDay'
type Palette = (k: Key, n: number | null) => string

const makePalette = (o: Record<string, unknown> = {}): Palette => {
  const fixed: Record<Key, string> = {
    context: String(o.contextColor || '#f0883e'),
    fiveHour: String(o.fiveHourColor || '#f85149'),
    sevenDay: String(o.sevenDayColor || '#2da44e')
  }
  return o.colorMode === 'fixed' ? (k, n) => (n === null ? GREY : fixed[k]) : (_k, n) => levelTone(n)
}

// One entry per slice of the window; the order is the order they are drawn in.
const CATS = [
  { key: 'sys', label: 'sys', color: '#7F77DD' },
  { key: 'tools', label: 'tools', color: '#378ADD' },
  { key: 'mcp', label: 'mcp', color: '#1D9E75' },
  { key: 'agents', label: 'agents', color: '#D4537E' },
  { key: 'mem', label: 'mem', color: '#EF9F27' },
  { key: 'skills', label: 'skills', color: '#D85A30' },
  { key: 'msgs', label: 'msgs', color: '#639922' },
  { key: 'other', label: 'other', color: '#b4b2a9' }
] as const

// The rows of /context, matched by their label; MCP is tested before tools since its label holds both.
const classify = (name: string): string => {
  if (/mcp/i.test(name)) return 'mcp'
  if (/system prompt/i.test(name)) return 'sys'
  if (/tool/i.test(name)) return 'tools'
  if (/agent/i.test(name)) return 'agents'
  if (/memory/i.test(name)) return 'mem'
  if (/skill/i.test(name)) return 'skills'
  if (/message/i.test(name)) return 'msgs'
  return 'other'
}

const fetchDetail = async ($: any): Promise<Slice[]> => {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const rows: { name: string; tokens: number; kind: string }[] = u.context.breakdown?.categories ?? []
    const sums = new Map<string, number>()
    for (const r of rows) {
      if (r.kind !== 'used' || r.tokens <= 0) continue
      const key = classify(r.name)
      sums.set(key, (sums.get(key) ?? 0) + r.tokens)
    }
    return CATS.filter(c => sums.has(c.key)).map(c => ({ key: c.key, tokens: sums.get(c.key) as number }))
  } catch {
    return []
  }
}

const tk = (t: number) =>
  t >= 100000 ? `${Math.round(t / 1000)}k` : t >= 1000 ? `${(t / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${t}`
const colorOf = (key: string) => CATS.find(c => c.key === key)?.color ?? GREY
const labelOf = (key: string) => CATS.find(c => c.key === key)?.label ?? key

const barSvg = (u: Usage, w: number, h: number) => {
  const total = u.window && u.window > 0 ? u.window : u.detail.reduce((a, s) => a + s.tokens, 0) || 1
  let x = 0
  const segs = u.detail
    .map(s => {
      const sw = Math.max(1.5, (s.tokens / total) * w)
      const out = `<rect x="${x.toFixed(1)}" width="${sw.toFixed(1)}" height="${h}" fill="${colorOf(s.key)}"/>`
      x += sw
      return out
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<clipPath id="c"><rect width="${w}" height="${h}" rx="${h / 2}"/></clipPath>` +
    `<rect width="${w}" height="${h}" rx="${h / 2}" fill="${GREY}" fill-opacity="0.25"/>` +
    `<g clip-path="url(#c)">${segs}</g></svg>`
  )
}

const pieSvg = (p: number | null, color: string, s = 18) => {
  const w = Math.max(3, Math.round(s * 0.18))
  const r = (s - w) / 2
  const c = s / 2
  const len = 2 * Math.PI * r
  const dash = p === null || p <= 0 ? 0 : (clamp(p) / 100) * len
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">`
  const track = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${GREY}" stroke-opacity="0.25" stroke-width="${w}"/>`
  const arc =
    dash > 0
      ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" ` +
        `stroke-dasharray="${dash.toFixed(2)} ${len.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`
      : ''
  return `${open}${track}${arc}</svg>`
}

const dotSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><circle cx="5" cy="5" r="4" fill="${color}"/></svg>`

const DOTS = 10
const lit = (n: number | null) => (n === null ? 0 : Math.max(n > 0 ? 1 : 0, Math.round((clamp(n) / 100) * DOTS)))
const pieChar = (n: number | null) => (n === null || n <= 0 ? '○' : n < 38 ? '◔' : n < 63 ? '◑' : n < 88 ? '◕' : '●')

export const register: Register = (on, options) => {
  const tone = makePalette(options as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    const [snap, detail] = await Promise.all([$.session.usage(), fetchDetail($)])
    await update($, usage, () => toUsage(snap, detail))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const detail = e.changed.includes('context') ? await fetchDetail($) : null
    await update($, usage, prev => toUsage(e, detail ?? prev.detail))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const u = await read($, usage)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const isDesktop = e.surface === 'desktop'
    const { Svg } = els as any

    const ctxColor = tone('context', u.context)
    const size = u.tokens !== null && u.window ? `${tk(u.tokens)}/${tk(u.window)}` : null

    const PIE = 32

    // Desktop: a ring with its label and percent beside it. Terminal: one line of text.
    const limit = (key: 'fiveHour' | 'sevenDay', label: string) => {
      const n = u[key]
      const color = tone(key, n)
      if (!isDesktop) {
        return (
          <Text key={key}>
            <Text dimColor>{label} </Text>
            <Text color={color}>{pieChar(n)}</Text>
            <Text bold color={color}> {fmt(n)}</Text>
          </Text>
        )
      }
      return (
        <Box key={key} alignItems="center">
          <Svg source={pieSvg(n, color, PIE)} alt={`${label} ${fmt(n)}`} width={PIE} height={PIE} />
          <Box flexDirection="column" marginLeft={1}>
            <Text dimColor>{label}</Text>
            <Text bold color={color}>{fmt(n)}</Text>
          </Box>
        </Box>
      )
    }

    const meter = isDesktop ? (
      <Svg source={barSvg(u, 200, 10)} alt={`context ${fmt(u.context)}`} width={200} height={10} />
    ) : (
      <Text>
        <Text color={ctxColor}>{'●'.repeat(lit(u.context))}</Text>
        <Text dimColor>{'○'.repeat(DOTS - lit(u.context))}</Text>
      </Text>
    )

    const chips = u.detail.map(s => (
      <Box key={s.key} marginX={1}>
        {isDesktop ? (
          <Svg source={dotSvg(colorOf(s.key))} alt={labelOf(s.key)} width={10} height={10} />
        ) : (
          <Text color={colorOf(s.key)}>●</Text>
        )}
        <Text dimColor> {labelOf(s.key)} </Text>
        <Text bold>{tk(s.tokens)}</Text>
      </Box>
    ))

    // A thin theme-colored rule: the theme's own subtle tone stays quiet on white and on dark.
    const divider = (
      <Box flexDirection="column">
        <Text color="subtle">│</Text>
        <Text color="subtle">│</Text>
      </Box>
    )

    // The whole group is centered across the band's width; the divider splits context from the limits.
    return (
      <Box width={e.props.bodyColumns} justifyContent="center" alignItems="center">
        <Box flexDirection="column" alignItems="center" flexShrink={1}>
          <Box alignItems="center">
            <Text dimColor>ctx </Text>
            {meter}
            <Text bold color={ctxColor}> {fmt(u.context)}</Text>
            {size ? <Text dimColor>  {size}</Text> : null}
          </Box>
          {chips.length > 0 ? (
            <Box flexWrap="wrap" justifyContent="center">
              {chips}
            </Box>
          ) : null}
        </Box>
        <Box marginX={isDesktop ? 2 : 1}>{divider}</Box>
        {isDesktop ? (
          <Box alignItems="center">
            {limit('fiveHour', '5h')}
            <Box marginLeft={2}>{limit('sevenDay', '7d')}</Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            {limit('fiveHour', '5h')}
            {limit('sevenDay', '7d')}
          </Box>
        )}
      </Box>
    )
  })
}
