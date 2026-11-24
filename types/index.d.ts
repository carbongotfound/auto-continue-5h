/** A continue waiting for the reset. `built-in`: Claude Code's own auto-continue took this one, so the mod stays quiet. */
export type Wake = { at: number; by: 'mod' | 'built-in' }

declare module 'claude-code' {
  interface PluginState {
    'auto-continue-5h': { wake: Wake | null }
  }
}
