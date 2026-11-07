# Arcade 2.9.0 verification

Canonical baseline: `20758a2240827bb83c4b03c12cb977309a7cb2dd` (2.8.7).
All 47 enabled entries remain in the catalog. The disabled Backyard Baseball
entry remains disabled. The retained Android wrapper is unchanged.

## Changes

- Bug Squish gains Picnic Heist through Be the bugs. One or two bugs carry
  crumbs home, hide beneath leaves, dodge warning swats, dash and collect gold
  shields. Filled burrows advance the picnic. Classic squishing and its old
  mode-less saves remain available.
- Solitaire and Regex Lab now supply the no-argument callbacks ArcadeSave
  actually invokes. Meaningful progress and registry summaries work again.
- ArcadeSave rejects false, rejected or incompatible restores honestly,
  retains saved bytes and blocks replacement until Retry or Start Fresh.
- Nearby recovery validates imported shared-room checkpoints before replacing
  a working session. Damaged saves fail transactionally.
- Legacy settings and Chess preference access tolerate unavailable storage,
  allowing play with in-memory defaults.
- Forty-eight text replacements across 21 activity pages remove slogans,
  self-praise, release commentary and irrelevant technical settings wording.
  Intentional stories, jokes, rules and saved formats remain.

## Verification completed before the review snapshot

- Worker/authority/client regression: 221 tests passed after Nearby/save fixes.
  The final Chess storage regression also passed with its 18-test frontend suite.
- Transport/shell tests: 112 passed. Existing engine/family/client checks,
  turn-based clients and standalone Solitaire rules passed. Regex Lab tested
  1,280 procedural challenges and safety cases.
- Shared-room stress: all 34 activity IDs, 272 seats, 1,054 rejected malformed
  or racing actions, 238 control passes, 80 join/leave cycles and eight damaged
  checkpoint cases. Accepted state and credentials remain protected.
- Tank Tactics stress: 48 complete matches, 960 shots, 338 valid moves and
  173 rejected moves. Every action preserves the original state, exact saves
  and the next action after reload. Largest observed save: 23,713 bytes.
- Actual Solitaire and Regex Lab UI/save-contract regressions reproduced
  failure before the fix, then passed exact restoration and registry checks.
- Ten central-save regressions cover all rejected restore paths, retained
  saved bytes, successful retry, Start Fresh and legacy undefined success.
- Picnic Heist has six model checks for carrying, deposits, round progression,
  swats, hiding, shields, dash, two bugs, rotation and bounded long sessions.
  Focused browser checks exercise controls, legacy saves and actual shared play.
- Copy review: all 41 inline scripts in edited pages parse; all 21 pages launch
  at 320 by 568 without page errors. Independent visual review covers narrow
  portrait, phone, desktop and short landscape layouts.

## Final verification and publication

The review-branch CI and remaining catalog, storage, retained browser and
offline-package checks are pending for this snapshot. This section must be
updated with their exact results before the release is declared ready.

## Environment and limits

Local browser checks use official Chromium 141 headless shell with the locked
Playwright client. Full Chrome cannot create its singleton socket in this
sandbox; the headless shell works through the permitted pipe interface.
No browser assertions were waived because of that setup problem.

The local environment cannot gather usable Nearby ICE candidates. Actual
two-peer Nearby verification belongs to the GitHub runner, not a local pass.
Browser TV tests use intercepted APIs and synthetic media. Personal TorBox
account availability, physical Android/iOS hardware, actual device voices,
native notifications and operating-system clipboard paste were not tested.
Native wrapper checks cover source and packaging, not a new hardware APK run.
