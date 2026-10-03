// The band through the engine: a session starts, agents and a background
// shell appear, a plan is written and ticked, and the band says so on the
// terminal and the desktop. Without this the mod is only believed to work.

import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { bar, countChecklist } from '../hooks/register'

const PLAN = '/Users/someone/.claude/plans/tidy-plan.md'
const BAND = {
  plugin: 'ccprogress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('countChecklist counts ticked and unticked boxes, nested or not', () => {
  const text = ['# Plan', '- [ ] one', '  - [x] two', '* [X] three', '- not a box', '[x] bare'].join('\n')
  expect(countChecklist(text)).toEqual({ done: 2, total: 3 })
  expect(countChecklist('no boxes')).toEqual({ done: 0, total: 0 })
})

test('bar fills in proportion and is all light with no checklist', () => {
  expect(bar(2, 4, 8)).toBe('████░░░░')
  expect(bar(0, 0, 4)).toBe('░░░░')
  expect(bar(3, 3, 5)).toBe('█████')
})

test('the band draws agents, tasks and the plan on every surface', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)

  let agents: AgentInfo[] = []
  let plan = '- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n'
  let mtimeMs = 1
  on('agent.list', () => ({ value: agents }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: plan.length, mtimeMs, isLink: false } }))
  on('fs.read', () => ({ value: plan }))
  on('session.id', () => ({ value: 'session-1' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  // The engine's own band when the mod passes: an empty Box, found by nothing.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-own" />
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.Stop', () => ({}))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    // Nothing is running and no plan is known yet: the band passes. After the
    // first pass the plan stays known, so it is only checked once.
    let ui = await $.ui.mount({ ...BAND, surface })
    if (surface === 'terminal') expect(await ui.find({ text: /agents/ })).toBeUndefined()
    await ui.unmount()

    agents = [
      { id: 'a1', description: 'reader', type: 'Explore', status: 'running' },
      { id: 'a2', description: 'builder', type: 'builder', status: 'completed' },
    ]
    await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'sleep 9', run_in_background: true })
    await $.tool.call({ tool: 'Write', tool_use_id: 't2', file_path: PLAN, content: plan })
    await clock.advance(2000)

    ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ text: /agents 1\/2/ }))?.text).toMatch(/agents 1\/2/)
    expect((await ui.find({ text: /tasks 1/ }))?.text).toMatch(/tasks 1/)
    expect((await ui.find({ text: /tidy-plan/ }))?.text).toMatch(/tidy-plan/)
    expect((await ui.find({ text: /0\/4/ }))?.text).toMatch(/0\/4/)
    await ui.unmount()

    // Two items ticked and the shell finished: the bar moves and the task goes.
    plan = '- [x] a\n- [x] b\n- [ ] c\n- [ ] d\n'
    mtimeMs += 1
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await clock.advance(2000)

    ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ text: /2\/4/ }))?.text).toMatch(/2\/4/)
    expect((await ui.find({ text: /tasks 0/ }))?.text).toMatch(/tasks 0/)
    expect((await ui.find({ text: /██/ }))?.text).toMatch(/█+░+/)

    // Hide takes the band away; the command brings it back.
    await ui.press({ key: 'hide' })
    await ui.redraw()
    expect(await ui.find({ text: /agents/ })).toBeUndefined()
    await ui.unmount()
    await $.command.run({
      command: 'ccprogress',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })
    ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /agents/ })).toBeDefined()
    await ui.unmount()

    // Back to the start for the next surface.
    agents = []
    plan = '- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n'
    mtimeMs += 1
  }
})
