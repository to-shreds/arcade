# Arcade continuation handoff

## Current state

The canonical project is `to-shreds/arcade`, default branch `main`. Production
web content is served at <https://to-shreds.github.io/arcade/>. The repository
controls implementation and release substance; the applicable entry in
`to-shreds/ProjectStatus` controls readiness and next steps.

The 2.5.0 web release is implemented in this repository. It adds
Internet/Nearby shared play to all 34 previously unsupported activities,
retains the eight competitive multiplayer games, and adds images to Chat.
The enabled catalog has 43 entries. Backyard Baseball remains disabled.
The Worker, shared transport/client, two-browser gameplay, all-catalog visual,
initial-lobby, recovery, and adapter checks have passed. The service-worker
marker is `2026-10-03-arcade-shared-online-v1`; the complete offline manifest
is `2.5.0+20261003.1` with 343 files. Publication readiness, the exact release
commit, deployment results, and the real RTC CI result belong to the canonical
ProjectStatus entry. Do not infer deployment merely from `package.json`.

## Controlling sources

- `catalog.json` and each activity's `game.json`: enabled entries and online mode.
- `multiplayer/arcade-multiplayer.js`: transport bridge, transport pinning,
  authoritative-room observation, invitations, and turn/control alerts.
- `multiplayer/shared-activity.js` and `multiplayer/shared-room-client.js`:
  shared checkpoints, simulation pause, observer rendering, passing/recovery,
  local backup restoration, HTTP/WebSocket acknowledgement, and reconnects.
- `multiplayer/models/`: environment-neutral room models, competitive rule
  validators, shared-activity control validation, and image validation.
- `multiplayer/nearby-room-service.js` and the Nearby session/protocol modules:
  host authority, locked identities, bounded RPC/socket delivery, and recovery.
- `cloudflare/chess-worker/src/index.js`: production Internet room service.
- `arcade-save.js` and game-specific adapters: local saves and shared restoration.
- `README.md`, `CHANGELOG.md`, and
  `docs/arcade-stress-test-2.5.0.md`: behavior, release scope, verification, and limits.
- `sw.js`, `offline-manifest.json`, and
  `tools/generate-offline-manifest.mjs`: complete versioned offline release.
- `.github/workflows/test-arcade-web.yml` and
  `.github/workflows/deploy-arcade-worker.yml`: CI and production Worker rollout.

## Completed work

Shared rooms have one controller, up to eight members, observer state/animation
delivery, explicit passing, controller-loss recovery, and restoration of the
browser's local activity on exit. Make 10, Blackjack, Shuffleboard, and Bowling
can hand controls off automatically when their configured player roster matches
the room. Shared play is not simultaneous independent control and does not
award competitive Arcade Stars.

Dedicated adapters preserve Simon phase/input, Hangman private drafts, Jigsaw
media/completed state, Make 10 and Trivia progress, and Music Maker notes,
compact shared loops, and local audio state. Accepted checkpoints and canvas
frames remain bounded. Music Maker retains full-quality local recordings.

Competitive repairs cover pending-action input, stale-response and
acknowledgement races, reconnect/presence updates, Sorry visible-card/no-move
phases, and Monopoly animated-roll/Jail transitions. Responsive repairs cover
narrow portrait and short landscape boards, headers, setup panes, controls,
Bowling, and native Typing cursor/emoji behavior.

Chat supports selected/pasted/dropped images, compression, preview/remove,
captions, image-only messages, an accessible larger viewer, retained reconnect
history, and idempotent retries. Limits are 24 KiB per attachment, 1280 pixels
per dimension, and 48 KiB/100 messages in recent history. Raster type and
dimensions are validated by the shared authority. Existing chimes and desktop
notifications remain intact.

The Chat suite passed 17 tests and its real Chromium/Miniflare two-client flow
passed actual upload/compression, WebSocket delivery, viewer, reload/resume,
lost-response retry, paste/drop, and four viewport layouts. The final
two-browser competitive/shared run passed 42/42 entries with no page errors.
The complete Worker regression suite passed 187/187 tests after fixing a queued
initial Chat scroll that could override a reader's newer scroll position. The
combined transport/client check passed 116 tests. Generated evidence is under
`test-results/`. The verified visual sweep passed 180/180 records across 45
catalog/shell pages and four viewport sizes, with no JavaScript errors,
failed/missing assets, or interaction failures. Remaining final results belong
in the release test report.

## Verification and publication

Local evidence includes 187 passing Worker tests, 108 shared transport/client
tests, 42 competitive/shared online flows, Chat image flows at four sizes,
180 visual/interaction records, 34 untouched shared lobbies, seven adversarial
recovery cases, and six physics control transfers. Dedicated adapters passed
at desktop and mobile sizes. Offline hashes, complete browser download/reload,
Paint launch, Home navigation, native input, and Android wrapper source checks
passed. Test scripts and release packaging are committed; generated evidence
is under `test-results/` and CI retains browser artifacts.

GitHub Actions tests the release and deploys Pages and the existing Worker.
Use ProjectStatus and the Actions history for the exact per-commit publication
result. The optional `tools/test-production-browser.mjs` checks public Typing
and Chat rooms without substituting local endpoints and cleans its memberships.

Actual Nearby RTC cannot gather interfaces in the managed local sandbox
(`uv_interface_addresses` returns `EPERM`). Its real browser check is configured
in CI. Preserve the distinction between that CI result and local model/session
verification. No physical iOS or Android hardware was tested during this run.

## Do-not-break constraints

- The active room remains pinned to its original Internet or Nearby authority.
  Loss of Nearby must never send the room or saved token to Cloudflare.
- Pairing is managed once by the persistent Arcade shell, not as a new game mode.
  Direct activity links remain usable with Internet rooms.
- Preserve existing local/CPU modes, local saves, preferences, statistics, and
  private unsubmitted drafts. Shared observations cannot overwrite local saves.
- Only the accepted turn/controller can change shared game state. Observers
  must not independently run random choices, animation resolution, or timers.
- A control transfer must drain pending state acknowledgement and apply the
  accepted checkpoint before the receiving device starts its simulation.
- Retain competitive rule validation, Guess Who secret privacy, and exact
  Memory reveals. Shared control validation is not full competitive-rule validation.
- Keep frame/request limits and decompression bounds. Oversized state must fail
  clearly rather than partially synchronize. Chat images require no new storage.
- Keep Nearby runtime offline: no public STUN/TURN, signaling service, media
  relay, silent Cloudflare fallback, or new paid dependency.
- Preserve the atomic, hash-verified last-known-good offline snapshot and the
  retained APK releases. Deployment credentials remain outside the repository.

## Next action

Read the canonical ProjectStatus entry and the current commit’s Actions before
reporting publication readiness. For a new device-specific issue, refresh the
offline copy, reproduce on the affected devices, and retain local saves while
collecting the exact room, browser, viewport, and disconnect behavior.
