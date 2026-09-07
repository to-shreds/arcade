# Guess Who

Two players use separate devices. Create a room, share its code, and start when
both players have joined. Each player privately chooses one of 24 original
characters. The choice locks for the round, and both players may choose the
same character.

A built-in question is answered by the room authority from the character's
actual traits. A custom question goes to the other player, who answers Yes,
No, or Not sure before taking their own turn. Custom answers are not verified
and never drive automatic elimination. Players can flip or restore cards
without consuming a turn; Undo affects only those private card changes.

A correct final guess wins. An incorrect final guess loses immediately.
Resignation awards the round to the other player. Leaving ends an active round
without a score. Both players must approve a rematch; scores carry forward and
the starting player alternates. The first round's starting player is randomized.

## Shared framework

The page loads `arcade-ui.css` and `arcade-multiplayer.js`. It uses the existing
`/api/arcade/rooms` endpoints and `ARCADE_ROOMS` Durable Object binding with
`game: "guess-who"`. Nearby invitations, persistent shell navigation, transport
pinning, turn sounds, and notification permission use the existing bridge.
There is no new backend service or Durable Object migration.

`multiplayer/models/guess-who-data.js` supplies the same roster and trait
questions to the renderer and room authority. `guess-who-authority.js` handles
intents inside `GenericRoomModel` on both Cloudflare and Nearby. It validates
`start`, `choose`, `ask`, `answer`, `guess`, `resign`, and `rematch`; clients cannot
submit replacement game state, results, secret maps, or turn owners. Every
non-chat/non-leave action uses the framework's exact `expectedVersion` check.
The frontend may refresh and safely retry a same-round choice or rematch vote
once after a version conflict. It never replays questions or guesses.

Public state is explicitly whitelisted for each viewer before HTTP responses
and WebSocket/Nearby broadcasts. Only that viewer's character is included until
an ordinary scored round ends. An abandoned round does not reveal the other
character. The Nearby host holds both secrets and must be trusted; this does
not hide secrets from a person controlling the host device or the Worker.

The browser saves its reconnect token and card notebook, not a private room
snapshot. Internet and Nearby saves use separate keys. Closing or returning to
Arcade preserves the seat; explicit Leave removes it after the authority
accepts the departure. Clearing browser storage removes that browser's recovery
credentials. Questions and game progress are retained by the room authority.

## Deployment and offline use

Publish the updated web files and deploy the existing Cloudflare Worker. The
repository's Worker deployment workflow covers changes to the shared room
models. Refresh the PWA snapshot with the new offline manifest. Internet play
requires the Worker; offline play requires both devices to have prepared the
updated Arcade and established a Nearby connection at the main menu.

The game is part of the full Arcade distribution. Opening its HTML alone from
`file://` is not a supported multiplayer deployment: its shared files, secure
origin, and the Worker's existing allowed-origin rules still apply.

## Verification

From the repository root:

```sh
npm ci --prefix cloudflare/chess-worker
npm test --prefix cloudflare/chess-worker
node --test multiplayer/test/*.test.mjs
node tools/test-offline-runtime.mjs
```

For actual two-browser interaction and responsive screenshots, install Python
Playwright 1.57.0 and its Chromium browser, run `node guess-who/test-server.mjs`,
then run `python guess-who/test-browser.py` in another terminal. The test maps
only the production Worker address to the real local Miniflare Worker. Game
rules and room state are not mocked. Screenshots go to
`test-results/guess-who`. Test helpers are excluded from offline packaging.
