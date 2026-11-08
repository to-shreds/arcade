# Arcade 2.10.0 verification

Verification is in progress. Production remains 2.9.0 until publication checks
complete. The approved scope is in arcade-2.10.0-design.md.

## New game coverage completed locally

- 25 model/static-response tests pass: all 30 logic missions, 1,200 generated
  logic orders across three difficulties, 28 witnessed campaign train wins,
  1,000 generated train schedules and 3,504 trolley decision/restore branches.
- Alternate logic circuits, all-input checking, output identity, cycles,
  malformed saves, seeded risks, brake deceleration, signals, head-on collision,
  reverse recovery and terminal-action guards are covered.
- Focused Robot browser checks pass four layouts, native wiring, keyboard
  controls, undo, reload, nine-gate placement, reward uniqueness and denied storage.
- Independent playability review passes eight game/layout combinations,
  deeper logic controls, 750 additional generated logic puzzles and actual
  simulator completion/par checks for all 28 train jobs.
- Native keyboard and shell Home source audits pass all 49 enabled activities.
  The retained Android wrapper source check passes.

## Remaining release checks

Complete new-game shared rooms and media playback, full 49-activity browser and
PWA checks, positive real Nearby pairing on a runner, deployed Worker support,
public asset hashes and the packaged release before marking this release complete.

## Test limits

Browser automation uses desktop and emulated touch viewports. Physical Android
and iOS devices, OS-specific behavior and personal TorBox-account playback have
not been tested. This environment cannot establish real RTC ICE; the release
requires positive Nearby results from a GitHub runner rather than a local skip.
