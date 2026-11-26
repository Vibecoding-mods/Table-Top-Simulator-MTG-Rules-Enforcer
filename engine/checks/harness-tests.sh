#!/bin/sh
# The harness unit tests, run in a throwaway container: recompiles forge-harness's main and test sources (mounted
# read-only at /src) against the Forge jar of a java-builder image, then runs each test class.
#   docker build --target java-builder -f <tree>/manabrew-rs/crates/self-hosted-node/Dockerfile -t mtg-harness-test:<tag> <tree>
#   MSYS_NO_PATHCONV=1 docker run --rm -v "<tree>/forge-harness:/src:ro" -v "<this file>:/harness-tests.sh:ro" \
#     --entrypoint sh mtg-harness-test:<tag> /harness-tests.sh [TestClass ...]
# The image is only needed again when Forge's own Java changes: harness sources are compiled fresh on every run, so an
# image older than a new harness class or test still works. ManaBrewEngineAdapterTest and
# InteractiveSnapshotExtractorTest print nothing when they pass; every class fails by its exit status.
# The golden-master classes (GoldenFileTest's users: ProtocolGoldenTest, SnapshotGoldenTest) compare against
# forge-harness/src/test/resources/golden. To re-record them after a deliberate behaviour change, mount a writable
# folder and name it: -v "<dir>:/out" -e GOLDEN_WRITE=/out ... /harness-tests.sh ProtocolGoldenTest SnapshotGoldenTest,
# then copy the files into the tree and read the diff before keeping it.
# Exit status: 0 when every class passed. tools/deploy.js runs it with no class named and stops when any *Test.java
# under forge-harness/src/test is missing from the list below (tests/test_deploy.js checks that rule).
set -e
jar=/build/forge-harness/target/forge-harness-jar-with-dependencies.jar
rm -rf /tmp/main /tmp/test
mkdir -p /tmp/main /tmp/test
find /src/src/main/java -name '*.java' > /tmp/main.txt
find /build/forge-harness/src/main/java/forge/harness/protocol -name '*.java' >> /tmp/main.txt
javac -nowarn -encoding UTF-8 -proc:none -d /tmp/main -cp "$jar" @/tmp/main.txt
find /src/src/test/java -name '*.java' > /tmp/test.txt
javac -nowarn -encoding UTF-8 -proc:none -d /tmp/test -cp "/tmp/main:$jar" @/tmp/test.txt
cd /build
[ $# -gt 0 ] || set -- MindslaverControlTest ExtraTurnRewindTest OptionalCardChoiceTest ManaBrewEngineAdapterTest \
  InteractiveSnapshotExtractorTest MayPlayVisibilityTest PassiveAiTest ApplyStateCreateCardTest AttackDefenderChoiceTest \
  ApplyStateDrawMillTest DungeonStateTest PlanechaseTest CardStateFlagsTest EffectsViewTest EngineEventDamageTest \
  TeamGameTest RejoinRewindTest PlayerRulesTest DrawCountRewindTest TurnCounterRewindTest SharedTurnsTest \
  SharedTurnsDevTest SharedCombatTest SharedTurnsPlayTest ArchenemyTest ArchenemySchemeSweepTest ArchenemyViewTest \
  FirstPlayerTest CardStateRewindTest BigTurnsTest ThreeHeadedGiantTest ProtocolDefaultsTest AttackTaxLethalTest \
  SnapshotSpeedTest StressCapsTest ReplacementIndexTest TieOfferTest UnboundedTokensTest HeldPassResponseTest CostBadgeTest \
  BigBoardFixesTest TeamChoiceTest LongTailTest common.GiftTargetsTest AutoPayBudgetTest BigTurnTimingTest \
  BlockBudgetTest DependencyScanTest ManaSourcesTest OpeningHandTest SnapshotViewersTest StaticPassTest TokenBatchTest TriggerBatchTest \
  common.ActionSpaceTest common.HarnessPlayPlumbingTest \
  GoldenFileTest ProtocolGoldenTest SnapshotGoldenTest
failed=""
for c in "$@"; do
  echo "=== $c"
  # (a name with a package, common.GiftTargetsTest, is under forge.harness; a plain one under forge.harness.host)
  case "$c" in *.*) cls="forge.harness.$c" ;; *) cls="forge.harness.host.$c" ;; esac
  if timeout 900 java -cp "/tmp/test:/tmp/main:$jar" "$cls" ${GOLDEN_WRITE:+--write "$GOLDEN_WRITE"} > "/tmp/$c.out" 2>&1; then
    echo "exit=0"
  else
    echo "exit=$?"
    failed="$failed $c"
  fi
  grep -E '^(ok|FAIL|PASS) ' "/tmp/$c.out" || tail -15 "/tmp/$c.out"
done
if [ -n "$failed" ]; then
  echo "FAILED:$failed"
  exit 1
fi
echo "PASSED: $*"
