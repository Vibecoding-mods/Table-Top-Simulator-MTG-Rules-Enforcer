#!/usr/bin/env bash
# Builds the two engine images this project runs, from public source:
#   upstream Manabrew and Forge at pinned commits + the patches in this folder.
# About 20 minutes the first time; needs Docker, git and several GB of free disk.
#   bash engine/build-images.sh [tag]        (default tag: exile, the one stack/compose.yml uses)
set -euo pipefail

MANABREW_REPO=https://github.com/witchesofthehill/manabrew.git
MANABREW_COMMIT=fd16e2fbaf31873cf7a8305a44911b77d277bef0
FORGE_REPO=https://github.com/witchesofthehill/forge.git
FORGE_COMMIT=e7d2b93ba9f800a1f5f3a5de91db1aad3ed46831

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tag="${1:-exile}"
src="${ENGINE_BUILD_DIR:-$here/.build}"

fetch_commit() { # <repo url> <commit> <folder>
  mkdir -p "$3"
  git -C "$3" init -q
  git -C "$3" config core.autocrlf false
  git -C "$3" remote remove origin 2>/dev/null || true
  git -C "$3" remote add origin "$1"
  git -C "$3" fetch -q --depth 1 origin "$2"
  git -C "$3" checkout -q --force FETCH_HEAD
  git -C "$3" clean -qfdx
}

echo "== Manabrew $MANABREW_COMMIT"
fetch_commit "$MANABREW_REPO" "$MANABREW_COMMIT" "$src"
echo "== Forge $FORGE_COMMIT"
rm -rf "$src/forge"
fetch_commit "$FORGE_REPO" "$FORGE_COMMIT" "$src/forge"

echo "== Applying our patches"
git -C "$src" apply --whitespace=nowarn "$here/manabrew.patch"
git -C "$src/forge" apply --whitespace=nowarn "$here/forge.patch"

echo "== Building mtg-forge-node:$tag (the long one)"
docker build -f "$src/manabrew-rs/crates/self-hosted-node/Dockerfile" -t "mtg-forge-node:$tag" "$src"
echo "== Building mtg-relay:$tag"
docker build -f "$src/manabrew-rs/crates/manabrew-server/Dockerfile" -t "mtg-relay:$tag" "$src"
echo "== Done: mtg-forge-node:$tag and mtg-relay:$tag"
