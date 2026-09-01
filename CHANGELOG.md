# Changelog

## 2.3.0 - 2026-08-31

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
