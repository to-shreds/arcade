# Family Arcade

The production arcade is served from this repository at
[to-shreds.github.io/arcade](https://to-shreds.github.io/arcade/).

GitHub is the content source of truth. Each game lives in a self-contained
folder with its entry page, icon, and `game.json` metadata. `catalog.json`
powers the central menu, and the generated offline manifest describes the
complete web release.

## Nearby Arcade

Nearby Arcade connects browsers once at the main Arcade and keeps that
connection while players move among games. It is a transport for each game's
existing **Multiplayer** choice, not another game mode.

1. Put the prepared devices on the same Wi-Fi network or phone hotspot.
2. On the main Arcade, choose **Connect Devices**, then start or join Nearby
   Arcade and choose a nickname and avatar.
3. Scan the host invitation, then scan the guest response. The Arcade confirms
   when the devices are connected.
4. Open any supported activity and choose its normal **Multiplayer** option.
   Pairing is not repeated when players return home and open another game.

Internet is not needed during Nearby play. Each browser must first visit the
Arcade and complete **Make Available Offline** while it has Internet access. A
device that has never downloaded a website cannot open that site while offline.

Nearby transport is integrated with Chess, Sorry, Monopoly, Memory, Tic Tac
Toe, Dots, Checkers, and Arcade Chat. Local same-device play and CPU modes are
unchanged. Direct links such as `/chess/` also remain usable; without the
persistent Arcade shell they use Internet multiplayer through Cloudflare.

## Repository layout

- `index.html`, `arcade-shell.js`, and `arcade-shell.css`: persistent web shell
- `multiplayer/`: shared bridge, Nearby session, QR/WebRTC, room authority, and
  environment-neutral room models
- `catalog.json` and shared `arcade-*` files: catalog and common web behavior
- game folders: self-contained games and activities
- `android-wrapper/`: Android wrapper source and reproducible build helper
- `cloudflare/chess-worker/`: Arcade multiplayer Worker and Durable Object source
- `tools/`: release and offline-manifest utilities
- `releases/`: intentionally retained, installable release APKs
- `licenses/`: project and third-party notices
- `CHANGELOG.md`: release history and user-visible changes

## Persistent shell and shared multiplayer transport

`index.html` remains the top-level document after a game opens. The shell shows
the selected game in a same-origin, full-viewport iframe, so the Nearby WebRTC
connections, player list, invitations, and session score remain alive. Arcade
Home and browser Back close the game viewport without destroying the shell.
Games remain separate HTML applications and keep direct-link behavior.

`multiplayer/arcade-multiplayer.js` is the small game-side bridge. Inside the
shell it exchanges bounded, validated messages only with the same-origin parent
and routes the existing Arcade room HTTP and WebSocket operations through the
shell. Outside the shell, the existing Cloudflare requests continue normally.
The bridge also supplies the locked Nearby identity, connection status,
invitations, completion reporting, and shell-aware Home behavior.

Transport selection happens when a multiplayer room is created, joined, or
resumed:

- With an active Nearby Arcade session, room traffic uses `NearbyTransport`.
- Without Nearby Arcade, room traffic uses `CloudflareTransport` exactly as it
  did before this release.
- The chosen transport is pinned for the active room. A lost Nearby connection
  is reported and retried locally; the room is never silently moved to
  Cloudflare. An active Cloudflare room is likewise never migrated into Nearby.
- A saved Internet room is not resumed while Nearby is active, because doing so
  would make an Internet request from a Nearby game frame. The saved room and
  token remain intact, and the player can disconnect Nearby to resume it.
- Leaving the room clears that pin, so a future room uses the transport that is
  active at that time.

No game has separate Online and Nearby buttons. A small read-only status may
say `Nearby Arcade · 3 connected` or `Internet`, but connection management
belongs to the main Arcade.

## Nearby design

Nearby Arcade uses data-only WebRTC with an authoritative host and a star
topology. Each guest connects to the host, and the host routes canonical room
state to the other participants. Peer connections use local host candidates
with an empty ICE server list, so Nearby runtime does not contact public STUN,
TURN, Cloudflare, or another signaling service.

Signaling is fully offline. The host and guest exchange a short-lived,
secret-bearing WebRTC offer and answer through QR codes. Payloads use compact,
URL-safe serialization and protocol `arcade-nearby` version 1. When a payload is
too large for one reliable QR code, the display rotates through numbered frames
and the scanner reassembles and verifies them automatically. QR generation and
the `jsQR` fallback decoder are bundled locally; `BarcodeDetector` is only an
optional fast path. Camera scanning, image import, and copy/paste fallbacks use
the same validated payload format.

One Nearby Arcade session contains members and zero or more game rooms. The
session persists while players switch activities. A Chess room, Sorry room, or
Chat room can start and finish without ending the underlying peer connection.
Friendly invitations let another paired device join a room without repeatedly
typing a room code.

The host binds each peer connection to a browser identity. The browser keeps a
cryptographically random identity and reconnect secret in IndexedDB, and proves
that identity when rejoining the same live session. Nicknames are normalized,
unique, and locked with the chosen avatar after admission. Games and Chat use
that host-owned member record and cannot override it with a `username` field.
Removed and disconnected identities remain reserved for the session. This is
normal family-room integrity, not an account system: clearing all site storage
allows a browser to appear as a new device.

The Nearby host is authoritative for membership, seat ownership, room status,
turn ownership, bounded actions, state versions, reconnection, and canonical
broadcasts. Chess runs the shared Chess engine and validates legal moves,
castling, en passant, promotion, endings, resignation, draw, and undo rules.
Memory, Tic Tac Toe, Dots, and Checkers validate each exact board transition.
Sorry validates the canonical deck and card consumption plus legal single,
split-7, switch, bump, Fire, and Ice resolutions. Monopoly uses explicit action
intents and validates its cash, deed, building, card, debt, auction, trade,
bankruptcy, turn, and completion ledgers. Nested player labels come from the
locked Nearby membership rather than peer-supplied names. The Nearby host also
originates Sorry's opening shuffle and Monopoly's opening decks, deeds, dice,
and card-specific rolls instead of accepting a player's chosen randomness.

The deployed Cloudflare generic-room service retains its compatible snapshot
contract for Internet play. The additional semantic validators run in the
Nearby host, before the shared room model commits or broadcasts a candidate.
An explicit player departure safely abandons an active generic Nearby game
instead of leaving an impossible turn or stale roster; the underlying Nearby
Arcade session remains available for the next game.

## Browser PWA and offline operation

The installable browser PWA uses `manifest.webmanifest` and a versioned service
worker snapshot. **Make Available Offline** downloads every file in the
generated `offline-manifest.json`, verifies its byte count and SHA-256 digest,
and reports progress. The new snapshot becomes active only after the whole
manifest validates. An interrupted or invalid update leaves the prior complete
snapshot available, and obsolete caches are removed only after a successful
replacement. The shell requests persistent storage where supported, but browser
storage can still be evicted by the operating system.

While Nearby or explicit offline mode is active, supported same-origin Arcade
requests are served cache-first and no Cloudflare room request is made. QR
libraries, icons, scripts, styles, and all supported game assets are included in
the generated snapshot rather than fetched from a CDN.

The Android app ordinarily opens the GitHub Pages production site, so web game
updates do not require a new APK. It also stages and validates a complete
app-managed snapshot of the site. Only a fully downloaded, hash-verified
snapshot becomes the last-known-good offline copy. If Pages is unreachable,
the connection is captive, or an update fails partway through, the wrapper
falls back to the previous complete snapshot while preserving WebView storage,
game saves, preferences, and statistics.

The generated manifest must be refreshed whenever deployable web content
changes:

```sh
node tools/generate-offline-manifest.mjs --version 2.4.0+20260901.1
```

## Practical browser limitations

- Camera scanning requires a secure HTTPS or installed PWA context and browser
  permission. Image import and copy/paste remain available when camera access is
  unavailable.
- Some Safari versions request Local Network permission. Guest, school, and
  hotel Wi-Fi may isolate devices from one another; a phone hotspot usually
  works better.
- With no public STUN or TURN service, pairing is deliberately limited to local
  network paths that the browsers expose. Browser privacy features may represent
  local candidates with mDNS names. Signaling rejects public, relay, and
  server-reflexive candidates; the supported paths are private IPv4,
  link-local addresses, IPv6 unique-local addresses, and mDNS host candidates.
  A network that exposes only globally routed IPv6 candidates is therefore not
  a supported Nearby path.
- A WebRTC connection cannot survive a full browser restart. The Arcade keeps
  session identity and host checkpoints, then offers a friendly re-pair flow.
  It does not attempt distributed host election or automatic host migration.
- Mobile browsers may suspend a backgrounded page. The host requests Screen
  Wake Lock while active where supported, but this is best effort.

## Android operation

Nearby Arcade is a browser feature and does not require the Android wrapper.
The wrapper supports the same persistent shell, camera permission for QR
scanning, shell-aware Back/Home behavior, and remote-first/archive-fallback
architecture.

## Building Android

See `android-wrapper/README.md`. Private signing keys and passwords are never
stored in this public repository. The retained APK in `releases/` is built
from the same source revision as the release commit.

## Cloudflare multiplayer

The browser contains no Cloudflare credential. It connects only to the public
Worker endpoint. The Worker keeps Chess authoritative and provides reusable,
versioned rooms, presence, reconnection, seat ownership, and room chat for the
other Internet games. Backend source, tests, and safe Wrangler configuration
live under `cloudflare/chess-worker/`; deployment credentials remain in
Cloudflare or the operator's environment. Nearby identities, messages, game
state, reactions, and Arcade Stars stay on the paired devices and are not
uploaded to the Worker.
