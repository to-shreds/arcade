# Arcade 2.8.2 verification

## Scope

Upwords gives the board more space: compact one-line scores, no persistent
rules or empty preview text, and one row for Undo, Clear, Play, Swap and Pass.
Rules remain in Help; Zoom is a small header control. Move feedback appears
only while a draft exists. Native saves, dictionary, game rules, CPU and
multiplayer authority formats are unchanged.

Mouse/touch/pen pointer gestures can place rack tiles, reposition unplayed gold
tiles, return them to the rack and rearrange rack display order. Physical rack
indices remain stable, including duplicate letters and Qu. Pointer movement
never commits a move. Invalid/outside drops, cancellation, lost capture, pause,
privacy changes and authoritative turn changes preserve the original draft.
Committed tiles cannot move; identical-letter and five-level limits remain.

## Verification

Dedicated preflight https://github.com/to-shreds/arcade/actions/runs/40993361208
passed on 69c4ff62923b5dfc59227b34b41aac730bde3882. The final promotion only
updates documentation and removes the temporary workflow; runtime files are
identical to this verified source.

- All 39 Upwords rule, dictionary and client tests passed. Four added client
  tests cover physical tile identity, cancellation/privacy, authoritative turn
  changes, committed tiles and prohibited stack drops.
- All 208 Worker/model/client tests passed.
- All 12 actual Chromium scenarios passed with no JavaScript errors. Real
  mouse and native touch input cover placement, repositioning, return to rack,
  rearrangement, invalid/outside drops, Escape/native touch cancellation,
  follow-up taps, duplicate letters, Qu, exact native save/reload and actual
  scoring/stacking. Internet peers submitted dragged moves through the real
  authority. Real offline Nearby RTC and private rack delivery also passed.
- Desktop 1440x900, portrait 390x844, short portrait 390x640, small portrait
  320x568 and landscape 844x390 passed. Portrait boards use almost full width;
  all move controls share one compact row and remain visible without scrolling.
  The 390x640 board grew from 223 to 374 pixels wide versus 2.8.1, providing
  2.81 times the board area. At 320x568 it grew from 148 to 304 pixels wide.
- Screenshots at all sizes, the private mobile room and the enabled gold Play
  state were visually reviewed. The native save confirmation can temporarily
  overlay the footer, as in previous versions.
- Native keyboard and Home routing audits passed for all 47 activities.
- All 387 offline runtime file sizes and SHA-256 hashes passed.

The previous full-Arcade 2.8.1 run 40971124102 completed successfully before
this work. Local Chromium installation was unavailable, so real browser checks
ran in GitHub Actions. No physical Android/iOS or pen hardware test is claimed.
Final deployment results and download details are recorded in ProjectStatus.
