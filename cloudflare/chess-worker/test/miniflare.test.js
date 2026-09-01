import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";

const ORIGIN = "http://localhost:8787";

function headers(token = null) {
  const value = { Origin: ORIGIN, "content-type": "application/json" };
  if (token) value.authorization = `Bearer ${token}`;
  return value;
}

function nextRoom(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("WebSocket state timed out"));
    }, 1500);
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.type !== "state" || !predicate(message.room)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    }
    socket.addEventListener("message", onMessage);
  });
}

test("two independent clients create, join, reconnect and synchronize through Miniflare", async (t) => {
  const sourceRoot = new URL("../../../", import.meta.url).pathname;
  const mf = new Miniflare({
    modulesRoot: sourceRoot,
    modules: [
      { type: "ESModule", path: new URL("../src/index.js", import.meta.url).pathname },
      { type: "ESModule", path: new URL("../../../multiplayer/models/room-model.js", import.meta.url).pathname },
      { type: "ESModule", path: new URL("../../../multiplayer/models/generic-room-model.js", import.meta.url).pathname },
      { type: "ESModule", path: new URL("../../../multiplayer/models/chess-engine.js", import.meta.url).pathname }
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
  const firstSocketState = await nextRoom(socket);
  assert.equal(firstSocketState.type, "state");
  assert.equal(firstSocketState.room.side, "w");

  const blackSocketResponse = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/ws?token=${second.token}`, { headers: { Origin: ORIGIN, Upgrade: "websocket" } });
  assert.equal(blackSocketResponse.status, 101);
  const blackSocket = blackSocketResponse.webSocket;
  blackSocket.accept();
  const blackSocketState = await nextRoom(blackSocket);
  assert.equal(blackSocketState.room.side, "b");

  const whiteMoveBroadcast = nextRoom(socket, (room) => room.game.moves.length === 1);
  const blackMoveBroadcast = nextRoom(blackSocket, (room) => room.game.moves.length === 1);
  const firstMove = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/actions`, {
    method: "POST", headers: headers(first.token), body: JSON.stringify({ type: "move", uci: "e2e4", expectedVersion: second.room.version })
  });
  assert.equal(firstMove.status, 200);
  const [whiteLive, blackLive] = await Promise.all([whiteMoveBroadcast, blackMoveBroadcast]);
  assert.equal(whiteLive.room.game.moves[0].uci, "e2e4");
  assert.equal(blackLive.room.game.turn, "b");
  assert.deepEqual(blackLive.room.presence, { w: true, b: true });

  const whiteWebSocketMove = nextRoom(socket, (room) => room.game.moves.length === 2);
  const blackWebSocketMove = nextRoom(blackSocket, (room) => room.game.moves.length === 2);
  blackSocket.send(JSON.stringify({ type: "move", uci: "e7e5", expectedVersion: blackLive.room.version }));
  const [whiteAfterSocket, blackAfterSocket] = await Promise.all([whiteWebSocketMove, blackWebSocketMove]);
  assert.equal(whiteAfterSocket.room.game.moves[1].uci, "e7e5");
  assert.equal(blackAfterSocket.room.game.turn, "w");
  assert.equal(whiteAfterSocket.room.version, blackAfterSocket.room.version, "HTTP and WebSocket actions share one canonical version path");

  const blackView = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/state`, { headers: { Origin: ORIGIN, authorization: `Bearer ${second.token}` } });
  const blackState = await blackView.json();
  assert.equal(blackState.room.game.moves[0].uci, "e2e4");
  assert.equal(blackState.room.game.moves[1].uci, "e7e5");
  assert.equal(blackState.room.game.turn, "w");

  const reconnect = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/join`, {
    method: "POST", headers: headers(), body: JSON.stringify({ reconnectToken: first.token })
  });
  const restored = await reconnect.json();
  assert.equal(restored.side, "w");
  assert.equal(restored.room.game.moves[0].uci, "e2e4");
  assert.equal(restored.room.game.moves[1].uci, "e7e5");

  const stolen = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/actions`, {
    method: "POST", headers: headers(second.token), body: JSON.stringify({ type: "move", uci: "d7d5", expectedVersion: restored.room.version })
  });
  assert.equal(stolen.status, 403);

  socket.close(1000, "simulate interruption");
  const resumedSocketResponse = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/ws?token=${first.token}`, { headers: { Origin: ORIGIN, Upgrade: "websocket" } });
  assert.equal(resumedSocketResponse.status, 101);
  const resumedSocket = resumedSocketResponse.webSocket;
  resumedSocket.accept();
  const resumedLive = await nextRoom(resumedSocket, (room) => room.game.moves.length === 2);
  assert.equal(resumedLive.room.side, "w");
  assert.equal(resumedLive.room.game.moves[0].uci, "e2e4");
  assert.equal(resumedLive.room.game.moves[1].uci, "e7e5");

  const opponentCompletion = nextRoom(blackSocket, (room) => room.game.result.over);
  const leavingSocketClosed = new Promise((resolve) => resumedSocket.addEventListener("close", resolve, { once: true }));
  const leave = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/actions`, {
    method: "POST", headers: headers(first.token), body: JSON.stringify({ type: "leave", expectedVersion: resumedLive.room.version })
  });
  assert.equal(leave.status, 200);
  const completed = await opponentCompletion;
  assert.deepEqual(
    { reason: completed.room.game.result.reason, winner: completed.room.game.result.winner },
    { reason: "resignation", winner: "b" }
  );
  await leavingSocketClosed;
  const revoked = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/state`, { headers: { Origin: ORIGIN, authorization: `Bearer ${first.token}` } });
  assert.equal(revoked.status, 401);
  const replacement = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/join`, { method: "POST", headers: headers(), body: "{}" });
  assert.equal(replacement.status, 410);

  const badOrigin = await mf.dispatchFetch(`http://worker/api/chess/rooms/${code}/state`, { headers: { Origin: "https://evil.example", authorization: `Bearer ${first.token}` } });
  assert.equal(badOrigin.status, 403);
  resumedSocket.close(1000, "test complete");
  blackSocket.close(1000, "test complete");
});
