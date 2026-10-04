# Arcade 2.5.0 stress-test report

Release date: 2026-10-03. This report records the release stress tests and
supported online behavior. The exact published commit, deployment results,
and production checks are recorded in the canonical ProjectStatus entry
and the repository’s GitHub Actions history.

## Coverage and online behavior

The catalog contains 43 enabled entries: eight competitive games, 34 shared
activities, and Arcade Chat. Backyard Baseball remains disabled. The shell,
room transports, autosave restoration, offline archive, and catalog metadata
are part of the release scope.

Competitive games retain their game-specific turns and seats. Accepted room
state is broadcast to every member, including intermediate Memory reveals,
Sorry card/no-move phases, and Monopoly movement. Late HTTP responses, stale
snapshots, duplicate updates, and disconnected inputs must not replace newer
accepted state. Guess Who continues to expose only the viewer's secret choice
until the round ends.

Shared activities have **one controller at a time**. Observers receive the
accepted checkpoint, text/UI state, and compressed canvas frames. They do not
run a second physics/random simulation or independently accept input. The
controller can pass controls, and a connected member can take controls when
the current controller is offline. A disconnected controller's simulation
pauses. Controls are not simultaneous across independent devices.

Make 10, Blackjack, Shuffleboard, and Bowling can transfer control automatically
when the configured local player count matches the room roster. The game must
also be at an eligible turn boundary. Other configurations use explicit
control passing. Shared activities protect membership, control ownership,
checkpoint identity, and bounded transport state; their individual rules and
competitive completion are not independently verified by the room authority,
and they do not award competitive Arcade Stars.

| Activity | Folder | Online behavior |
| --- | --- | --- |
| Make 10 | `make-10` | Shared controls |
| Balloons | `balloons` | Shared controls |
| Blackjack | `blackjack` | Shared controls |
| Checkers | `checkers` | Competitive |
| Chess | `chess` | Competitive |
| Arcade Chat | `chat-room` | Chat |
| Time | `time` | Shared controls |
| Dots | `dots` | Competitive |
| Hangman | `hangman` | Shared controls |
| Solitaire Parlor | `solitaire` | Shared controls |
| Guess Who | `guess-who` | Competitive |
| Insultinator | `insultinator` | Shared controls |
| Build My Joke | `build-my-joke` | Shared controls |
| Emoji Jigsaw | `jigsaw` | Shared controls |
| Robot Codebreaker | `codebreaking` | Shared controls |
| Math | `math` | Shared controls |
| Picture Spelling | `spelling` | Shared controls |
| Maze | `maze` | Shared controls |
| Memory | `memory` | Competitive |
| Minesweeper | `minesweeper` | Shared controls |
| Mini Golf | `mini-golf` | Shared controls |
| Orb Slicer | `orb-slicer` | Shared controls |
| Two Truths & a Lie | `two-truths` | Shared controls |
| Paint Lab | `paint-lab` | Shared controls |
| Patterns | `patterns` | Shared controls |
| Bounce Boxes | `bounce-boxes` | Shared controls |
| Shuffleboard | `shuffleboard` | Shared controls |
| Simon Says | `simon` | Shared controls |
| Regex Lab | `regex-lab` | Shared controls |
| Tic Tac Toe | `tic-tac-toe` | Competitive |
| Trail | `trail` | Shared controls |
| Trivia | `trivia` | Shared controls |
| Typing | `typing` | Shared controls |
| Contraption Maker | `contraption-maker` | Shared controls |
| Mad Libs | `mad-libs` | Shared controls |
| Silly Face Lab | `silly-face-lab` | Shared controls |
| Sorry! Fire & Ice | `sorry` | Competitive |
| Bug Squish | `bug-squish` | Shared controls |
| Firefighter Frenzy | `firefighter-frenzy` | Shared controls |
| Monster Dentist | `monster-dentist` | Shared controls |
| Music Maker | `music-maker` | Shared controls |
| Neon Bowling | `bowling` | Shared controls |
| Monopoly | `monopoly` | Competitive |

## Desktop and mobile verification

The visual sweep uses these Chromium viewport sizes:

