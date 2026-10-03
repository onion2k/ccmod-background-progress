# ccprogress

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview)
that puts one row above the prompt saying what the session is doing:

```
agents 1/2 · tasks 1 · plan tidy-plan ████████████░░░░░░░░░░░░ 2/4  Hide
```

- **agents**: subagents running, over all the session has spawned.
- **tasks**: background tasks in flight that are not agents: shells,
  monitors, workflows.
- **plan**: how far the session's plan has got, as a bar over its checklist.

The band draws only when there is something to say. With no agent, no task
and no plan it stays out of the way.

## Install

Clone it and point a session at the folder:

```bash
git clone https://github.com/onion2k/ccmod-background-progress.git
claude --plugin-dir ./ccmod-background-progress
```

For the desktop app, which takes no flags, name the folder in the
environment instead:

```bash
export CLAUDE_CODE_PLUGIN_DIRS=/path/to/ccmod-background-progress
```

Edits to the folder hot-reload in an interactive session.

## Use

- `/ccprogress` shows or hides the band.
- The **Hide** button on the row hides it; `/ccprogress` brings it back.
- Both survive a hot reload and a resume: the band's values live in the
  engine's session state, not the module.

## How it knows

| Figure | Source |
| --- | --- |
| agents | `$.agent.list()`, polled every two seconds and after each tool call |
| tasks | up on a `Bash` call with `run_in_background`, down on `TaskStop` and on a task notification, set exactly from the engine's own list at the end of every turn |
| plan | the file `ExitPlanMode` answers with, or the last `.md` written or edited under `~/.claude/plans/`; progress is ticked `- [x]` items over all checkboxes |

Between turns the task count can drift by one; the end of the turn puts it
right. A plan with no checklist shows "no checklist" rather than a figure.

## Develop

```bash
./check.sh
```

That validates the manifest and module with the engine, runs the tests
against the engine itself on the terminal and desktop surfaces, and
type-checks with TypeScript. It needs the Claude Code binary the desktop
app installs and Node for `npx`.

For editor types, run `/plugin-types` in a session with this folder as its
working directory: it writes the engine's declarations into
`.claude/types/`, which `tsconfig.json` includes and git ignores.

The layout, the constraints the engine holds a mod to, and the edge cases
are in [CLAUDE.md](CLAUDE.md).

## Licence

MIT.
