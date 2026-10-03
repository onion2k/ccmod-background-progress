// The values ccprogress keeps in the session's state, so a hot reload and a
// resume draw the same band. Without this contract `claude plugin validate`
// refuses every `$.state` key the module names.

export type PlanProgress = {
  /** The plan file, absolute. */
  path: string
  /** Its name without the `.md`, as the band labels it. */
  name: string
  /** Checklist items ticked (`- [x]`). */
  done: number
  /** Checklist items in all (`- [ ]` and `- [x]`). */
  total: number
  /** The file's mtime when it was last counted, so an unchanged file is not read again. */
  mtimeMs: number
}

export type Progress = {
  agentsRunning: number
  agentsTotal: number
  /** Background tasks in flight that are not agents: shells, monitors, workflows. */
  tasks: number
  plan: PlanProgress | null
}

declare module 'claude-code' {
  interface PluginState {
    ccprogress: { progress: Progress; isHidden: boolean }
  }
}
