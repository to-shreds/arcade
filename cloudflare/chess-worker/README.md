# Arcade Multiplayer Worker

Cloudflare Worker and SQLite-backed Durable Objects for the Arcade's online rooms.

This Worker remains the default Internet transport. Nearby Arcade is an
index-level browser transport, not another Worker route or a separate game
mode. `multiplayer/arcade-multiplayer.js` sends room operations to this Worker
when no Nearby session is active. With Nearby active, the same client operations
are sent through the persistent Arcade shell to the authoritative browser host,
with no Cloudflare request. The selected authority is pinned for the life of an
active game room and is never changed silently after a connection failure.

- `ChessRoom` remains the authoritative Chess service. It validates membership, turns, every legal move, special moves, endings, resignation, and mutually approved undo/draw requests.
- `ArcadeRoom` is the shared room, presence, chat, reconnection, and state-synchronization service for Sorry, Monopoly, Memory, Tic-Tac-Toe, Dots, Checkers, and the standalone Chat Room.

Each room is a single Durable Object, so membership changes and game-state replacements are serialized. Token hashing happens before room storage is read, keeping the load/check/write section inside the Durable Object input gate. Reconnect tokens identify seats, exact game versions prevent lost updates, and the server owns the current turn metadata. Generic game snapshots are opaque JSON; the game client still produces the rules-validated snapshot, while the room prevents a different seat, a stale client, or two concurrent requests from silently replacing it.

## Shared authority and Nearby parity

The environment-neutral room models under `multiplayer/models/` are shared by
the Cloudflare service and the browser-hosted `NearbyRoomService`. This keeps
room creation, tokens, reconnect behavior, seat assignment, compare-and-swap
versions, turn ownership, bounds, presence, room chat, and result shape aligned
between transports. The Nearby host additionally binds each request to the
locked Arcade-session member identity, rejects identity fields supplied by a
game action, and rejects rename actions for the life of that Nearby session.

Chess has strict rule authority in both environments. The shared Chess engine
validates ordinary moves, captures, turns, castling, en passant, promotion,
check, endings, resignation, and the supported draw and undo flows before it
broadcasts canonical state.

The deployed generic `ArcadeRoom` keeps its compatible Internet snapshot
contract. The Nearby host adds a semantic validation layer before that shared
model commits a candidate: Memory, Tic-Tac-Toe, Dots, and Checkers validate an
exact board transition; Sorry validates its canonical deck and legal card,
pawn, Fire, and Ice resolutions; and Monopoly validates explicit action intents
against its complete economic and property ledger. Nested labels are bound to
the locked Arcade membership. Invalid, stale, oversized, or unbroadcastable
candidates are rejected transactionally without mutating the canonical room.
Arcade Chat is host-routed, bounded, rate-limited, and associated with the
authoritative locked member identity.

Nearby Arcade protocol `arcade-nearby` version 1, QR signaling, WebRTC peer
connections, IndexedDB checkpoints, and session UI live in `multiplayer/` and
the root shell files. They do not run in Cloudflare. Nearby session identities,
messages, game state, reactions, and Arcade Stars remain on the paired devices.

The Nearby Arcade session and a game room are separate scopes. A host may keep
the same peer star connected while a Chess room ends and a Sorry room begins.
The existing Worker room codes remain available for Internet multiplayer and as
a familiar game-room concept, but QR pairing establishes the Arcade transport,
not a Worker room.

## Local verification

```sh
npm install
npm test
npx wrangler deploy --dry-run
```

The test suite includes engine perft/reference checks, Chess special moves and endings, generic seat and host authorization, state-size limits, stale-state rejection, turn enforcement, reconnect recovery, bounded chat, and independent WebSocket clients against Miniflare.

## Deploy

Production deployment is automated by `.github/workflows/deploy-arcade-worker.yml`. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as encrypted GitHub Actions repository secrets. The API token should use Cloudflare's **Edit Cloudflare Workers** template and be restricted to the account that owns this Worker. A push to `main` that changes this directory then runs the complete Worker tests before deploying. The workflow can also be started manually from GitHub Actions.

For an authorized local deployment, authenticate Wrangler outside source control and run `npx wrangler deploy`. No runtime secret is required. `ALLOWED_ORIGINS` in `wrangler.toml` contains the production GitHub Pages origin, Android wrapper origin, and local development origins. The production clients point to `https://arcade-chess.jonathanjablon.workers.dev`; update the client API constants only if the Worker name or account subdomain changes.

The `v2` Durable Object migration creates `ArcadeRoom`. Do not remove or renumber the existing `v1` Chess migration.

## Chess protocol

- `POST /api/chess/rooms` creates a room and returns White's reconnect token.
- `POST /api/chess/rooms/{code}/join` claims Black or reconnects with an existing token.
- `GET /api/chess/rooms/{code}/state` returns authoritative state for a bearer token.
- `POST /api/chess/rooms/{code}/actions` submits a versioned move, request, response, or resignation.
- `GET /api/chess/rooms/{code}/ws?token=...` upgrades to a live state/presence channel.

