#!/bin/sh
# Container side of tools/l2-mutate.js (runs inside a mtg-harness-test image): compiles the changed Forge files (paths
# in /forgelist.txt, under /forge), the harness and its tests once, then for each mutation /mut/<name>/ compiles the
# mutated Forge files found there over the build and runs the test class, printing its ok/FAIL lines under "### <name>".
set -e
jar=/build/forge-harness/target/forge-harness-jar-with-dependencies.jar
test_class="$1"
rm -rf /tmp/forge /tmp/main /tmp/test /tmp/mut
mkdir -p /tmp/forge /tmp/main /tmp/test /tmp/mut
sed 's#^#/forge/#' /forgelist.txt > /tmp/forge.txt
javac -nowarn -encoding UTF-8 -proc:none -d /tmp/forge -cp "$jar" @/tmp/forge.txt
cp=/tmp/forge:$jar
find /src/src/main/java -name '*.java' > /tmp/main.txt
find /build/forge-harness/src/main/java/forge/harness/protocol -name '*.java' >> /tmp/main.txt
javac -nowarn -encoding UTF-8 -proc:none -d /tmp/main -cp "$cp" @/tmp/main.txt 2>/dev/null
find /src/src/test/java -name '*.java' > /tmp/test.txt
javac -nowarn -encoding UTF-8 -proc:none -d /tmp/test -cp "/tmp/main:$cp" @/tmp/test.txt 2>/dev/null
cd /build
for m in /mut/*/; do
  name=$(basename "$m")
  echo "### $name"
  mkdir -p "/tmp/mut/$name"
  find "$m" -name '*.java' > "/tmp/mut/$name.txt"
  if [ -s "/tmp/mut/$name.txt" ] && ! javac -nowarn -encoding UTF-8 -proc:none -d "/tmp/mut/$name" -cp "$cp" @"/tmp/mut/$name.txt" > "/tmp/mut/$name.javac" 2>&1; then
    echo "COMPILE-ERROR"
    head -5 "/tmp/mut/$name.javac"
    continue
  fi
  timeout 900 java -cp "/tmp/mut/$name:/tmp/test:/tmp/main:$cp" "forge.harness.host.$test_class" 2>&1 | grep -E '^(ok|FAIL) ' || true
done
