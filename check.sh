#!/bin/sh
# The full check: the engine validates the manifest and module, runs the
# tests against itself, and TypeScript type-checks the module. Without it a
# change is believed to work. Uses the newest Claude Code the desktop app
# installed, since the app puts no `claude` on the PATH.
set -e
here=$(cd "$(dirname "$0")" && pwd)
versions="$HOME/Library/Application Support/Claude/claude-code"
binary=$(ls -d "$versions"/*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -V | tail -1)
[ -x "$binary" ] || { echo "no Claude Code under $versions" >&2; exit 1; }
"$binary" plugin validate "$here"
"$binary" plugin test "$here"
cd "$here" && npx -y -p typescript@5 tsc -p tsconfig.json && echo "tsc clean"
