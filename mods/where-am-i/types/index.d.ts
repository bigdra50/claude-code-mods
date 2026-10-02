export type Recap = { goal: string; now: string; waiting: string; next: string }
export type RunningAgent = { id: string; description: string }

declare module 'claude-code' {
  interface PluginState {
    'where-am-i': { recap: Recap | null; live: string; agents: RunningAgent[] }
  }
}
