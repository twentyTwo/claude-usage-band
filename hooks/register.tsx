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

// Time left, compact: "10m", "3h 06m", "2d 5h".
const formatLeft = (ms: number): string => {
  const mins = Math.max(1, Math.ceil(ms / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return mins % 60 ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${h}h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`
}

// A wall-clock time in the local zone: "1:48 PM".
const formatClock = (ms: number): string => {
  const t = new Date(ms)
  const h = t.getHours()
  return `${h % 12 || 12}:${String(t.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// The 5-hour limit's one line of small print: when it resets, when this pace fills it, or when it is back.
type Note = { kind: 'resets' | 'full' | 'back'; at: number; left: string } | null

// Below this the number is still green, and a forecast would be noise.
const FORECAST_FROM = 60

const noteOf = (used: number | null, resetsAt: number | null, now: number | null): Note => {
  if (used === null || resetsAt === null || now === null || resetsAt <= now) return null
  const left = formatLeft(resetsAt - now)
  if (used >= 100) return { kind: 'back', at: resetsAt, left }
  const spent = WINDOW_MS.fiveHour - (resetsAt - now)
  if (used >= FORECAST_FROM && spent > 0) {
    const fullAt = now + ((100 - used) * spent) / used
    if (fullAt < resetsAt) return { kind: 'full', at: fullAt, left }
  }
  return { kind: 'resets', at: resetsAt, left }
}

const noteText = (n: Note, long: boolean): string =>
  n === null
    ? ''
    : n.kind === 'back'
      ? `back at ${formatClock(n.at)}${long ? ` (in ${n.left})` : ''}`
      : n.kind === 'full'
        ? `${long ? 'at this pace, ' : ''}full by ~${formatClock(n.at)}`
        : `resets in ${n.left}`

// The 7-day limit against an even pace: where usage would be now if spread evenly over the week.
type Pace = 'under' | 'on' | 'ahead'
const paceOf = (used: number, expected: number): Pace =>
  used - expected > 2 ? 'ahead' : expected - used > 2 ? 'under' : 'on'
const PACE_WORDS: Record<Pace, string> = { under: 'Under pace', on: 'On pace', ahead: 'Ahead of pace' }
const paceTone = (p: Pace) => (p === 'ahead' ? FILL.amber : FILL.green)

type Five = { used: number | null; note: Note; color: string }
type Seven = { used: number | null; expected: number | null; pace: Pace | null; left: string | null; color: string }

const fiveOf = (u: Usage, fixed: string | null): Five => {
  const used = u.fiveHour == null ? null : Math.round(clamp(u.fiveHour))
  return {
    used,
    note: noteOf(used, u.fiveHourResetsAt ?? null, u.now ?? null),
    color: used === null ? GREY : (fixed ?? levelTone(used))
  }
}

const sevenOf = (u: Usage, fixed: string | null): Seven => {
  const used = u.sevenDay == null ? null : Math.round(clamp(u.sevenDay))
  const resetsAt = u.sevenDayResetsAt ?? null
  const now = u.now ?? null
  const timed = used !== null && resetsAt !== null && now !== null && resetsAt > now
  const expected = timed ? Math.round(clamp(100 * (1 - (resetsAt! - now!) / WINDOW_MS.sevenDay))) : null
  const pace = used !== null && expected !== null ? paceOf(used, expected) : null
  // The level colors the number; being ahead of pace lifts green to amber.
  const level = levelTone(used)
  const color = used === null ? GREY : (fixed ?? (pace === 'ahead' && level === FILL.green ? FILL.amber : level))
  return { used, expected, pace, left: timed ? formatLeft(resetsAt! - now!) : null, color }
}

const pctText = (n: number | null) => (n === null ? '--' : `${n}%`)

// The 7-day bar: usage on a grey track, and a tall tick where an even pace would be by now.
const BAR_H = 18
const sevenSvg = (s: Seven, w: number) => {
  const usedW = s.used === null ? 0 : Math.max(s.used > 0 ? 4 : 0, (s.used / 100) * w)
  const x = s.expected === null ? null : Math.min(w - 2, Math.max(2, (s.expected / 100) * w))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${BAR_H}" width="${w}" height="${BAR_H}">` +
    `<rect y="5" width="${w}" height="8" rx="4" fill="${GREY}" fill-opacity="0.25"/>` +
    (usedW > 0 ? `<rect y="5" width="${usedW.toFixed(1)}" height="8" rx="4" fill="${s.color}"/>` : '') +
    // A mid grey that reads on light and dark: the drawing cannot know the theme behind it.
    (x === null ? '' : `<rect x="${(x - 1.5).toFixed(1)}" width="3" height="${BAR_H}" rx="1.5" fill="#9aa0a8"/>`) +
    `</svg>`
  )
}

// The 5-hour number, drawn rather than typeset: Text sizes are hints each surface maps its own way,
// and the big number has to be big everywhere. Right-aligned in a fixed box so "9%" and "100%" line up.
const BIG_W = 92
const BIG_H = 36
const bigSvg = (text: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BIG_W} ${BIG_H}" width="${BIG_W}" height="${BIG_H}">` +
  `<text x="${BIG_W}" y="30" text-anchor="end" font-family="Inter, 'Segoe UI', system-ui, -apple-system, sans-serif" ` +
  `font-size="34" font-weight="800" letter-spacing="-1" style="font-variant-numeric: tabular-nums" fill="${color}">${text}</text>` +
  `</svg>`

const sevenAlt = (s: Seven) =>
  `7-day limit: ${s.used === null ? 'no reading yet' : `${s.used}% used`}` +
  (s.expected !== null && s.pace ? `, ${s.expected}% expected by now, ${PACE_WORDS[s.pace].toLowerCase()}` : '') +
  (s.left ? `, resets in ${s.left}` : '')

// Terminal: 16 cells for the 7-day bar, with a │ dropped in where an even pace would be.
const CELLS = 16
type Cell = { ch: string; kind: 'lit' | 'dim' | 'mark' }
const sevenCells = (s: Seven, ascii: boolean): Cell[] => {
  const on = s.used === null ? 0 : Math.round((s.used * CELLS) / 100)
  const at = s.expected === null ? -1 : Math.min(CELLS, Math.round((s.expected * CELLS) / 100))
  const mark: Cell = { ch: ascii ? '|' : '│', kind: 'mark' }
  const cells: Cell[] = []
  for (let i = 0; i < CELLS; i++) {
    if (i === at) cells.push(mark)
    cells.push(i < on ? { ch: ascii ? '#' : '█', kind: 'lit' } : { ch: ascii ? '-' : '░', kind: 'dim' })
  }
  if (at === CELLS) cells.push(mark)
  // Without a marker the bar still takes 17 cells, so the line does not shift.
  if (at === -1) cells.push({ ch: ' ', kind: 'dim' })
  return cells
}

const glyph = (p: Pace, ascii: boolean) => (p === 'ahead' ? (ascii ? '!' : '⚠') : ascii ? 'ok' : '✓')

// How much the terminal line carries: everything, the 5h note without "expected n%", or the numbers alone.
// The pace verdict is never dropped.
type Detail = 'full' | 'short' | 'none'
// Widest the 5h note gets ("full by ~12:59 PM"), so the 7-day half does not move as the note changes.
const NOTE_W = 17
const sevenTail = (s: Seven, d: Detail, ascii: boolean) => {
  if (s.pace === null || s.expected === null) return ''
  const g = glyph(s.pace, ascii)
  return d === 'full' ? `${ascii ? '  ' : ' · '}expected ${s.expected}% ${g}` : ` ${g}`
}
// "5h " + " 22%", the note, "  │  ", then "7d " + 17 cells + " " + " 31%" and the tail.
const lineWidth = (d: Detail, s: Seven, ascii: boolean) =>
  3 + 4 + (d === 'none' ? 0 : 1 + NOTE_W) + 5 + 3 + (CELLS + 1) + 1 + 4 + sevenTail(s, d, ascii).length

export const register: Register = (on, options) => {
  const opts = options as Record<string, unknown>
  const fixedMode = opts.colorMode === 'fixed'
  const fixedFive = fixedMode ? String(opts.fiveHourColor || '#f85149') : null
  const fixedSeven = fixedMode ? String(opts.sevenDayColor || '#2da44e') : null
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
    const five = fiveOf(u, fixedFive)
    const seven = sevenOf(u, fixedSeven)

    // Every surface but the terminal draws in a proportional font and has Svg.
    if (e.surface !== 'terminal' && Svg) {
      const isPhone = e.surface === 'mobile'
      const note = noteText(five.note, true)

      // 5-hour: it moves fast, so one big number to read in a blink, with one line of small print.
      const fiveBlock = (
        <Box key="5h" alignItems="center" flexShrink={0} gap="md">
          <Svg
            source={bigSvg(pctText(five.used), five.color)}
            alt={five.used === null ? '5-hour limit: no reading yet' : `${five.used}% of the 5-hour limit used`}
            width={BIG_W}
            height={BIG_H}
          />
          <Box flexDirection="column">
            <Text weight="semibold">5-hour limit used</Text>
            {note ? (
              <Text size="footnote" dimColor>
                {note}
              </Text>
            ) : null}
          </Box>
        </Box>
      )

      const verdict =
        seven.pace !== null && seven.expected !== null ? (
          <Text size="footnote">
            <Text dimColor>{isPhone ? 'expected ' : 'Expected by now: '}</Text>
            <Text weight="semibold">{`${seven.expected}%`}</Text>
            {isPhone ? null : <Text dimColor> · </Text>}
            {isPhone ? null : (
              <Text weight="semibold" color={paceTone(seven.pace)}>
                {PACE_WORDS[seven.pace]}
              </Text>
            )}
          </Text>
        ) : null

      // 7-day: it moves slowly, so a bar with a tick for an even pace says whether the week is on track.
      const W = isPhone ? 260 : 220
      const sevenBlock = (
        <Box key="7d" flexDirection="column" gap="xs" flexShrink={0}>
          <Box alignItems="center" gap="sm">
            <Text weight="semibold">{isPhone ? '7-day' : '7-day limit'}</Text>
            <Text
              weight="bold"
              tabular
              color={seven.used === null ? undefined : seven.color}
              dimColor={seven.used === null}
            >
              {seven.used === null ? '--' : `${seven.used}% used`}
            </Text>
            <Box flexGrow={1} />
            {isPhone ? verdict : seven.left ? (
              <Text size="footnote" dimColor>
                {`resets in ${seven.left}`}
              </Text>
            ) : null}
          </Box>
          <Svg source={sevenSvg(seven, W)} alt={sevenAlt(seven)} width={W} height={BAR_H} />
          {isPhone ? null : verdict}
        </Box>
      )

      return isPhone ? (
        <Box width={e.props.bodyColumns} flexDirection="column" gap="sm" paddingX={1} paddingY={1}>
          {fiveBlock}
          {sevenBlock}
        </Box>
      ) : (
        <Box width={e.props.bodyColumns} justifyContent="center" alignItems="center" paddingX={2} paddingY="sm">
          {fiveBlock}
          <Box marginX={3} flexShrink={0}>
            <Text color="subtle">│</Text>
          </Box>
          {sevenBlock}
        </Box>
      )
    }

    // Terminal: one line, centered. A narrow one drops "expected n%", then the 5h note, never the verdict.
    const cols = e.props.bodyColumns
    const fits = (d: Detail) => lineWidth(d, seven, ascii) <= cols
    const detail: Detail = fits('full') ? 'full' : fits('short') ? 'short' : 'none'
    const note = detail === 'none' ? null : ` ${noteText(five.note, false)}`.padEnd(1 + NOTE_W)
    const pct = (n: number | null, color: string) => (
      <Text bold color={n === null ? undefined : color} dimColor={n === null}>
        {pctText(n).padStart(4)}
      </Text>
    )
    return (
      <Box width={cols} justifyContent="center">
        <Text>
          <Text dimColor>5h </Text>
          {pct(five.used, five.color)}
          {note === null ? null : <Text dimColor>{note}</Text>}
          <Text dimColor>{ascii ? '  |  ' : '  │  '}</Text>
          <Text dimColor>7d </Text>
          {sevenCells(seven, ascii).map((c, i) =>
            c.kind === 'lit' ? (
              <Text key={i} color={seven.color}>
                {c.ch}
              </Text>
            ) : c.kind === 'mark' ? (
              <Text key={i} bold>
                {c.ch}
              </Text>
            ) : (
              <Text key={i} dimColor>
                {c.ch}
              </Text>
            )
          )}
          <Text> </Text>
          {pct(seven.used, seven.color)}
          {seven.pace === null ? null : <Text color={paceTone(seven.pace)}>{sevenTail(seven, detail, ascii)}</Text>}
        </Text>
      </Box>
    )
  })
}