| Profile | CSS viewport |
| --- | --- |
| Desktop | 1440 × 900 |
| Mobile portrait | 390 × 844 |
| Narrow mobile portrait | 320 × 568 |
| Mobile landscape | 844 × 390 |

It loads each catalog entry, captures menu and active-play screenshots where
available, checks browser errors and missing assets, inspects visible controls
for viewport overflow, and performs an activity-specific interaction. The shell
is included. The complete sweep produces 180 catalog/shell records, including
four records for the disabled Baseball entry; that entry is not a supported
play target.

Two-browser online checks use the production Worker implementation in Miniflare
with real HTTP requests and WebSocket connections. They use desktop and mobile
viewports and check room creation/joining, accepted state delivery, control or
turn ownership, actions, stale/off-turn rejection where applicable, and
reconnection. Shared activities also exercise control transfer and recovery
without letting the observer's simulation advance independently.

These are browser viewport tests. No physical iOS or Android device testing has
been completed in this run. The tests do not prove every CPU difficulty, random
board, long-duration game, or future browser/OS behavior.

## Repairs made during testing

- Repaired online-client acknowledgement and stale-response races, including
  presence-only updates and input arriving while an online move is pending.
- Preserved visible card phases and legal no-move progression in Sorry, and
  accepted canonical animated Monopoly rolls and movement to Jail.
- Added state-aware shared adapters for Simon, Hangman, Jigsaw, Make 10, Trivia,
  and Music Maker. They preserve relevant phase/input state and prevent private
  unsubmitted drafts or local-only state from being copied as shared UI.
- Added compact Jigsaw media, bounded Music Maker loop transport, shared note
  replay, and recovery rules that avoid replaying an already completed animation
  or audio event.
- Repaired short landscape and narrow portrait layouts in game headers, boards,
  controls, and setup panes. Fixed Chat's 320-pixel grid overflow and keyboard
  viewport height handling.
- Repaired desktop Typing input, cursor edits, reload autosave, and deletion of
  complete emoji graphemes. Preserved local activity snapshots when joining and
  leaving a shared room.
- Added stable Chat message elements during history pruning, so incoming
  messages do not force someone reading earlier messages back to the bottom.

## Image and media limits

Arcade Chat accepts local image files, clipboard images, and drag/drop. It
compresses them before sending and supports preview/remove, captions,
image-only messages, and an accessible larger viewer. JPEG, PNG, WebP, GIF,
and AVIF are accepted as source formats when the browser can decode them;
GIFs become still images. The authority accepts bounded JPEG, PNG, or WebP
raster attachments with matching dimensions and rejects external URLs, SVG,
unsupported MIME types, and oversized payloads.

| Payload | Bound or behavior |
| --- | --- |
| Chat source file | At most 12 MiB and 40 megapixels |
| Chat image | At most 24 KiB encoded; at most 1280 pixels per dimension |
| Recent chat history | At most 100 messages and 48 KiB total; older messages expire |
| Shared activity checkpoint | 50 KiB encoded transport budget; 8 MiB decoded budget |
| Shared canvas view | Compressed controller frames, reduced further when required to fit the checkpoint |
| Music Maker shared voice loop | Up to six seconds; compact 4 kHz, four-bit copy |
| Music Maker local recording | Original recording retained in the local autosave |

The bounded history fits the existing Nearby room frame limit, including a
32-member Internet chat roster. Reconnection restores retained image history.
A lost response followed by a retry does not append a second committed message.
Image-only messages use the existing incoming chime and optional background
notification behavior.

Network animation and shared audio update at the room's delivery cadence. A
shared canvas may look less sharp or fluid than the controller's local canvas,
and shared recorded audio is intentionally compressed. Oversized activity
state reports a clear error instead of committing an incomplete snapshot.
The existing browser media/autoplay policy still applies on each receiving
browser. No image-storage or media-relay service was added.

## Validation results

