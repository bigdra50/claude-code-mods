export type HeldCommand = {
  id: string
  command: string
  risk: 'delete' | 'force-push' | 'migration'
  summary: string
  details: string[]
  where: 'pane' | 'band'
}

declare module 'claude-code' {
  interface PluginState {
    'blast-radius': { held: HeldCommand | null }
  }
}
