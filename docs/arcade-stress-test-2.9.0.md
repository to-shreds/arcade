# Arcade 2.9.0 verification

Baseline: 20758a2240827bb83c4b03c12cb977309a7cb2dd (2.8.7).
Broad review source: 9fe4b6d6185e71687669e94d7ff06280876079ea.
Final runtime repair: 409aa89df655b5e2580285861205eca9b7296b46.
Subsequent release documentation does not alter runtime.
Snapshot 2.9.0+20261107.1: **388 files, 20,195,799 bytes**.

All 47 enabled entries remain available. Backyard Baseball stays disabled.
Existing remote-first APKs are retained without rebuild.

## Fixed and added

- **Picnic Heist:** Bug Squish's Be the bugs option supports one or two bugs,
  carrying crumbs home, hiding, dash, shields, warning swats, hearts, retry and
  harder picnics. Classic and old mode-less saves remain compatible.
- **Visible Chess history:** the actual selected board appears with the move
  list, buttons and slider. Square boards, readable pieces, focus, CPU pause,
  drag cleanup, save/reload and online authority are protected. Illegal moves
  from a past position no longer erase later moves. A branch begins only when
  a legal move is committed, including completed promotion selection.
- **Solitaire/Regex saves:** callbacks now match ArcadeSave's no-argument
  contract, restoring meaningful autosaves, registry listings and summaries.
- **Rejected saves:** failed or incompatible loads retain saved bytes and block
  replacement until retry or an explicit fresh start.
- **Nearby recovery:** imported shared checkpoints are validated before they
  can replace a working session.
- **Blocked storage:** settings in 13 legacy activities and Chess fall back
  safely so storage restrictions cannot prevent startup.
- **Clipped menus:** Make 10, Jigsaw, Memory and Minesweeper setup panels scroll
  with actual wheel/touch input. Minesweeper also bounds its panel to the
  overlay and avoids rendering a grid that has not initialized.
- **Plain copy:** 48 replacements across 21 pages remove slogans, self-praise,
  release commentary and irrelevant technical labels. Intentional stories,
  jokes, rules and save formats remain.

New game suggestions were not implemented.

## Verification coverage

| Area | Passed coverage |
| --- | --- |
| Worker, authorities, clients, saves | 225 tests on final repair CI |
| Transport, shell and sessions | 112 tests on final repair CI |
| Shared stress | 34 activities, 272 seats, 1,054 rejected malformed/racing actions, 238 control passes, 80 join/leave cycles, eight damaged imports |
| Active catalog | 47 play/rotation/save plus 47 denied-storage cases, 94 total |
| Visual sweep | 196 page/viewport records, no page/asset/interaction errors |
| Menus/startup | 16 native wheel/touch cases plus two deterministic preload-resize regressions |
| Online | 42 retained entries plus separate Tanks/Upwords, Chat, ten recovery cases, 34 untouched lobbies and six physics transfers |
| Heist | Six models and seven browser/actual-room cases across four layouts, including exact state transfer and private restore |
| Chess history | 21 frontend tests, seven browser layouts, actual selected positions, slider/keyboard input, focus, rotation, save/reload and future-history preservation |
| Tanks | 32 engine tests; 48 full stress matches, 960 shots, 338 accepted/173 rejected moves; nine broad browser cases, full polish, 14 weapon families and seven native reloads across six sizes |
| Upwords | 26 engine/dictionary tests, 14 client tests and 11 browser cases, including private racks, dragging and full Internet/Nearby recovery |
| Existing controls | 139 menus, 156 native Home cases, 50 clocks, 36 kid Trivia mappings, full Typing tools, six Face Lab cases and 12 TV startup cases |
| Offline | All 388 files verified, offline reload, 47 tiles, Paint/Home/search/recent, Adventure/Mad Libs and desktop/mobile shared adapters |
| Other logic | Solitaire rules/deals, 1,280 Regex challenges/safety, Adventure routes/saves, narration and TV fixtures |

Tanks stress verifies unchanged input states, exact saves and deterministic
continuation after every action. Its largest observed save was 23,713 bytes.
Heist tests include actual two-finger steering, native keyboard/dash, hiding,
shields, next-picnic progression, old saves, blocked observers and exact handoff.

## CI evidence and repaired failures

[Broad preflight 42426873524](https://github.com/to-shreds/arcade/actions/runs/42426873524)
passed six of seven groups: models, Tanks/Upwords, stories/TV, catalog/offline,
Heist and shared/competitive. Menus/tools exposed a real Minesweeper startup
race; its other commands passed. Retained run 42426873734 hit the same race.
Neither original whole run is mislabeled green.

[Final repair 42427761898](https://github.com/to-shreds/arcade/actions/runs/42427761898)
**passed** at exact source 409aa89d: 225 model/client/save checks, 112 transport,
all 18 menu/startup cases, all 94 activity stress cases and complete PWA/offline
play. A source-difference gate proves that only the Minesweeper runtime guard
changed after broad review, alongside its regression, manifest and validation
workflow. All other reviewed runtime files are identical.

The startup regression held ArcadeSave's script response, forced an actual
viewport resize while the document was loading and the grid had no cells,
and reproduced the renderAll stack before the fix. Desktop/touch cases now
initialize all 81 cells, accept a native flag and preserve exact state after
another resize.

Actual Nearby pairing, locked identities, offline Chat, shared controls and a
guest move passed job 128566930440. Real offline Tanks authority and private-rack
Upwords peers passed job 128566929672. Independent
[Guess Who run 42426873662](https://github.com/to-shreds/arcade/actions/runs/42426873662)
also passed. These are actual runner RTC checks.

Two harness issues were corrected without dropping functionality: unrequested
offscreen lazy icons are not broken images, and repeated Minesweeper play
accounts for its random-loss menu. Fresh CI passed the full 196-record sweep
and all 94 stress cases.

Orb Slicer's original ten-second test expired before its deliberate tick-200
spawn. Isolated play produced a real target at tick 209 after 10,275 ms. Its
bounded wait checks continuing simulation, connection, phase and spawn budget.
Native slicing/scoring, observer pixels, reconnect/reload and zero-life handoffs
remain required. Fresh full online CI passed.

The historical Tanks Load Saved timeout recurred under concurrent rendering.
Strict isolated and CI repeats passed all 14 families, seven reloads and six
layouts with native clicks and exact battle/aim/mode equality. Resource
starvation remains an inference, not a proved cause. Original evidence remains.

## Publication and limits

The package builder checks every runtime size/hash and ZIP CRC. Exact published
source, artifact checksum, provenance and live-file verification are recorded in
ProjectStatus and GitHub Release metadata. Update an existing offline copy to
receive the new files.

Local browser tests used official Chromium 141 headless shell; GitHub used its
installed Chromium. Full Chrome could not create its singleton socket locally;
the permitted headless shell worked without waiving assertions. Local RTC could
not gather usable interfaces, so actual RTC verification came from GitHub.

Physical Android/iOS hardware, device voice/notification/OS clipboard behavior
and personal TorBox-account playback were unavailable. TV uses intercepted APIs
and synthetic media. Native wrapper checks cover source and packaging.
