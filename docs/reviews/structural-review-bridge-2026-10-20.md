# Structural Review: bridge/bridge.js

**Reviewed:** `bridge/bridge.js` (≈1,690 lines): seats and relay, table model, prompts → panel, gestures, TTS commands
**Date:** 2026-10-20 (jr-programmer-suite stage 1; findings auto-applied, gated by `node tests/test_bridge_golden.js`)

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 4 (2 not applied after a closer read) |
| LOW | 3 |

## Executive Summary
The bridge's shape mostly follows its domain: one translator per engine prompt type, one table model, one gesture
handler. What strains is the seat's *prompt lifecycle*: closing a question is spelled out by hand at eight places,
and the seat carries five loose fields for two small state machines (paying for a spell, auto-passing). Every recent
feature (copies of a card, bounce lands, sacrifice by drag, Resolve) added another hand-written copy or another field.
Card pictures are looked up four slightly different ways.

## Findings

### 1. HIGH · Parallel paths: closing an open question is hand-written at 8 call sites
**Location:** `onIntent` (play, tapmana, sacrifice ×3, card drags), `onAnswer`, `chooseAction` auto-pass.
**Current shape:** `seat.prompt = null; toTTS({ t: "prompt", color, promptId: null }); seat.respond(...)`, repeated.
**Standing in for:** one "close this question" operation on the seat.
**Signal:** 3 of the last 4 gesture features added a copy; one site (`tapmana`) inlines it in an arrow function.
**Cost of the next case:** today +3 lines and a chance to forget the TTS half (the panel then keeps a dead question);
restructured: one call.
**Restructuring (applied):** `closePrompt(seat)`; callers keep their own `respond` in the same order as before.

### 2. MEDIUM · State flags: paying for a spell is three loose fields
**Location:** `seat.autoPayCard`, `seat.tappedFor`, `seat.autoPayFailedFor` (payManaCost case, its toOutput, the
chooseAction reset).
**Looked like:** one payment record `{ card, stage }`.
**Not applied, on a closer read:** the fields are partly independent on purpose. "Auto-pay failed" must survive a
later hand tap (otherwise Auto-pay is offered again and loops), and `autoFailed` is cleared by any other prompt type
while the other two are not; a stale value for another card matters when one payment is nested in another. A single
stage enum would change behaviour. Kept as is; the three are documented together at the payManaCost case.

### 3. MEDIUM · State flags: two auto-pass modes as two fields
**Location:** `seat.endTurnAt`, `seat.resolveStack` (chooseAction).
**Looked like:** one `seat.autoPass` mode.
**Not applied:** choosing one does not cancel the other. "Resolve the stack" chosen earlier is still pending while
"End turn" holds, and takes effect again after the turn changes. Merging them would drop that. Kept as is.

### 4. MEDIUM · Parallel paths: a card's picture is looked up four ways
**Location:** `tableCard`, the stack in `sendTable`, `imgOf`, `onGameStarted`.
**Standing in for:** one `pictureOf(name)` (the table's own image, else the Scryfall cache).
**Restructuring (applied):** `pictureOf(name)`; `imgOf` and the stack use it.

### 5. MEDIUM · Parallel paths: "which mana?" built twice
**Location:** chooseAction's mana-creature step and the `tapmana` gesture; same label formula inline twice.
**Restructuring (applied):** `manaLabel(action)` shared.

### 6. LOW · Shadow state: `currentBlockers` is a module global read by `tableCard`
An implicit parameter set by `sendTable`; any other caller of `tableCard` (library search) silently reads the last
board's blockers. **Restructuring (applied):** blockers passed explicitly.

### 7. LOW · Shadow state: per-player turn counts are counted, not read
`trackTurns` counts a turn when `sendTable` sees the global turn number change. Forge has no per-player count, so
counting is the only source; it would miss a turn only if two turns passed inside one 40 ms coalescing window.
**Not applied** (no better source); named so the label "Blue's 6th turn" isn't taken as engine truth.

### 8. LOW · State flags: lobby latches on `game`
`maxSet`, `botsRequested`, `startSent` are independent one-shot latches that can legitimately all be true; not a
hidden state machine. **Not applied.**

## Out of scope
Correctness, safety and production readiness (stage 3, code-analysis-ruleset); redundancy (stage 2, simplify).
