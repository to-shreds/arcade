# Arcade 2.8.5 verification

## Scope and fixes

- Dots has a visible, non-draggable header Menu and a pause dialog with Resume,
  New Game, Save, Load and Back to Arcade. Its setup screen also has an exit.
- Shared native setup/pause menus gain their missing Arcade exits. Chess and
  Chat gain setup/lobby exits, and Checkers/Tic Tac Toe use a clear exit label.
- Clock bitmaps match their displayed CSS content and pixel density, including
  hidden shell restore/reveal and rotation. The frame stays square.
- Trivia has 36 simple spoken picture questions with replay, answer feedback,
  a child-controlled next arrow, normal saves and shared controller handling.

## Checks

The new focused checks run with `npm run test:arcade-fixes` and are included
in the normal GitHub Actions workflow.

- Clock: all 50 actual Chromium rendering, five viewport, DPR 1/2, mode,
  rotation, hidden restore/reveal and real mouse/touch scenarios pass.
- Kid Trivia: all 36 question mappings, four viewport layouts, actual answer,
  replay and next clicks, correct/wrong/repeated scoring, manual pacing,
  exact saved option order/highlights/answered state, shared restore,
  browser/native speech fixtures, unavailable voice, mute and click/keyboard
  menu cancellation pass. All six existing categories and normal automatic
  advance pass. The current save schema remains compatible.
- Dots: nine online/client/pause-menu regressions pass. CPU pause/resume and
  menu state exclusion preserve actual saved gameplay.
- Home and native keyboard source checks pass for all 47 enabled activities;
  Android wrapper source checks pass without an APK rebuild.
- Existing 139 shared multiplayer-menu scenarios pass at four viewports.
- New DOM audit verifies all 34 shared activities and all native setup/pause
  exits. Actual-browser Home checks cover the shared activities and native
  Dots/Chess/Chat/Checkers/Tic Tac Toe exits at four viewports.
- Existing local-UI browser checks pass for typing, Bowling, Time keypad,
  Blackjack and Make 10. All 11 catalog/search/recent/shell launch scenarios
  pass without browser JavaScript errors.
- Existing shared adapters pass desktop and mobile actual Worker room play,
  control transfer and local-state checks for Simon, Hangman and Music Maker.
- All 208 Worker/model/client checks and all 109 transport/shell model checks pass.
- Checkers and Tic Tac Toe online regressions also pass.

Screenshots were visually reviewed for Dots and clock phone/landscape layouts.
Young Kid Trivia pictures, controls and menu were reviewed in the real shared
Chrome preview at 320x568; actual Chromium fixtures checked all four sizes.
The downloadable Chromium initially lacked emoji glyphs, so those screenshots
were used for geometry; the shared Chrome rendered the answer pictures normally.
Speech dispatch, replay and cancellation use mocked browser/native voice APIs.
The shared Chrome has no playable voice, and no physical Android audio test is
claimed. Android uses the existing device speech bridge.

## Offline and publication

Snapshot 2.8.5+20261107.1 is regenerated from the final runtime. The offline
validator and release packager verify every runtime size and SHA-256 hash,
ZIP CRC and archived contents. ProjectStatus contains the final source commit,
Pages deployment result and downloadable artifact identity. Broad post-push CI
must be distinguished from these completed local checks.
