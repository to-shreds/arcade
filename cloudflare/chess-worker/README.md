# Arcade Chess Worker

Cloudflare Worker and SQLite-backed Durable Object for Arcade Chess online play. The Durable Object is the authority for room membership, turns, legal moves, castling, en passant, promotion, check, checkmate, stalemate, the 50-move rule, threefold repetition, insufficient material, resignation, and mutually approved undo/draw requests.

## Local verification

```sh
npm install
npm test
npx wrangler deploy --dry-run
```

The test suite includes engine perft/reference checks, special moves and endings, two-seat authorization, stale-state rejection, reconnect recovery, fair request flows, and two independent clients against Miniflare.

## Deploy

Authenticate Wrangler outside source control, then run `npx wrangler deploy`. No runtime secret is required. `ALLOWED_ORIGINS` in `wrangler.toml` contains the production GitHub Pages origin, Android wrapper origin, and local development origins. The production client points to `https://arcade-chess.jonathanjablon.workers.dev`; update `CHESS_API_BASE` only if the Worker name or account subdomain changes.

## Public protocol

- `POST /api/chess/rooms` creates a room and returns White's reconnect token.
- `POST /api/chess/rooms/{code}/join` claims Black or reconnects with an existing token.
- `GET /api/chess/rooms/{code}/state` returns authoritative state for a bearer token.
- `POST /api/chess/rooms/{code}/actions` submits a versioned move, request, response, or resignation.
- `GET /api/chess/rooms/{code}/ws?token=...` upgrades to a live state/presence channel.

Room codes exclude ambiguous characters. Reconnect tokens are shown only to their player and are stored as SHA-256 hashes in Durable Object storage. Browser origins are checked for HTTP and WebSocket entry points. Privileged Cloudflare deployment credentials do not belong in this directory or any client file.
