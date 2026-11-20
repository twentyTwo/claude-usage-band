export type Usage = {
  /** Percent used of the 5-hour and 7-day windows. */
  fiveHour: number | null
  sevenDay: number | null
  /** When each window resets, in epoch milliseconds. */
  fiveHourResetsAt: number | null
  sevenDayResetsAt: number | null
  /** The time the countdowns are measured from, moved on every minute. */
  now: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage }
  }
}
