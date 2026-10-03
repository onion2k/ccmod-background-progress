# ccprogress

A Claude Code mod: one row above the prompt showing how many agents are
running, how many background tasks are in flight, and how far the session's
plan has got as a bar over its checklist. Written for the mod API documented
at https://code.claude.com/docs/en/plugins/mods/overview.

## Layout

- `.claude-plugin/plugin.json`: the manifest, naming `types/index.d.ts`.
- `hooks/hooks.json`: names the one hooks module.
- `hooks/register.tsx`: the module. Pure helpers (`countChecklist`, `bar`)
  at the top, `register` beneath. Every value the band draws lives in
  `$.state`, never a module variable, so a hot reload keeps it.
- `types/index.d.ts`: the state contract (`ccprogress.progress`,
  `ccprogress.isHidden`).
- `tests/band.test.tsx`: the engine-run test, looped over the terminal and
  desktop surfaces.
- `.claude/types/`: the engine's own declarations, written by `/plugin-types`
  in a session. Regenerate after an engine update; ignored by git.

## Commands

- `./check.sh`: validate, test, type-check. This is the full check and the
  quick check; it takes a few seconds.
- Loading it in a session: `claude --plugin-dir <this folder>`, or
  `CLAUDE_CODE_PLUGIN_DIRS=<this folder>` for the desktop app.
- `/ccprogress` in a session toggles the band; its Hide button hides it.

## How it learns things

- Agents: `$.agent.list()`, polled every two seconds and after each tool call.
- Background tasks: counted up on a `Bash` call with `run_in_background`,
  down on `TaskStop` and on a task notification, and set from the engine's
  own list at every `classic.Stop`. Between turns the figure can drift by
  one; the turn's end puts it right.
- The plan: the file `ExitPlanMode` answers with, or the last `.md` written
  or edited under `~/.claude/plans/`, kept in `$.store` per session id.
  Progress is ticked `- [x]` items over all `- [ ]`/`- [x]` items; a plan
  with none says "no checklist".

## Constraints the engine holds

- `$` is only ever spelled `$.noun.method(...)`: never bound, passed or
  stored. Timers and helpers close over it through thunks made in
  `session.start` (the `Host` object).
- A tree the band returns must validate against the surface's element
  table, or the engine draws its own and says so in the transcript.

## Edge-case checklist

- No plan known: no plan segment, and the band hides when nothing else is
  live.
- Plan file deleted or unreadable: the plan segment goes, nothing throws.
- Band narrower than the words: the bar shrinks to eight cells, never below.
- A hot reload or resume: counts come back from `$.state` and the plan path
  from `$.store`.