| Check | Current verification result |
| --- | --- |
| Worker, room authority, and client regressions | 187/187 passed; no failures |
| Shared shell and Nearby protocol/transport tests | 108 shared shell/transport/client tests passed; earlier combined game-client run also passed |
| Entire catalog visual sweep | 180/180 records passed across 45 pages and four sizes; no JavaScript errors, failed/missing assets, or interaction failures |
| Eight competitive games against the Worker | Passed in the final 42/42 combined competitive/shared run; no page errors |
| 34 shared activities against the Worker | Passed in the final 42/42 combined competitive/shared run; no page errors |
| Chat frontend/model/Nearby/checkpoint regressions | 17 tests passed |
| Chat actual-browser image flow | Passed desktop, portrait, narrow portrait, and landscape checks with no page errors |
| Shared adapter and recovery scenarios | Desktop and mobile adapters, 34/34 untouched lobbies, 7/7 recovery cases, and six physics control transfers passed |
| Native input, Home, and wrapper/static checks | Passed; no physical-device claim |
| Offline manifest and service worker | 343 files / 17,613,808 bytes verified; complete offline download, reload, Paint launch, and Home passed in Chromium |
| Production Pages and Worker rollout | Per-commit deployment results are recorded in GitHub Actions and ProjectStatus; optional public-browser smoke runner included |
| Actual local WebRTC browser pairing | Blocked in this runtime; CI check added |
| Physical iOS/Android hardware | Not tested |

The real local WebRTC browser check cannot gather network interfaces in this
managed runtime: Chromium reports `uv_interface_addresses` with `EPERM`.
Nearby protocol, room authority, socket broadcasting, identity enforcement,
transport pinning, bounded frames, and checkpoint recovery have automated
coverage. Actual RTC pairing is a separate check and is configured to run on
the unrestricted GitHub Actions runner. A successful CI result must be recorded
before claiming that browser-pairing check passed.

## Reproducing the checks

Install the locked dependencies and Chromium:

```sh
npm ci
npm --prefix cloudflare/chess-worker ci
npx playwright install --with-deps chromium
```

Run the authority, client, and transport suites:

```sh
npm --prefix cloudflare/chess-worker test
node --test multiplayer/test/*.test.mjs
node --test sorry/test.cjs checkers/online.test.mjs dots/online.test.mjs
node memory/test-online.cjs
node memory/online.browser.test.mjs
node tic-tac-toe/test-online.cjs
node tic-tac-toe/online.browser.test.mjs
```

Run actual-browser and recovery checks (the browser suite runs these sequentially):

```sh
npm run test:browser
node tools/test-shared-recovery.mjs
node tools/test-shared-lobby.mjs
node tools/test-shared-simulation.mjs
ARCADE_SHARED_MOBILE=1 node tools/test-shared-adapters.mjs
npm run test:nearby-browser
```

Run static/offline checks and the visual sweep:

```sh
node tools/test-native-keyboard.mjs
node tools/test-shell-navigation.mjs
node tools/test-android-wrapper.mjs
node tools/generate-offline-manifest.mjs --version 2.5.0+20261003.1
node tools/test-offline-runtime.mjs
python3 -m http.server 8787 --bind 127.0.0.1
```

With that static server running, use a second terminal:

```sh
node tools/audit-browser.mjs --out=test-results/browser-final
```

Browser reports and screenshots are written under `test-results/`. CI retains
that directory as the `arcade-browser-checks` artifact. The committed test
scripts reproduce the evidence; generated screenshots do not belong in the
deployable offline archive.

The final full visual evidence is
`test-results/browser-verified/results.json`. The complete competitive/shared
run is recorded in `test-results/online-browser/report.json`, and Chat evidence
is under `test-results/chat-browser/`.

## Release and rollback

The web release and Worker must be deployed together so shared room types and
chat images have a compatible authority. The existing Worker deployment
workflow runs its test suite before deployment and uses the existing
`ARCADE_ROOMS` binding. No new service, credential, or storage bucket is needed.

The service-worker release marker is `2026-10-03-arcade-shared-online-v1`
and the verified manifest is `2.5.0+20261003.1`. Regenerate the complete
hash-verified offline manifest whenever deployable files change. Verify both
Pages content and Worker health after deployment. Preserve the previous
committed release and archived APKs; do not replace the last-known-good offline
snapshot until the new snapshot verifies completely.

Build the downloadable static web bundle after verifying the manifest:

```sh
python3 tools/package-web-release.py --output /tmp/arcade-2.5.0-web.zip
```

Run the optional public-site smoke test after publication:

```sh
node tools/test-production-browser.mjs
```
