import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Usage } from '../types'

const empty: Usage = { fiveHour: null, sevenDay: null, fiveHourResetsAt: null, sevenDayResetsAt: null, now: null }
const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, empty)

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
type Key = 'fiveHour' | 'sevenDay'

// Each window's length, to tell how much of its time has passed from the time left.
const WINDOW_MS: Record<Key, number> = { fiveHour: 5 * 3600000, sevenDay: 7 * 24 * 3600000 }

// When a window resets, in epoch milliseconds; a reading without one keeps the time it had.
const resetOf = (limits: Limit[], kind: string, prev: number | null | undefined): number | null => {
  const at = limits.find(r => r.kind === kind)?.resetsAt
  const ms = at ? Date.parse(at) : NaN
  return Number.isFinite(ms) ? ms : (prev ?? null)
}

// A window missing from the reading keeps the figure it had: rate limits only arrive with a response.
// A value saved by an older version may lack fields, so each is read with a fallback.
const toUsage = (limits: Limit[], prev: Usage, now: number | null): Usage => ({
  fiveHour: limits.find(r => r.kind === 'five_hour')?.percentUsed ?? prev.fiveHour ?? null,
  sevenDay: limits.find(r => r.kind === 'seven_day')?.percentUsed ?? prev.sevenDay ?? null,
  fiveHourResetsAt: resetOf(limits, 'five_hour', prev.fiveHourResetsAt),
  sevenDayResetsAt: resetOf(limits, 'seven_day', prev.sevenDayResetsAt),
  now
})

// The last limits seen, kept across sessions so a new one starts with figures instead of --.
const LIMITS_KEY = 'limits'

const savedLimits = async ($: any): Promise<Limit[]> => {
  try {
    const saved = (await $.store.get(LIMITS_KEY)) as Limit[] | undefined
    if (!Array.isArray(saved)) return []
    const now = await $.clock.now()
    // A window that has reset since it was saved no longer says anything.
    return saved.filter(r => !r.resetsAt || Date.parse(r.resetsAt) > now)
  } catch {
    return []
  }
}

const nowOr = async ($: any, fallback: number | null): Promise<number | null> => {
  try {
    return await $.clock.now()
  } catch {
    return fallback
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))
const GREY = '#8b8b8b'
const FILL = { green: '#2da44e', amber: '#d29922', red: '#e5534b' }
const levelTone = (n: number | null) => (n === null ? GREY : n < 60 ? FILL.green : n <= 85 ? FILL.amber : FILL.red)

type Palette = (k: Key, n: number | null) => string
const makePalette = (o: Record<string, unknown> = {}): Palette => {
  const fixed: Record<Key, string> = {
    fiveHour: String(o.fiveHourColor || '#f85149'),
    sevenDay: String(o.sevenDayColor || '#2da44e')
  }
  return o.colorMode === 'fixed' ? (k, n) => (n === null ? GREY : fixed[k]) : (_k, n) => levelTone(n)
}

