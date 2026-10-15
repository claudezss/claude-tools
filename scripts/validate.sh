#!/usr/bin/env bash
# Validate the marketplace and every mod/plugin in it; run each mod's tests.
set -euo pipefail

cd "$(dirname "$0")/.."

claude plugin validate .

for dir in mods/*/ plugins/*/; do
  [ -f "${dir}.claude-plugin/plugin.json" ] || continue
  echo
  claude plugin validate "$dir"
  if compgen -G "${dir}hooks/*.test.ts" > /dev/null || compgen -G "${dir}hooks/*.test.tsx" > /dev/null; then
    claude plugin test "$dir"
  fi
done
