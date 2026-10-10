export type Slice = { key: string; tokens: number }

export type Usage = {
  context: number | null
  fiveHour: number | null
  sevenDay: number | null
  tokens: number | null
  window: number | null
  detail: Slice[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage }
  }
}