// Time left until a reset, compact: "10m", "3h12m", "2d5h".
const formatLeft = (ms: number): string => {
  const mins = Math.max(1, Math.ceil(ms / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return mins % 60 ? `${h}h${mins % 60}m` : `${h}h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d}d${h % 24}h` : `${d}d`
}

// One limit as the band reads it: its percent, the share of its time gone, and the time left.
type View = { label: string; name: string; used: number | null; elapsed: number | null; left: string | null; color: string }

const viewOf = (u: Usage, key: Key, color: string): View => {
  const used = u[key] ?? null
  const resetsAt = key === 'fiveHour' ? u.fiveHourResetsAt : u.sevenDayResetsAt
  const now = u.now ?? null
  const timed = used !== null && resetsAt != null && now !== null && resetsAt > now
  return {
    label: key === 'fiveHour' ? '5h' : '7d',
    name: key === 'fiveHour' ? '5-hour' : '7-day',
    used: used === null ? null : Math.round(clamp(used)),
    elapsed: timed ? Math.round(clamp(100 * (1 - (resetsAt - now) / WINDOW_MS[key]))) : null,
    left: timed ? formatLeft(resetsAt - now) : null,
    color
  }
}

const pctText = (v: View) => (v.used === null ? '--' : `${v.used}%`)
const words = (v: View, short: boolean) =>
  v.left === null ? '' : `${v.elapsed}% ${short ? 'gone' : 'of time gone'} · resets in ${v.left}`

// The two bars of one limit: usage (6px) over time gone (2px), 2px apart, both on a grey track.
const BAR_H = 10
const barsSvg = (v: View, w: number) => {
  const usedW = v.used === null ? 0 : Math.max(v.used > 0 ? 3 : 0, (v.used / 100) * w)
  const timeW = v.elapsed === null ? 0 : (v.elapsed / 100) * w
  const track = (y: number, h: number) =>
    `<rect y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${GREY}" fill-opacity="0.25"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${BAR_H}" width="${w}" height="${BAR_H}">` +
    track(0, 6) +
    (usedW > 0 ? `<rect width="${usedW.toFixed(1)}" height="6" rx="3" fill="${v.color}"/>` : '') +
    track(8, 2) +
    (timeW > 0 ? `<rect y="8" width="${timeW.toFixed(1)}" height="2" rx="1" fill="${GREY}" fill-opacity="0.9"/>` : '') +
    `</svg>`
  )
}

// Terminal: 10 dots, filled by percent, with a │ marker after the dots for the time gone.
const DOTS = 10
const dotCells = (v: View, ascii: boolean) => {
  const on = v.used === null ? 0 : Math.round(v.used / 10)
  const at = v.elapsed === null ? -1 : Math.min(DOTS, Math.floor(v.elapsed / 10))
  const cells: { ch: string; lit: boolean }[] = []
  for (let i = 0; i < DOTS; i++) {
    if (i === at) cells.push({ ch: ascii ? '|' : '│', lit: false })
    cells.push({ ch: i < on ? (ascii ? '#' : '●') : ascii ? '-' : '○', lit: i < on })
  }
  if (at === DOTS) cells.push({ ch: ascii ? '|' : '│', lit: false })
  // Without a marker the bar still takes 11 cells, so the line does not shift.
  if (at === -1) cells.push({ ch: ' ', lit: false })
  return cells
}

// How much of each limit's words the terminal line can carry: all, the countdown only, or none.
type Detail = 'full' | 'left' | 'none'
const termWords = (v: View, detail: Detail, sep: string) =>
  v.left === null || detail === 'none'
    ? ''
    : detail === 'full'
      ? `${sep}${v.elapsed}% gone${sep}${v.left}`
      : `${sep}${v.left}`
// Widest the words get ("100% gone", "23h59m"), so the 7d half does not move as the 5h countdown changes.
const WORDS_WIDTH: Record<Detail, number> = { full: 3 + 9 + 3 + 6, left: 3 + 6, none: 0 }
// "5h " + 11 bar cells + " 100%", then the words: the 5h half padded, a 4-space gap, the 7d half as it is.
const HEAD = 3 + 11 + 5
const lineWidth = (d: Detail, seven: View, sep: string) => HEAD + WORDS_WIDTH[d] + 4 + HEAD + termWords(seven, d, sep).length

export const register: Register = (on, options) => {
  const opts = options as Record<string, unknown>
  const tone = makePalette(opts)
  const ascii = opts.terminalGlyphs === 'ascii'

  on('session.start', async ($, e, next) => {
    const [snap, saved] = await Promise.all([$.session.usage(), savedLimits($)])
    const limits = snap.rateLimits.length > 0 ? snap.rateLimits : saved
    const now = await nowOr($, null)
    await update($, usage, () => toUsage(limits, empty, now))
    // Moves the countdowns on once a minute; a hot reload stops it and this hook starts a new one.
    $.clock.every(60000, async () => {
      const t = await nowOr($, null)
      if (t !== null) await update($, usage, prev => ({ ...prev, now: t }))
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const now = await nowOr($, null)
      await update($, usage, prev => toUsage(e.rateLimits, prev, now ?? prev.now ?? null))
      if (e.rateLimits.length > 0) await $.store.set(LIMITS_KEY, e.rateLimits).catch(() => {})
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const u = await read($, usage)
    const { Box, Text, Svg } = $.ui.resolve(e) as any
    // Every surface but the terminal draws in a proportional font and has Svg, so it gets the bars.
    const isGraphic = e.surface !== 'terminal' && !!Svg
    const views = [viewOf(u, 'fiveHour', tone('fiveHour', u.fiveHour)), viewOf(u, 'sevenDay', tone('sevenDay', u.sevenDay))]

    if (isGraphic) {
      // The phone stacks the two limits; the desktop keeps them on one row with a hairline between.
      const isPhone = e.surface === 'mobile'
      const W = isPhone ? 100 : 96
      // Each part of a limit gets its own gap, so the label, bars, percent and words don't run together.
      // The words are the short form: the full one ran the row into the card's edges.
      const limit = (v: View) => (
        <Box key={v.label} alignItems="center" flexShrink={0}>
          <Text dimColor>{v.label}</Text>
          <Box marginLeft={1}>
            <Svg
              source={barsSvg(v, W)}
              alt={`${v.name} limit: ${v.used === null ? 'no reading yet' : `${v.used}% used`}${v.left ? `, ${words(v, false)}` : ''}`}
              width={W}
              height={BAR_H}
            />
          </Box>
          <Box marginLeft={1}>
            <Text bold color={v.used === null ? undefined : v.color} dimColor={v.used === null}>
              {pctText(v)}
            </Text>
          </Box>
          {v.left ? (
            <Box marginLeft={1}>
              <Text dimColor>{words(v, true)}</Text>
            </Box>
          ) : null}
        </Box>
      )
      return isPhone ? (
        <Box width={e.props.bodyColumns} flexDirection="column" paddingX={1} paddingY={1}>
          {views.map(limit)}
        </Box>
      ) : (
        <Box width={e.props.bodyColumns} justifyContent="center" alignItems="center" paddingX={2} paddingY={1}>
          {limit(views[0])}
          <Box marginX={3} flexShrink={0}>
            <Text color="subtle">│</Text>
          </Box>
          {limit(views[1])}
        </Box>
      )
    }

    // Terminal: one line, centered; it drops "x% gone" and then the countdown when it does not fit.
    const cols = e.props.bodyColumns
    const sep = ascii ? '  ' : ' · '
    const fits = (d: Detail) => lineWidth(d, views[1], sep) <= cols
    const detail: Detail = fits('full') ? 'full' : fits('left') ? 'left' : 'none'
    const limit = (v: View, pad: boolean) => {
      const w = termWords(v, detail, sep)
      return (
        <Text key={v.label}>
          <Text dimColor>{v.label} </Text>
          {dotCells(v, ascii).map((c, i) =>
            c.lit ? (
              <Text key={i} color={v.color}>{c.ch}</Text>
            ) : (
              <Text key={i} dimColor>{c.ch}</Text>
            )
          )}
          <Text bold color={v.used === null ? undefined : v.color} dimColor={v.used === null}>
            {' '}
            {pctText(v).padStart(4)}
          </Text>
          <Text dimColor>{pad ? w.padEnd(WORDS_WIDTH[detail]) : w}</Text>
        </Text>
      )
    }
    return (
      <Box width={cols} justifyContent="center">
        {limit(views[0], true)}
        <Text>    </Text>
        {limit(views[1], false)}
      </Box>
    )
  })
}
