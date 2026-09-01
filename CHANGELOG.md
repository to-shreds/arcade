# Changelog

## 2.4.0 - 2026-09-01

- Turned the Arcade index into a persistent, same-origin shell that opens games
  in a full-viewport iframe while keeping the player session and WebRTC peer
  connections alive across Arcade Home, browser Back, and game changes.
- Added the shared `ArcadeMultiplayer` bridge and automatic transport selection.
  Existing Multiplayer choices use Cloudflare normally and use Nearby Arcade
  while an index-level connection is active. Active rooms stay pinned to their
  original authority and never silently migrate after a connection failure.
- Added browser-only Nearby Arcade for up to eight reserved members using a
  host-authoritative WebRTC DataChannel star topology with no STUN, TURN,
  Cloudflare, Android-native API, or Internet signaling dependency.
- Added fully offline offer/answer pairing with bundled QR generation and
  decoding, camera and image scanning, copy/paste fallback, expiring secret
  tokens, protocol version checks, and automatically reassembled sequential QR
  frames for large signaling payloads.
- Added persistent cryptographic browser identities, host-locked unique
  nicknames and emoji avatars, reconnect proofs, reserved departed identities,
  presence, joining locks, host removal controls, and session checkpoints.
- Kept Nearby Arcade sessions separate from individual game rooms. Paired
  devices can accept friendly invitations and move among Chess, Sorry,
  Monopoly, Memory, Tic Tac Toe, Dots, Checkers, and Arcade Chat without
  pairing again or adding a per-game Nearby mode.
- Reused strict authoritative Chess rules in the Nearby host and added exact
  semantic transition validation for Memory, Tic Tac Toe, Dots, Checkers,
  Sorry, and Monopoly, including locked nested identities, turns, legal game
  actions, completion, bounded state, compare-and-swap versions, presence, and
  reconnection. Nearby Sorry and Monopoly randomness is host-originated rather
  than accepted from the acting player.
- Added an incoming-message chime to Arcade Chat with a persistent mute control,
  plus gesture-enabled desktop notifications for new messages while Chat is in
  the background. History, reconnect replay, and a player's own messages do not
  trigger duplicate alerts.
- Added Arcade-wide multiplayer turn alerts for Chess, Sorry, Monopoly, Memory,
  Tic Tac Toe, Dots, and Checkers. A two-note chime plays only when canonical
  room authority newly passes to the local player; retained multi-step turns,
  reconnects, stale snapshots, and duplicate HTTP/WebSocket updates stay
  silent. Arcade Settings provides a persistent sound toggle and explicit,
  background-only Windows/desktop notification opt-in. Direct game links use
  the same shared alert service.
- Advanced the PWA service-worker release so already-prepared browsers
  automatically stage the new hash-verified offline snapshot on their next
  update check while keeping the previous snapshot safe until validation.
- Added session-level reactions with rate limiting, Arcade Stars, friendly room
  names and mascots, joining feedback, multiplayer game invitations, and
  Surprise Me selection without creating accounts or public matchmaking.
- Added an installable browser PWA and an Offline Ready flow backed by the
  generated hash manifest. New snapshots are staged and verified completely
  before activation, interrupted updates retain the last working snapshot, and
  Nearby/offline operation blocks required Internet traffic.
- Bundled all QR dependencies locally, extended the generated offline archive
  to include the shell and Nearby modules, and added browser-facing status,
  progress, network mode, and storage-persistence handling.
- Updated the Android wrapper for persistent-shell Back/Home behavior, QR camera
  permission, exact archive-bound offline readiness, and archive networking
  that pauses throughout Nearby sessions, while keeping Nearby available to
  ordinary browsers without the APK.

## 2.3.0 - 2026-08-31

### Web update - 2026-09-01

- Restored the normal Windows and Android system keyboard for text entry across
  the Arcade, removing the shared and Sorry-specific HTML keyboards.
- Reworked online Chess joining into a dedicated, responsive room-code pane
  with a large native input and submit-time validation that preserves IME input
  order.
- Corrected Chess startup so the Local, CPU, and Online choices always appear
  before any saved online room is resumed. Saved rooms now require an explicit
  Resume Room selection.
- Removed Backyard Baseball from the published catalog and offline archive.
- Made Chess opponent pieces face the opposite player by default only in local
  same-device PvP. CPU and online play now default to upright pieces, with a
  separate persistent override retained for every mode.
- Added reconnecting online rooms to Sorry, Monopoly, Memory, Tic Tac Toe,
  Dots, and Checkers while preserving their existing local play modes.
- Added Arcade Chat, a live multi-user room with nicknames, room codes,
  presence, reconnect support, and safe real-time messages.
- Extended the Cloudflare Worker with reusable, versioned multiplayer rooms,
  durable seat ownership, presence, bounded state, and reconnect tokens.
- Added a source-controlled GitHub Actions release workflow so tested Worker
  changes deploy automatically without storing Cloudflare credentials in the
  repository.

- Made the Android wrapper GitHub Pages first, with a complete staged,
  hash-validated, atomic last-known-good offline archive and fast failure
  fallback.
- Improved Arcade menu title sizing and two-line layout across realistic phone
  portrait and landscape sizes.
- Redesigned Blackjack as a quicker, polished casino table, repaired its
  landscape layout, and added persistent player-approved loans with per-round
  compound interest and partial repayment.
- Reworked Face Lab into a responsive, touch-friendly customization studio.
- Added server-authoritative, reconnecting online Chess through the project's
  Cloudflare Worker and Durable Object, while retaining local PvP and every CPU
  difficulty.
- Simplified Chess setup, moved secondary options into Settings, and added a
  persistent opponent-piece orientation preference.
- Made Sorry card and pawn interactions direct and discoverable, including
  interactive 7 splits, 11 swaps, Sorry bumps, and the positive-card start
  house rule.
- Added Solitaire Parlor with Klondike draw 1/3, Spider 1/2/4 suits,
  FreeCell, Pyramid, hints, undo, statistics, and autosave.
- Added Regex Lab with Match Hunt, Pattern Forge, Repair Shop, and timed Regex
  Rush across four generative difficulty levels.
- Established a new Android release signing identity. Devices with an older
  differently signed build require a one-time uninstall before installing
  2.3.0; retained signing credentials allow normal in-place updates afterward.
- Updated release, backend, build, metadata, and operational documentation.

## 2.2.0 - 2026-08-29

- Switched the Android wrapper to load the GitHub Pages arcade by default.
- Added site-wide service-worker caching for offline recovery.

## 2.1.0

- Added native offline text-to-speech support and WebView recovery hardening.

## 2.0.1

- Added external-folder recovery and WebView lifecycle hardening.
