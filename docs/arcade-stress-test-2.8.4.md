# Arcade 2.8.4 verification

## Scope

Move the shared Internet/multiplayer controls into game and activity menus.
Remove the floating globe and its positioning/drag machinery. Preserve the
current Internet/Nearby room service, game rules, saves and recent Upwords fixes.

All 34 shared activities use an explicit native-menu target or a compact local
menu on their existing Home control. Initial setup screens also offer multiplayer.
Music Maker exposes its menu on the portrait rotation screen. The 11 competitive
activities already use their own multiplayer interfaces; Adventure and TV have
no shared-play globe and are unchanged.

## Actual browser checks

- `tools/test-multiplayer-menus.mjs`: 139 passing scenarios with no JavaScript
  errors. All 34 activities are exercised at 1440x900, 390x844, 320x568 and
  844x390, including opening multiplayer before and during play. Real mouse and
  touch input verifies a reachable menu item, normal-flow positioning, hidden
  multiplayer controls during gameplay, and dismissal. Additional cases cover
  focus/Tab/Escape, exact local text and native save/resume, Home, invitation
  auto-open, old globe preferences and blocked browser storage.
- `tools/test-online-browser.mjs`: all 42 existing competitive/shared scenarios
  passed against the actual Worker/Durable Object in Miniflare, with no page
  errors. The previously intermittent Orb Slicer projectile wait passed in this
  run. No Orb Slicer gameplay source was changed.
- `tools/test-shared-recovery.mjs --case=Spectator`: real shared Typing and
  Solitaire peers passed local observer navigation, unchanged canonical game
  state, checkpoint exclusion, permission checks, reachable Leave, and local
  backup restoration. Solitaire comparisons exclude its running-clock fields.
- `tools/test-upwords-browser.mjs`: 11 passing scenarios with no page errors,
  including actual mouse/touch dragging, stable board geometry at five sizes,
  exact saves, privacy and private Internet rooms. The twelfth real Nearby RTC
  case is explicitly blocked by this host having only loopback; it is not a pass.
- `tools/test-shell-browser.mjs`: all four shell layouts and complete offline
  snapshot preparation/reload passed. An offline Paint menu opens multiplayer
  and returns Home through the persistent shell; search/recent history remain.
- `tools/test-catalog-browser.mjs`: all 11 catalog scenarios passed, including
  responsive search, ordering, recent launches, reload and Home.
- `tools/test-local-ui-browser.mjs`: native typing, short portrait Bowling,
  Blackjack, Make 10, Time, header targets and landscape boards passed.

Screenshots of native and compact menus were visually reviewed. Browser checks
used actual local HTTP pages and native browser storage, with Chromium Headless
Shell 134. They did not substitute inline copies of the activity sources.
Generated screenshots/reports are under `test-results/` and excluded from releases.

## Models and packaged runtime

All 208 Worker/model/client checks, 109 transport/shell checks and 40 Upwords
rule/dictionary/client checks passed. Native-keyboard and persistent Home-route
audits passed for all 47 enabled entries. Android wrapper source validation
passed; no APK rebuild is required for this web-content update.

Snapshot `2.8.4+20261030.1` has 387 runtime files totaling 20,115,232 bytes.
Every runtime size and SHA-256 hash passed the offline validator. The release
packager independently verifies the manifest, ZIP CRC and archived runtime hashes.
No physical mobile hardware test is claimed. Real RTC checks remain in the
existing LAN-capable CI workflow; no pairing or authority implementation changed.

## Publication record

The canonical repository is `to-shreds/arcade`, default branch `main`.
ProjectStatus records the final release commit, deployment outcome and downloadable
artifact identities after publication. Existing APKs and earlier release files
are retained.
