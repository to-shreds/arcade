# Arcade 2.7.2: Tank Tactics polish

## Scope

The baseline is canonical `to-shreds/arcade` main commit
`44dfbe0ecfac5f7e37c97d3782a197b698559ae5` (2.7.1). The existing release
archive was used only after its Tanks runtime Git blob hashes were compared
with that live commit. All unrelated activities and globe behavior are retained.

## Local verification

- Nine engine/authority regression tests passed, including 1,764 weapon,
  terrain and extreme angle/power combinations; twelve complete CPU matches;
  four-move limits; mine timers; terrain builders; monotonic scoring; input
  rejection; and exact JSON state round trips. Largest tested snapshot: 21,920
  bytes, below the existing Nearby checkpoint budget.
- A complete twenty-shot shared-authority match matched the local engine after
  every shot and rejected wrong turns, stale versions and forged score fields.
  Mutual rematch passed. This is authority validation, not a network test.
- All 84 artwork geometry compositions differ without labels or tint. A real
  Chromium contact sheet was visually inspected; input/name escaping was tested.
- A genuine eight-shot save produced by the unchanged 2.7.1 engine restored
  without changing its terrain, scores or ammunition and continued successfully.
- Chromium exercised a full local UI match, a large crater, actual movement and
  shot animation, fallback-storage restoration, display toggles and six sizes:
  412x915, 360x740, 915x412, 740x360, 667x375 and 1280x800. No page errors or
  out-of-bounds shot controls were found. Visual review caught and corrected
  narrow-phone title overlap; narrow landscape retains movement distance.

An ordinary radius-25 ground blast now cuts 47.5 units deep with a 90-unit
footprint, instead of 25 deep and 50 wide. A dedicated Crater Maker digs over
100 units deep from a flat surface. Tiny precision shots remain much smaller;
airborne misses do not dig unrelated ground. Damage budgets were not enlarged.

## Environment and CI

Managed Chromium blocks navigations, including localhost. Local visual checks
therefore used an inline bundle of the shipped modules and an explicit storage
fixture. No native IndexedDB reload, physical device rotation, Internet transport
or Nearby radio test is claimed from those local checks.

The new `tools/test-tanks-polish-browser.mjs` checks real served modules, native
saved-game reload, all artwork and search, header/control bounds, denied display
APIs, preference restoration and cancelled fullscreen requests. Existing Worker,
transport, Tanks Internet/Nearby, globe and PWA suites remain required. Consult
ProjectStatus and the workflow run for the actual per-commit CI and deployment
result, rather than treating this list of required checks as a passing result.

## Verified served-browser and server results

Preflight run 38368105094, job 115198032033, completed its complete test
sequence successfully on 2026-10-13. The passing suites used exactly the
runtime files in this release, with hash-verified source and offline manifest:

- 198 Worker and authority tests; 109 transport and shell tests; 19 Tanks engine
  and polish tests, including the 1,764-case sweep and complete matches.
- Real Chromium: native saved-game reload through the existing explicit
  Continue prompt, a complete twenty-shot local match, computer turns,
  randomized ammunition and all 84 distinct drawings.
- Two independent Internet clients against the real Worker implementation:
  create, join, authoritative shots, animation, reconnect and saved-room resume.
- Actual offline browser Nearby transport and shared Tanks authority, plus
  real WebRTC pairing, locked identities, chat, control transfer and guest moves.
- Six polish layouts, header/control bounds, movement slider access, artwork
  search, denied fullscreen/orientation APIs, independent display preference
  restore and cancellation of pending fullscreen requests.
- Draggable-globe browser regression; 46 keyboard and Home-route audits;
  Android wrapper source validation; all 374 offline runtime file hashes.

The workflow's final repository push, after all tests passed, was rejected
because its built-in token cannot modify workflow files. The tested Git tree
was retained as 04ba4555229dd32834e75cc2bbdb399384b4cfb7; publication uses the
connected repository writer, not an untested reconstruction. The failed overall
run status therefore describes publication, not a failed final test. Earlier
preflight attempts exposed and fixed explicit Worker fixture dependencies and
an incorrect test assumption about automatic saved-game loading.

Evidence: https://github.com/to-shreds/arcade/actions/runs/38368105094
Artifact 11797404821 contains 50 verification files. Physical phone rotation,
physical Nearby radios and a production-endpoint match were not tested here.
Deployment readiness is recorded separately in ProjectStatus.

## Use

Refresh Arcade and update its offline copy. Use the Landscape button in Tank
Tactics, or the screen icon on narrow phones. When the browser cannot lock
orientation, rotate the phone manually; the wide layout remains available.
