#!/usr/bin/env bash
# Maintainers only: rebuilds manabrew.patch and forge.patch from a working checkout (manabrew/ with forge/ inside it), by
# diffing inside a clean clone so the patches match upstream's bytes, whatever line endings the checkout has.
#   ENGINE_BUILD_DIR=<a clean tree made by build-images.sh> bash engine/make-patches.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${ENGINE_WORK_DIR:-$here/../manabrew}"
src="${ENGINE_BUILD_DIR:-$here/.build}"

refresh() { # <checkout> <clean tree> <patch> [pathspec excluded]
  local files
  git -C "$2" checkout -q -- .
  files="$(git -C "$1" -c core.safecrlf=false diff --ignore-submodules=all --ignore-space-at-eol --name-only)"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if git -C "$2" show "HEAD:$f" | head -c 65536 | grep -q $'\r'; then
      sed 's/\r$//; s/$/\r/' "$1/$f" > "$2/$f"
    else
      sed 's/\r$//' "$1/$f" > "$2/$f"
    fi
  done <<< "$files"
  git -C "$2" -c core.autocrlf=false diff --ignore-submodules=all > "$3"
  git -C "$2" checkout -q -- .
  echo "$3: $(grep -c '^diff --git' "$3") files"
}

refresh "$work/forge" "$src/forge" "$here/forge.patch"
refresh "$work" "$src" "$here/manabrew.patch"
