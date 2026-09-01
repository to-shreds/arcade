import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";

const ORIGIN = "http://localhost:8787";

function headers(token = null) {
  const value = { Origin: ORIGIN, "content-type": "application/json" };
  if (token) value.authorization = `Bearer ${token}`;
  return value;
}

function nextMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("WebSocket message timed out"));
    }, 2000);
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    }
    socket.addEventListener("message", onMessage);
  });
}

function createMiniflare() {
  const sourceRoot = new URL("../../../", import.meta.url).pathname;
  return new Miniflare({
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
    durableObjects: { ARCADE_ROOMS: { className: "ArcadeRoom", useSQLite: true } }
  });
}

test("independent generic clients create, join, synchronize, chat, and reconnect through Miniflare", async (t) => {
  const mf = createMiniflare();
  t.after(() => mf.dispose());

  const createResponse = await mf.dispatchFetch("http://worker/api/arcade/rooms", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ game: "dots", username: "Alice", maxPlayers: 2, state: { lines: [] } })
  });
  assert.equal(createResponse.status, 200);
  assert.equal(createResponse.headers.get("access-control-allow-origin"), ORIGIN);
  const host = await createResponse.json();
  assert.equal(host.ok, true);
  assert.match(host.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(host.room.status, "lobby");
  assert.equal(host.room.ready, false);

  const joinResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${host.code}/join`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ username: "Bob" })
  });
  assert.equal(joinResponse.status, 200);
  const guest = await joinResponse.json();
  assert.equal(guest.seat, 1);
  assert.equal(guest.room.ready, true);

  const hostSocketResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${host.code}/ws?token=${host.token}`, {
    headers: { Origin: ORIGIN, Upgrade: "websocket" }
  });
  assert.equal(hostSocketResponse.status, 101);
  const hostSocket = hostSocketResponse.webSocket;
  hostSocket.accept();
  const hostInitial = await nextMessage(hostSocket, (message) => message.type === "state");
  assert.equal(hostInitial.room.playerId, host.playerId);

  const guestSocketResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${host.code}/ws?token=${guest.token}`, {
    headers: { Origin: ORIGIN, Upgrade: "websocket" }
  });
  assert.equal(guestSocketResponse.status, 101);
  const guestSocket = guestSocketResponse.webSocket;
  guestSocket.accept();
  const guestInitial = await nextMessage(guestSocket, (message) => message.type === "state" && message.room.presence[host.playerId] === true);
  assert.equal(guestInitial.room.presence[guest.playerId], true);

  const hostStartedLive = nextMessage(hostSocket, (message) => message.type === "state" && message.room.status === "active");
  const guestStartedLive = nextMessage(guestSocket, (message) => message.type === "state" && message.room.status === "active");
  const startResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${host.code}/actions`, {
    method: "POST",
    headers: headers(host.token),
    body: JSON.stringify({ type: "start", expectedVersion: guest.room.version, firstSeat: 0 })
  });
  assert.equal(startResponse.status, 200);
  const started = await startResponse.json();
  const [hostStarted, guestStarted] = await Promise.all([hostStartedLive, guestStartedLive]);
  assert.equal(hostStarted.room.turn.playerId, host.playerId);
  assert.equal(guestStarted.room.turn.playerId, host.playerId);

  const theftError = nextMessage(guestSocket, (message) => message.type === "error");
  guestSocket.send(JSON.stringify({
    type: "state",
    expectedVersion: started.room.version,
    state: { lines: ["stolen"] },
    nextSeat: 0
  }));
  const rejected = await theftError;
  assert.equal(rejected.status, 403);
  assert.equal(rejected.error, "It is not your turn");

  const hostMovedLive = nextMessage(hostSocket, (message) => message.type === "state" && message.room.state?.lines?.length === 1);
  const guestMovedLive = nextMessage(guestSocket, (message) => message.type === "state" && message.room.state?.lines?.length === 1);
  hostSocket.send(JSON.stringify({
    type: "state",
    expectedVersion: started.room.version,
    state: { lines: ["0,0-1,0"], scores: [0, 0] },
    nextSeat: 1
  }));
  const [hostMoved, guestMoved] = await Promise.all([hostMovedLive, guestMovedLive]);
  assert.deepEqual(hostMoved.room.state.lines, ["0,0-1,0"]);
  assert.equal(guestMoved.room.turn.playerId, guest.playerId);

  const chatLive = nextMessage(hostSocket, (message) => message.type === "state" && message.room.chat.length === 1);
  const chatResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${host.code}/actions`, {
    method: "POST",
    headers: headers(guest.token),
    body: JSON.stringify({ type: "chat", text: "Nice move!" })
  });
  assert.equal(chatResponse.status, 200);
  const chat = await chatResponse.json();
  assert.equal(chat.room.chat[0].username, "Bob");
  assert.equal((await chatLive).room.chat[0].text, "Nice move!");

  const stateResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${host.code}/state`, {
    headers: { Origin: ORIGIN, authorization: `Bearer ${guest.token}` }
  });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.room.playerId, guest.playerId);
  assert.deepEqual(state.room.state.lines, ["0,0-1,0"]);

  const reconnectResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${host.code}/join`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ reconnectToken: guest.token })
  });
  assert.equal(reconnectResponse.status, 200);
  const restored = await reconnectResponse.json();
  assert.equal(restored.playerId, guest.playerId);
  assert.equal(restored.seat, guest.seat);
  assert.equal(restored.token, guest.token);

  const staleResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${host.code}/actions`, {
    method: "POST",
    headers: headers(guest.token),
    body: JSON.stringify({ type: "state", expectedVersion: started.room.version, state: {}, nextSeat: 0 })
  });
  assert.equal(staleResponse.status, 409);

  const badOrigin = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${host.code}/state`, {
    headers: { Origin: "https://evil.example", authorization: `Bearer ${host.token}` }
  });
  assert.equal(badOrigin.status, 403);

  hostSocket.close(1000, "test complete");
  guestSocket.close(1000, "test complete");
});

test("generic HTTP routes reject invalid games, methods, origins, and room codes", async (t) => {
  const mf = createMiniflare();
  t.after(() => mf.dispose());

  const invalidGame = await mf.dispatchFetch("http://worker/api/arcade/rooms", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ game: "poker", username: "Alice" })
  });
  assert.equal(invalidGame.status, 400);

  const invalidCode = await mf.dispatchFetch("http://worker/api/arcade/rooms/NOPE/state", {
    headers: { Origin: ORIGIN, authorization: "Bearer invalid" }
  });
  assert.equal(invalidCode.status, 400);

  const wrongMethod = await mf.dispatchFetch("http://worker/api/arcade/rooms", { headers: { Origin: ORIGIN } });
  assert.equal(wrongMethod.status, 404);

  const badContentType = await mf.dispatchFetch("http://worker/api/arcade/rooms", {
    method: "POST",
    headers: { Origin: ORIGIN, "content-type": "text/plain" },
    body: "{}"
  });
  assert.equal(badContentType.status, 415);

  const nullBody = await mf.dispatchFetch("http://worker/api/arcade/rooms", {
    method: "POST",
    headers: headers(),
    body: "null"
  });
  assert.equal(nullBody.status, 400);

  const oversizedBody = await mf.dispatchFetch("http://worker/api/arcade/rooms", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ game: "chat", username: "Alice", padding: "x".repeat(400 * 1024) })
  });
  assert.equal(oversizedBody.status, 413);
});

test("chat does not stale gameplay versions and last-member leave is stale-safe and terminal", async (t) => {
  const mf = createMiniflare();
  t.after(() => mf.dispose());

  const createdResponse = await mf.dispatchFetch("http://worker/api/arcade/rooms", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ game: "chat", username: "Alice", maxPlayers: 2 })
  });
  const created = await createdResponse.json();
  const initialVersion = created.room.version;

  const messageResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${created.code}/actions`, {
    method: "POST",
    headers: headers(created.token),
    body: JSON.stringify({ type: "chat", text: "One last message" })
  });
  assert.equal(messageResponse.status, 200);
  const messaged = await messageResponse.json();
  assert.equal(messaged.room.version, initialVersion);
  assert.equal(messaged.room.chatVersion, 1);

  const throttledResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${created.code}/actions`, {
    method: "POST",
    headers: headers(created.token),
    body: JSON.stringify({ type: "chat", text: "Sent too quickly" })
  });
  assert.equal(throttledResponse.status, 429);

  const leaveResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${created.code}/actions`, {
    method: "POST",
    headers: headers(created.token),
    body: JSON.stringify({ type: "leave", expectedVersion: initialVersion - 100 })
  });
  assert.equal(leaveResponse.status, 200);
  const left = await leaveResponse.json();
  assert.equal(left.room.status, "finished");
  assert.equal(left.room.members.length, 0);

  const retryLeaveResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${created.code}/actions`, {
    method: "POST",
    headers: headers(created.token),
    body: JSON.stringify({ type: "leave" })
  });
  assert.equal(retryLeaveResponse.status, 200);

  const lateJoinResponse = await mf.dispatchFetch(`http://worker/api/arcade/rooms/${created.code}/join`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ username: "Bob" })
  });
  assert.equal(lateJoinResponse.status, 410);
});
