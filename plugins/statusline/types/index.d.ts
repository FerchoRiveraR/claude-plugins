declare module 'claude-code' {
  interface PluginState {
    statusline: { tick: number; tab: 'status' | 'git' }
  }
}
