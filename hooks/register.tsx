// ccprogress: one row above the prompt saying how many agents are running,
// how many background tasks are in flight, and how far the session's plan
// has got, as a bar over its checklist. Without it those three live in the
// tasks list, the transcript and a file under ~/.claude/plans, none in view
// while typing.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, FsStat, Register } from 'claude-code'

import type { PlanProgress, Progress } from '../types'

const EMPTY: Progress = { agentsRunning: 0, agentsTotal: 0, tasks: 0, plan: null }

const progress = atom({ plugin: 'ccprogress', key: 'progress' } as const, EMPTY)
const isHidden = atom({ plugin: 'ccprogress', key: 'isHidden' } as const, false)

// A plan lives under this folder, and a Write or Edit into it names the plan
// this session is building to.
const PLANS_DIR = '/.claude/plans/'
// How often the agent list and the plan file are looked at between events.
const POLL_MS = 2000
// The bar is this wide at most, and never narrower than the small figure.
const BAR_MAX = 24
const BAR_MIN = 8

const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]/

// Counts a plan's checklist: every `- [ ]` or `- [x]` line, however it is
// nested. A plan with no checklist counts as zero of zero and the band says
// so rather than inventing a figure.
export function countChecklist(text: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const line of text.split('\n')) {
    const m = CHECKBOX.exec(line)
    if (!m) continue
    total += 1
    if (m[1] !== ' ') done += 1
  }
  return { done, total }
}

// Draws the bar as glyphs: filled cells for what is done, light cells for
// the rest, so it reads the same on the terminal and the desktop.
export function bar(done: number, total: number, width: number): string {
  if (total <= 0) return '░'.repeat(width)
  const filled = Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function planName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.endsWith('.md') ? base.slice(0, -3) : base
}

function isPlanPath(path: unknown): path is string {
  return typeof path === 'string' && path.includes(PLANS_DIR) && path.endsWith('.md')
}

function same(a: Progress, b: Progress): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// The engine's calls the band needs, as thunks made where `$` is in hand:
// the engine refuses a module that passes `$` itself around.
type Host = {
  agents: () => Promise<AgentInfo[]>
  stat: (path: string) => Promise<FsStat>
  readFile: (path: string) => Promise<string>
  get: () => Promise<Progress>
  set: (next: Progress) => Promise<unknown>
  keep: (path: string) => Promise<void>
}

