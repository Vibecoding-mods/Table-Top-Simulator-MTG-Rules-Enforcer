#!/usr/bin/env bash
# Maintainers only: rebuilds manabrew.patch and forge.patch from a working checkout (manabrew/ with forge/ inside it), by
# diffing inside a clean clone so the patches match upstream's bytes, whatever line endings the checkout has.
#   ENGINE_BUILD_DIR=<a clean tree made by build-images.sh> bash engine/make-patches.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${ENGINE_WORK_DIR:-$here/../manabrew}"
src="${ENGINE_BUILD_DIR:-$here/.build}"

refresh() { # <checkout> <clean tree> <patch>
  local files added
  git -C "$2" checkout -q -- .
  # (against the clean tree's commit, not the checkout's HEAD: our own local commits on top of upstream belong in the
  # patch too, 2026-11-06)
  files="$(git -C "$1" -c core.safecrlf=false diff --ignore-submodules=all --ignore-space-at-eol --name-only "$(git -C "$2" rev-parse HEAD)")"
  # new files too (EngineEventLog.java was left out of the first patches): copied with LF, then marked intent-to-add
  # so the diff shows them whole
  # (and files our local commits added, which the clean tree doesn't have either)
  added="$(git -C "$1" ls-files --others --exclude-standard; git -C "$1" diff --ignore-submodules=all --name-only --diff-filter=A "$(git -C "$2" rev-parse HEAD)")"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if git -C "$2" show "HEAD:$f" 2>/dev/null | head -c 65536 | grep -q $'\r'; then
      sed 's/\r$//; s/$/\r/' "$1/$f" > "$2/$f"
    else
      mkdir -p "$(dirname "$2/$f")"
      sed 's/\r$//' "$1/$f" > "$2/$f"
    fi
  done <<< "$files"$'\n'"$added"
  while IFS= read -r f; do [ -z "$f" ] || git -C "$2" add -N -- "$f"; done <<< "$added"
  git -C "$2" -c core.autocrlf=false diff --ignore-submodules=all > "$3"
  while IFS= read -r f; do [ -z "$f" ] || { git -C "$2" rm -q --cached -- "$f"; rm -f -- "$2/$f"; }; done <<< "$added"
  git -C "$2" checkout -q -- .
  echo "$3: $(grep -c '^diff --git' "$3") files"
}

refresh "$work/forge" "$src/forge" "$here/forge.patch"
refresh "$work" "$src" "$here/manabrew.patch"
