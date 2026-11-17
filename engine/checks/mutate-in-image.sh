#!/bin/sh
# Break-it runner inside a harness test image (tools/mutate-engine-docker.js writes /mut). Compiles the harness once
# (Forge files that differ from the image's are compiled into an overlay ahead of the jar, as harness-tests.sh's overlay
# runner does), then for each /mut/mN: compiles only its mutated files over that build and runs its test class.
# mounts: /src = forge-harness (ro), /fsrc = forge tree (ro), /forge.patch (ro), /proto = generated protocol classes
# (optional), /mut (rw)
set -e
jar=/build/forge-harness/target/forge-harness-jar-with-dependencies.jar
rm -rf /tmp/ovl /tmp/main /tmp/test
mkdir -p /tmp/ovl /tmp/main /tmp/test
grep '^diff --git' /forge.patch | sed 's#^diff --git a/\([^ ]*\) .*#\1#' > /tmp/files.txt
: > /tmp/ovl.txt
while read -r f; do
  case "$f" in
    */src/main/java/*.java) cmp -s "/fsrc/$f" "/build/forge/$f" || echo "/fsrc/$f" >> /tmp/ovl.txt ;;
  esac
done < /tmp/files.txt
if [ -s /tmp/ovl.txt ]; then
  javac -nowarn -encoding UTF-8 -proc:none -d /tmp/ovl -cp "$jar" @/tmp/ovl.txt 2> /tmp/ovl.err || { cat /tmp/ovl.err; exit 1; }
fi
cp=/tmp/ovl:$jar
find /src/src/main/java -name '*.java' > /tmp/main.txt
[ -d /proto ] && find /proto -name '*.java' >> /tmp/main.txt
javac -nowarn -encoding UTF-8 -proc:none -d /tmp/main -cp "$cp" @/tmp/main.txt 2> /tmp/main.err || { cat /tmp/main.err; exit 1; }
find /src/src/test/java -name '*.java' > /tmp/test.txt
javac -nowarn -encoding UTF-8 -proc:none -d /tmp/test -cp "/tmp/main:$cp" @/tmp/test.txt 2> /tmp/test.err || { cat /tmp/test.err; exit 1; }
cd /build
for d in /mut/m*; do
  [ -d "$d" ] || continue
  cls=$(cat "$d/class")
  out=/tmp/$(basename "$d")
  mkdir -p "$out"
  if [ -d "$d/src" ]; then
    find "$d/src" -name '*.java' > "$out/files.txt"
    if ! javac -nowarn -encoding UTF-8 -proc:none -d "$out" -cp "/tmp/test:/tmp/main:$cp" @"$out/files.txt" > "$d/result" 2>&1; then
      echo "COMPILE ERROR" >> "$d/result"
      continue
    fi
  fi
  timeout 1500 java -Xmx3g -cp "$out:/tmp/test:/tmp/main:$cp" "forge.harness.host.$cls" $ARGS > "$d/result" 2>&1 || true
  echo "done $(basename "$d") $cls"
done