export const register: Register = on => {
  // The count of background tasks between turns comes from what was started
  // and stopped; `classic.Stop` puts it right from the engine's own list at
  // the end of every turn.
  let tasks = 0
  let planPath: string | null = null
  let host: Host | null = null
  let refreshing: Promise<void> | null = null

  async function countPlan(h: Host, previous: PlanProgress | null): Promise<PlanProgress | null> {
    if (!planPath) return null
    try {
      const stat = await h.stat(planPath)
      if (previous && previous.path === planPath && previous.mtimeMs === stat.mtimeMs) return previous
      const text = await h.readFile(planPath)
      const { done, total } = countChecklist(text)
      return { path: planPath, name: planName(planPath), done, total, mtimeMs: stat.mtimeMs }
    } catch {
      // The plan file has gone, or cannot be read: the band stops claiming it.
      return null
    }
  }

  // Looks again at everything the band shows and writes the state only when
  // something moved, so an idle session redraws nothing. A refusal (the
  // module unloading under a timer) is swallowed: there is nothing to draw to.
  function refresh(): Promise<void> {
    const h = host
    if (!h) return Promise.resolve()
    if (refreshing) return refreshing
    refreshing = (async () => {
      try {
        const agents = await h.agents()
        const previous = await h.get()
        const next: Progress = {
          agentsRunning: agents.filter(a => a.status === 'running').length,
          agentsTotal: agents.length,
          tasks,
          plan: await countPlan(h, previous.plan),
        }
        if (!same(previous, next)) await h.set(next)
      } catch {
        // See above: nothing to draw to.
      } finally {
        refreshing = null
      }
    })()
    return refreshing
  }

  async function setPlan(path: string): Promise<void> {
    if (planPath === path) return
    planPath = path
    if (host) await host.keep(path)
  }

  on('session.start', async ($, e, next) => {
    const storeKey = `plan:${await $.session.id()}`
    host = {
      agents: () => $.agent.list(),
      stat: path => $.fs.stat(path),
      readFile: path => $.fs.read(path),
      get: () => read($, progress),
      set: value => update($, progress, () => value),
      keep: path => $.store.set(storeKey, path),
    }
    const kept = await $.store.get(storeKey)
    if (isPlanPath(kept)) planPath = kept

    await $.command.register({
      name: 'ccprogress',
      description: 'Show or hide the progress band above the prompt',
    })

    $.clock.every(POLL_MS, () => {
      void refresh()
    })
    void refresh()

    return next(e)
  })

  on('command.run', { command: 'ccprogress' }, async $ => {
    const hidden = await read($, isHidden)
    await update($, isHidden, () => !hidden)
    return { text: hidden ? 'Progress band shown.' : 'Progress band hidden. /ccprogress shows it again.' }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Bash' && e.run_in_background) tasks += 1

    const result = await next(e)

    if (e.tool === 'TaskStop' && !result.deny) tasks = Math.max(0, tasks - 1)
    if (e.tool === 'ExitPlanMode' && result.result && !result.isError) {
      const filePath = (result.result as { filePath?: unknown }).filePath
      if (isPlanPath(filePath)) await setPlan(filePath)
    }
    if ((e.tool === 'Write' || e.tool === 'Edit') && isPlanPath(e.file_path)) {
      await setPlan(e.file_path)
    }

    void refresh()
    return result
  })

  // A task's notification means one fewer in flight; an agent's is counted
  // by the agent list instead, and `classic.Stop` settles any drift.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification' && /shell|command|monitor|workflow/i.test(e.text)) {
      tasks = Math.max(0, tasks - 1)
    }
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    const list = e.background_tasks ?? []
    tasks = list.filter(t => t.type !== 'subagent').length
    void refresh()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, progress)
    const quiet =
      e.props.hasSurvey ||
      (await read($, isHidden)) ||
      (p.agentsTotal === 0 && p.tasks === 0 && p.plan === null)
    if (quiet) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    const agentsText = `agents ${p.agentsRunning}/${p.agentsTotal}`
    const tasksText = `tasks ${p.tasks}`
    const plan = p.plan
    const planLabel = plan ? `plan ${plan.name} ` : ''
    const planFigure = plan ? (plan.total > 0 ? ` ${plan.done}/${plan.total}` : ' no checklist') : ''
    // What is left for the bar once the words, separators and the button sit on the row.
    const fixed = agentsText.length + 3 + tasksText.length + 3 + planLabel.length + planFigure.length + 10
    const barWidth = Math.max(BAR_MIN, Math.min(BAR_MAX, e.props.bodyColumns - fixed))

    return (
      <Box gap={1}>
        <Text color={p.agentsRunning > 0 ? 'green' : undefined} dimColor={p.agentsRunning === 0}>
          {agentsText}
        </Text>
        <Text dimColor>·</Text>
        <Text bold={p.tasks > 0} dimColor={p.tasks === 0}>
          {tasksText}
        </Text>
        {plan ? <Text dimColor>·</Text> : null}
        {plan ? (
          <Text>
            <Text dimColor>{planLabel}</Text>
            <Text color={plan.total > 0 && plan.done === plan.total ? 'green' : 'cyan'}>
              {bar(plan.done, plan.total, barWidth)}
            </Text>
            <Text dimColor>{planFigure}</Text>
          </Text>
        ) : null}
        <Button key="hide" label="Hide" hotkey="h" plain onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
