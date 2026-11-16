#!/usr/bin/env bash
# Runs the forge-harness test classes without Docker: does by hand what build-images.sh and the self-hosted-node
# Dockerfile's "protocol-builder" and "java-builder" stages do, then compiles the tests and runs each class.
#   bash engine/test-harness-local.sh [TestClass ...]          (default: SharedTurnsTest TeamGameTest)
#   bash engine/test-harness-local.sh --all                     (every class under forge-harness/src/test/java)
# A plain name is forge.harness.host.<name>; give common.<name> (or any package under forge.harness) for the others.
# Settings (environment):
#   ENGINE_WORK_DIR  the patched Manabrew tree, Forge at <tree>/forge (default: ~/engine). Made when missing: both
#                    pinned commits fetched with core.autocrlf false, the patches applied, then committed locally
#                    ("patched") so later edits can be diffed.
#   REBUILD=1        rebuild the protocol classes and the harness jar even when the jar exists.
# Needs git, Rust stable (cargo), Node, a JDK (17 or newer) and Maven 3.9. Lines start with ok, FAIL or PASS.
# Exit status: 0 when every class passed.
# Notes from the first cloud run (2026-11):
# - JDK 21 builds and runs it fine (the image uses 17); the jar build takes about a minute on 4 CPUs, the protocol
#   generation about 30 s.
# - The Dockerfile's sed strips the desktop and mobile <module> lines from forge/pom.xml; done here on the file and
#   put back after the build, so the stripped pom never shows up in a patch.
# - The generated protocol classes go into forge-harness/src/main/java/forge/harness/protocol, which
#   forge-harness/.gitignore ignores, so they stay out of the patches.
# - The tests compile against the jar alone (it already holds the harness main classes); edited Forge files are
#   compiled over it by tools/l2-mutate.js --local.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${ENGINE_WORK_DIR:-$HOME/engine}"
MANABREW_REPO=https://github.com/witchesofthehill/manabrew.git
MANABREW_COMMIT=fd16e2fbaf31873cf7a8305a44911b77d277bef0
FORGE_REPO=https://github.com/witchesofthehill/forge.git
FORGE_COMMIT=e7d2b93ba9f800a1f5f3a5de91db1aad3ed46831
jar="$work/forge-harness/target/forge-harness-jar-with-dependencies.jar"

fetch_commit() { # <repo url> <commit> <folder>
  mkdir -p "$3"
  git -C "$3" init -q
  git -C "$3" config core.autocrlf false
  git -C "$3" remote remove origin 2>/dev/null || true
  git -C "$3" remote add origin "$1"
  git -C "$3" fetch -q --depth 1 origin "$2"
  git -C "$3" checkout -q --force FETCH_HEAD
}

if [ ! -d "$work/forge/forge-game" ]; then
  echo "== Manabrew $MANABREW_COMMIT into $work"
  fetch_commit "$MANABREW_REPO" "$MANABREW_COMMIT" "$work"
  rm -rf "$work/forge"
  echo "== Forge $FORGE_COMMIT"
  fetch_commit "$FORGE_REPO" "$FORGE_COMMIT" "$work/forge"
  git -C "$work" apply --whitespace=nowarn "$here/manabrew.patch"
  git -C "$work/forge" apply --whitespace=nowarn "$here/forge.patch"
  for d in "$work/forge" "$work"; do
    git -C "$d" add -A
    git -C "$d" -c user.name=local -c user.email=local@localhost commit -qm patched
  done
fi

if [ ! -f "$jar" ] || [ "${REBUILD:-0}" = 1 ]; then
  echo "== protocol classes"
  gen="$(mktemp -d)"
  (cd "$work" && cargo run -q -p manabrew-relay-protocol --bin gen-protocol -- src/protocol && node scripts/gen-harness-prompts.mjs "$gen")
  mkdir -p "$work/forge-harness/src/main/java/forge/harness/protocol"
  cp -r "$gen/forge/harness/protocol/." "$work/forge-harness/src/main/java/forge/harness/protocol/"
  rm -rf "$gen"
  echo "== harness jar"
  pom="$work/forge/pom.xml"
  cp "$pom" "$pom.orig"
  trap 'mv -f "$pom.orig" "$pom"' EXIT
  sed -i '/<module>forge-gui-mobile<\/module>/d; /<module>forge-gui-mobile-dev<\/module>/d; /<module>forge-gui-desktop<\/module>/d;
    /<module>forge-gui-ios<\/module>/d; /<module>forge-lda<\/module>/d; /<module>adventure-editor<\/module>/d;
    /<module>forge-gui-android<\/module>/d; /<module>forge-installer<\/module>/d' "$pom"
  (cd "$work" && MAVEN_OPTS="${MAVEN_OPTS:--Xmx2g}" mvn -pl forge-harness -am -DskipTests -Dcheckstyle.skip package -q)
  mv -f "$pom.orig" "$pom"
  trap - EXIT
fi

tests="$(mktemp -d)"
trap 'rm -rf "$tests"' EXIT
cd "$work"
javac -nowarn -encoding UTF-8 -proc:none -d "$tests" -cp "$jar" $(find forge-harness/src/test/java -name '*.java')
if [ "${1:-}" = --all ]; then
  set -- $(cd forge-harness/src/test/java/forge/harness && find . -name '*.java' | sed 's#^\./##; s#\.java$##; s#^host/##; s#/#.#g' | sort)
fi
[ $# -gt 0 ] || set -- SharedTurnsTest TeamGameTest
failed=""
for c in "$@"; do
  echo "=== $c"
  case "$c" in *.*) cls="forge.harness.$c" ;; *) cls="forge.harness.host.$c" ;; esac
  if timeout 900 java -cp "$tests:$jar" "$cls" > "$tests/$c.out" 2>&1; then echo "exit=0"; else echo "exit=$?"; failed="$failed $c"; fi
  grep -E '^(ok|FAIL|PASS) ' "$tests/$c.out" || tail -15 "$tests/$c.out"
done
if [ -n "$failed" ]; then echo "FAILED:$failed"; exit 1; fi
echo "PASSED: $*"
