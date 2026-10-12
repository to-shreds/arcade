# Arcade 2.7.0 verification

Source baseline: canonical main `0a9b8c0e3273aa24f15912f2ddfdeabc6eab9171`.
Release: 2.7.0, offline snapshot `2.7.0+20261012.1`. Exact release commit,
publication and CI outcomes are recorded in `to-shreds/ProjectStatus`.

## New game

Tank Tactics has 84 differentiated weapons in fourteen families, matching SVG
icons and bounded projectile/impact animations. It supports chosen tank colors,
flat/hilly/random destructible terrain, no wind, ten distinct random single-use
weapons per tank, angle/power controls and four moves up to five tank lengths.
Damage adds points, self-hits award the opponent, and the higher score after all
twenty shots wins. Local, computer, Internet and Nearby modes share the engine.

## Verified checks

- `node --test tanks/engine.test.mjs`: 10 passed. Covers every weapon across all
  terrain types, differentiated gameplay signatures, deterministic resolution,
  bounded saves, movement, twenty-shot completion, increasing scores, direct and
  self-hits, mines, terrain builders/tunnels, rolled impacts, lightning and CPU
  beam aiming. A separate extreme sweep passed 1,512 shots. Its largest measured
  game checkpoint was 21,876 bytes.
- `npm test` in `cloudflare/chess-worker`: 198 passed, including existing games,
  Tanks authority, Nearby RPC/socket/checkpoint recovery, UTF-8 chat headroom,
  HTTP/WebSocket play, complete games, reconnect, mutual rematches, and exactly
  one accepted simultaneous same-version shot.
- `node --test multiplayer/test/*.test.mjs`: 109 passed. Existing transport,
  pinning, offline guards, shared clients, invitations and turn-alert behavior
  remain intact.
- `node --test adventure/story.test.mjs adventure/save.test.mjs tv/core.test.mjs`:
  23 passed. The existing family activities remain unchanged.
- `tools/test-tanks-browser.mjs`: nine actual Chromium cases passed without
  uncaught page errors. Desktop 1440x900, phone 390x844 and 320x568, and landscape
  844x390 passed controls, keyboard input, weapon dialogs and overflow checks.
  All 84 icons were rasterized and individually distinct, with descriptions.
  Four visible movement animations, complete local and online twenty-shot
  games, positive scoring, terrain destruction, exact saves, CPU response,
  WebSocket reconnect, saved-seat resume and mutual rematches passed.
  Network entry and departure preserve the prior local game and aim choices.
  Eight accepted online shot screenshot pairs cover different weapon families.
  Invalid off-turn, stale-version and forged-snapshot requests were rejected.
- Catalog browser checks: eleven scenarios passed, including alphabetical and
  recent views, live search, filtering, actual launches, Home and persistence.
- Shell browser checks: all four sizes passed. A complete hash-verified offline
  download reached Offline Ready, reloaded offline, displayed all catalog
  entries, launched Paint and preserved Home, recent history and search.
- Offline runtime: all 370 files and 18,529,188 bytes verified against their
  hashes. Native keyboard and persistent Home audits passed all 46 enabled
  entries. Existing Android wrapper source checks passed without a rebuild.

## Fixes found by verification

The browser checks identified and corrected an idle rendering loop, unreadable
landscape letterboxing, unsubmitted lobby choices being overwritten by incoming
updates, a null shot reference during movement animation, and an empty room-code
display. Source and runtime checks also preserve the persistent Arcade Home route
and keep old local state separate from room state.

## Test limits and reproduction

The managed local network exposes only loopback. Actual Nearby ICE gathering was
attempted and produced no usable host candidate, so that case is explicitly
blocked locally, never reported as passed. `test-tanks-browser.mjs` requires the
real offline RTC case in an environment with a non-internal network interface.
GitHub CI also retains the existing real Nearby pairing suite. Physical Android,
iOS and Windows hardware were not tested in this run.

Run `npm ci` in the root and Worker folder, then install Playwright Chromium.
Use `npm run test:tanks`, `npm run test:tanks:browser` and the checks above.
The browser test uses the actual Worker fixture and read-only game inspection.
For production verification, set `ARCADE_TANKS_URL`, `ARCADE_TANKS_API` and
`ARCADE_TANKS_CASES='two real'`; created Internet room memberships are cleaned up.