Room codes exclude ambiguous characters. Reconnect tokens are shown only to their player and are stored as SHA-256 hashes in Durable Object storage. Browser origins are checked for HTTP and WebSocket entry points. Privileged Cloudflare deployment credentials do not belong in this directory or any client file.

## Shared Arcade room protocol

All requests use JSON. Authenticated HTTP routes expect `Authorization: Bearer RECONNECT_TOKEN`.

### Create and join

`POST /api/arcade/rooms`

```json
{
  "game": "sorry",
  "username": "Alice",
  "maxPlayers": 4,
  "state": { "optional": "initial lobby or game data" }
}
```

Supported room types and seat limits:

| Game ID | Players |
| --- | ---: |
| `sorry` | 2-4 |
| `monopoly` | 2-6 |
| `memory` | 2-4 |
| `tic-tac-toe` | 2 |
| `dots` | 2-4 |
| `checkers` | 2 |
| `chat` | 1-32 |

`POST /api/arcade/rooms/{code}/join`

```json
{ "username": "Bob" }
```

To reconnect, send the previously saved token instead. The original player ID and zero-based seat are restored:

```json
{ "reconnectToken": "saved-private-token" }
```

Create and join return:

```json
{
  "ok": true,
  "code": "ABC234",
  "token": "private-reconnect-token",
  "playerId": "p_example",
  "seat": 0,
  "room": {}
}
```

The token is returned only by create/join. Clients should save it in private app storage and must never put it in a shared game snapshot, chat message, repository file, or log.

### State and actions

- `GET /api/arcade/rooms/{code}/state` returns `{ "ok": true, "room": ... }` for a bearer token.
- `POST /api/arcade/rooms/{code}/actions` applies one action and returns the same shape.
- Start, state, restart, and rename require the exact current `expectedVersion`; stale requests return HTTP 409. Leave is token-authenticated, stale-safe, and idempotent.

Host-only start, after the room has `ready: true`:

```json
{ "type": "start", "expectedVersion": 2, "state": {}, "firstSeat": 0 }
```

Atomic full-state replacement by the current turn holder:

```json
{ "type": "state", "expectedVersion": 3, "state": {}, "nextSeat": 1 }
```

Finish a game with the final state and a small public result:

```json
{ "type": "state", "expectedVersion": 9, "state": {}, "finish": true, "result": { "winnerSeat": 1 } }
```

Other actions:

```json
{ "type": "chat", "text": "Good game!" }
{ "type": "rename", "expectedVersion": 10, "username": "New Name" }
{ "type": "leave" }
{ "type": "restart", "expectedVersion": 12, "state": {}, "firstSeat": 0 }
```

Chat does not require an expected version, so conversation does not fail merely because another message arrived first. Chat and rename update `revision` without changing the gameplay compare-and-swap `version`; messages also increment `chatVersion`. Restart is host-only and available after a finished game.

State snapshots are limited to 256 KiB, results to 16 KiB, usernames to 24 characters, messages to 500 characters, and retained chat history to the latest 100 messages. Per-member interval and burst limits reject chat spam with HTTP 429. Recent leave tombstones are capped, and a chat whose last member leaves is terminal; users create a fresh room instead of inheriting an abandoned room's history.

### Public room shape

```json
{
  "code": "ABC234",
  "game": "sorry",
  "version": 4,
  "revision": 8,
  "chatVersion": 3,
  "status": "lobby",
  "ready": true,
  "hostPlayerId": "p_example",
  "minPlayers": 2,
  "maxPlayers": 4,
  "playerId": "p_viewer",
  "seat": 1,
  "members": [
    { "playerId": "p_example", "seat": 0, "username": "Alice", "connected": true, "joinedAt": "..." }
  ],
  "presence": { "p_example": true },
  "turn": { "seat": 0, "playerId": "p_example", "number": 1 },
  "state": {},
  "result": null,
  "chat": [],
  "createdAt": "...",
  "updatedAt": "..."
}
```

Seats are always zero-based. `playerId` and `seat` describe the authenticated viewer. `version` is the compare-and-swap version used by game actions, `revision` changes for every persisted mutation, and `chatVersion` changes for each accepted message. `status` is `lobby`, `active`, or `finished`. Chat rooms begin active and have no turn.

### WebSocket

`GET /api/arcade/rooms/{code}/ws?token=RECONNECT_TOKEN` with a WebSocket upgrade opens the live channel.

- Server snapshots: `{ "type": "state", "room": ... }`
- Rejections: `{ "type": "error", "status": 409, "error": "..." }`
- A client may send any action object listed above over the socket instead of HTTP.

Presence is derived from authenticated live sockets and is broadcast on connect, disconnect, and reconnect. A dropped connection does not surrender the seat; reopening with the saved token restores the same identity and the latest authoritative snapshot.

## Security notes

Room codes are invitations, not credentials. Reconnect tokens contain 256 bits of randomness, are stored only as SHA-256 hashes, and are never exposed in public room state. Allowed browser origins are checked for HTTP and WebSocket entry points. Usernames, chat, state, results, and request bodies are bounded. Clients must render usernames and chat as text, not HTML. Privileged Cloudflare tokens and account credentials belong in Wrangler/Cloudflare secret storage and must not be committed.
