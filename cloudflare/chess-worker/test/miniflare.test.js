import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";

const ORIGIN = "http://localhost:8787";

function headers(token = null) {
  const value = { Origin: ORIGIN, "content-type": "application/json" };
  if (token) value.authorization = `Bearer ${token}`;
  return value;
}

test("two independent clients create, join, reconnect and synchronize through Miniflare", async (t) => {
  const sourceRoot = new URL("../src/", import.meta.url).pathname;
  const mf = new Miniflare({
    modulesRoot: sourceRoot,
    modules: [
      { type: "ESModule", path: new URL("../src/index.js", import.meta.url).pathname },
      { type: "ESModule", path: new URL("../src/room-model.js", import.meta.url).pathname },
      { type: "ESModule", path: new URL("../src/chess-engine.js", import.meta.url).pathname }
    ],
    compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { ALLOWED_ORIGINS: `${ORIGIN},https://to-shreds.github.io,https://arcade.local` },
    durableObjects: { CHESS_ROOMS: { className: "ChessRoom", useSQLite: true } }
  });
  t.after(() => mf.dispose());

  const create = await mf.dispatchFetch("http://worker/api/chess/rooms", { method: "POST", headers: headers(), body: "{}" });
  assert.equal(create.status, 200);
  const first = await create.json();
  const code = first.room.code;

  const join = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/join`, { method: "POST", headers: headers(), body: "{}" });
  assert.equal(join.status, 200);
  const second = await join.json();
  assert.equal(first.side, "w");
  assert.equal(second.side, "b");

  const rejectedSocket = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/ws?token=${first.token}`, { headers: { Origin: "https://evil.example", Upgrade: "websocket" } });
  assert.equal(rejectedSocket.status, 403);
  const socketResponse = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/ws?token=${first.token}`, { headers: { Origin: ORIGIN, Upgrade: "websocket" } });
  assert.equal(socketResponse.status, 101);
  const socket = socketResponse.webSocket;
  socket.accept();
  const firstSocketState = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket state timed out")), 1500);
    socket.addEventListener("message", (event) => { clearTimeout(timeout); resolve(JSON.parse(event.data)); }, { once: true });
  });
  assert.equal(firstSocketState.type, "state");
  assert.equal(firstSocketState.room.side, "w");

  const firstMove = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/actions`, {
    method: "POST", headers: headers(first.token), body: JSON.stringify({ type: "move", uci: "e2e4", expectedVersion: second.room.version })
  });
  assert.equal(firstMove.status, 200);

  const blackView = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/state`, { headers: { Origin: ORIGIN, authorization: `Bearer ${second.token}` } });
  const blackState = await blackView.json();
  assert.equal(blackState.room.game.moves[0].uci, "e2e4");
  assert.equal(blackState.room.game.turn, "b");

  const reconnect = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/join`, {
    method: "POST", headers: headers(), body: JSON.stringify({ reconnectToken: first.token })
  });
  const restored = await reconnect.json();
  assert.equal(restored.side, "w");
  assert.equal(restored.room.game.moves[0].uci, "e2e4");

  const stolen = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/actions`, {
    method: "POST", headers: headers(first.token), body: JSON.stringify({ type: "move", uci: "e7e5", expectedVersion: restored.room.version })
  });
  assert.equal(stolen.status, 403);

  const badOrigin = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/state`, { headers: { Origin: "https://evil.example", authorization: `Bearer ${first.token}` } });
  assert.equal(badOrigin.status, 403);
  socket.close(1000, "test complete");
});
