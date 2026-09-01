import test from "node:test";
import assert from "node:assert/strict";
import { GenericRoomModel, GAME_TYPES, GENERIC_ROOM_LIMITS, normalizeUsername } from "../src/generic-room-model.js";
import { MemoryStorage } from "../src/room-model.js";

async function createRoom(game = "sorry", options = {}) {
  const model = new GenericRoomModel(new MemoryStorage());
  const host = await model.create({ code: "ABC234", game, username: "Alice", ...options });
  return { model, host };
}

test("supported games enforce their public seat limits", async () => {
  for (const [game, config] of Object.entries(GAME_TYPES)) {
    const { host } = await createRoom(game);
    assert.equal(host.room.game, game);
    assert.equal(host.room.minPlayers, config.minPlayers);
    assert.equal(host.room.maxPlayers, config.maxSeats);
    assert.equal(host.room.seat, 0);
    assert.equal(host.room.playerId, host.playerId);
    assert.equal(host.room.members[0].username, "Alice");
    assert.equal("tokenHash" in host.room.members[0], false);
    assert.equal(host.room.status, game === "chat" ? "active" : "lobby");
  }

  await assert.rejects(
    new GenericRoomModel(new MemoryStorage()).create({ code: "ABC234", game: "checkers", username: "Alice", maxPlayers: 3 }),
    (error) => error.status === 400
  );
  await assert.rejects(
    new GenericRoomModel(new MemoryStorage()).create({ code: "ABC234", game: "not-a-game", username: "Alice" }),
    (error) => error.status === 400
  );
});

test("players receive unique seats and tokens, reconnect safely, and cannot impersonate a username", async () => {
  const { model, host } = await createRoom("memory", { maxPlayers: 3, state: { cards: [] } });
  const second = await model.join({ username: "Bob" });
  const third = await model.join({ username: "Chloë" });
  assert.deepEqual([host.seat, second.seat, third.seat], [0, 1, 2]);
  assert.equal(new Set([host.token, second.token, third.token]).size, 3);
  assert.equal(third.room.ready, true);
  assert.deepEqual(third.room.state, { cards: [] });
  await assert.rejects(model.join({ username: "bob" }), (error) => error.status === 409);
  await assert.rejects(model.join({ username: "Dana" }), (error) => error.status === 409);

  const restored = await model.join({ reconnectToken: second.token });
  assert.equal(restored.playerId, second.playerId);
  assert.equal(restored.seat, 1);
  assert.equal(restored.token, second.token);
  await assert.rejects(model.join({ reconnectToken: "x".repeat(43) }), (error) => error.status === 401);
  await assert.rejects(model.state("x".repeat(43), new Set()), (error) => error.status === 401);
});

test("the host starts a ready game and only the authoritative turn may replace state", async () => {
  const { model, host } = await createRoom("tic-tac-toe", { state: { cells: Array(9).fill(null) } });
  const guest = await model.join({ username: "Bob" });
  let stored = await model.load();
  const lobbyChat = await model.act(guest.token, { type: "chat", text: "Ready!" }, new Set());
  assert.equal(lobbyChat.version, stored.version);
  await assert.rejects(
    model.act(guest.token, { type: "start", expectedVersion: stored.version }, new Set()),
    (error) => error.status === 403
  );

  const started = await model.act(host.token, {
    type: "start",
    expectedVersion: stored.version,
    firstSeat: 0,
    state: { cells: Array(9).fill(null), mark: "X" }
  }, new Set([host.playerId]));
  assert.equal(started.status, "active");
  assert.deepEqual(started.turn, { seat: 0, playerId: host.playerId, number: 1 });
  assert.equal(started.members[0].connected, true);
  assert.equal(started.presence[guest.playerId], false);

  await assert.rejects(
    model.act(guest.token, { type: "state", expectedVersion: started.version, state: { stolen: true }, nextSeat: 0 }, new Set()),
    (error) => error.status === 403
  );
  const moved = await model.act(host.token, {
    type: "state",
    expectedVersion: started.version,
    state: { cells: ["X", null, null, null, null, null, null, null, null], mark: "O" },
    nextSeat: 1
  }, new Set());
  assert.equal(moved.turn.playerId, guest.playerId);
  assert.equal(moved.turn.number, 2);

  await assert.rejects(
    model.act(host.token, { type: "state", expectedVersion: started.version, state: {}, nextSeat: 0 }, new Set()),
    (error) => error.status === 409
  );
  await assert.rejects(
    model.act(guest.token, { type: "state", expectedVersion: moved.version, state: {}, nextSeat: 7 }, new Set()),
    (error) => error.status === 400
  );

  const finished = await model.act(guest.token, {
    type: "state",
    expectedVersion: moved.version,
    state: { cells: ["X", "O"] },
    finish: true,
    result: { winnerSeat: 1 }
  }, new Set());
  assert.equal(finished.status, "finished");
  assert.equal(finished.turn, null);
  assert.deepEqual(finished.result, { winnerSeat: 1 });

  const restarted = await model.act(host.token, {
    type: "restart",
    expectedVersion: finished.version,
    state: { cells: [] },
    firstSeat: 1
  }, new Set());
  assert.equal(restarted.status, "active");
  assert.equal(restarted.turn.playerId, guest.playerId);
  assert.equal(restarted.turn.number, 1);
});

test("state snapshots, results, usernames and messages are bounded and validated", async () => {
  assert.equal(normalizeUsername("  Ava   Jane  "), "Ava Jane");
  assert.throws(() => normalizeUsername("<script>"), (error) => error.status === 400);

  const tooLarge = { value: "x".repeat(GENERIC_ROOM_LIMITS.MAX_STATE_BYTES) };
  await assert.rejects(
    new GenericRoomModel(new MemoryStorage()).create({ code: "ABC234", game: "sorry", username: "Alice", state: tooLarge }),
    (error) => error.status === 413
  );

  const { model, host } = await createRoom("chat", { maxPlayers: 3 });
  const guest = await model.join({ username: "Bob" });
  const gameVersionBeforeChat = guest.room.version;
  const chatted = await model.act(host.token, { type: "chat", text: "  Hello, room!  " }, new Set());
  assert.equal(chatted.version, gameVersionBeforeChat, "chat must not invalidate gameplay compare-and-swap versions");
  assert.equal(chatted.chatVersion, 1);
  let stored = await model.load();
  assert.equal(stored.chat[0].text, "Hello, room!");
  assert.equal(stored.chat[0].username, "Alice");
  await assert.rejects(model.act(guest.token, { type: "chat", text: "" }, new Set()), (error) => error.status === 400);
  await assert.rejects(
    model.act(guest.token, { type: "chat", text: "x".repeat(GENERIC_ROOM_LIMITS.MAX_CHAT_LENGTH + 1) }, new Set()),
    (error) => error.status === 413
  );

  await model.act(guest.token, { type: "rename", expectedVersion: stored.version, username: "Robert" }, new Set());
  stored = await model.load();
  assert.equal(stored.members.find((member) => member.playerId === guest.playerId).username, "Robert");
  await assert.rejects(
    model.act(guest.token, { type: "rename", expectedVersion: stored.version, username: "Alice" }, new Set()),
    (error) => error.status === 409
  );

  stored.chat = Array.from({ length: GENERIC_ROOM_LIMITS.MAX_CHAT_MESSAGES }, (_, index) => ({
    id: `m_${index}`,
    playerId: host.playerId,
    seat: host.seat,
    username: "Alice",
    text: `Message ${index}`,
    createdAt: new Date(index).toISOString()
  }));
  const hostMember = stored.members.find((member) => member.playerId === host.playerId);
  hostMember.lastChatAt = 0;
  hostMember.chatWindowStartedAt = 0;
  hostMember.chatWindowCount = 0;
  await model.save(stored);
  await model.act(host.token, { type: "chat", text: "Newest message" }, new Set());
  stored = await model.load();
  assert.equal(stored.chat.length, GENERIC_ROOM_LIMITS.MAX_CHAT_MESSAGES);
  assert.equal(stored.chat.at(-1).text, "Newest message");
});

test("chat throttling limits rapid and sustained message bursts", async () => {
  const { model, host } = await createRoom("chat");
  await model.act(host.token, { type: "chat", text: "First" }, new Set());
  await assert.rejects(model.act(host.token, { type: "chat", text: "Too fast" }, new Set()), (error) => error.status === 429);

  const stored = await model.load();
  const member = stored.members[0];
  member.lastChatAt = 0;
  member.chatWindowStartedAt = Date.now();
  member.chatWindowCount = GENERIC_ROOM_LIMITS.CHAT_BURST_LIMIT;
  await model.save(stored);
  await assert.rejects(model.act(host.token, { type: "chat", text: "Too many" }, new Set()), (error) => error.status === 429);
});

test("leaving releases lobby seats, transfers hosting, and safely ends undersized games", async () => {
  const { model, host } = await createRoom("monopoly", { maxPlayers: 3 });
  const second = await model.join({ username: "Bob" });
  let room = await model.load();
  const leftLobby = await model.act(host.token, { type: "leave", expectedVersion: room.version }, new Set());
  assert.equal(leftLobby.hostPlayerId, second.playerId);
  await assert.rejects(model.state(host.token, new Set()), (error) => error.status === 401);
  const replacement = await model.join({ username: "Cara" });
  assert.equal(replacement.seat, 0);

  room = await model.load();
  const active = await model.act(second.token, { type: "start", expectedVersion: room.version, firstSeat: 1 }, new Set());
  assert.equal(active.turn.playerId, second.playerId);
  const ended = await model.act(second.token, { type: "leave", expectedVersion: active.version }, new Set());
  assert.equal(ended.status, "finished");
  assert.equal(ended.turn, null);
  assert.equal(ended.result.reason, "not-enough-players");
});

test("leave is stale-safe and idempotent, closed chats stay closed, and departed records are bounded", async () => {
  const { model, host } = await createRoom("chat", { maxPlayers: 2 });
  const originalVersion = host.room.version;
  const afterChat = await model.act(host.token, { type: "chat", text: "Goodbye" }, new Set());
  assert.equal(afterChat.version, originalVersion);

  const left = await model.act(host.token, { type: "leave", expectedVersion: originalVersion - 1 }, new Set());
  assert.equal(left.status, "finished");
  assert.equal(left.hostPlayerId, null);
  const repeated = await model.act(host.token, { type: "leave", expectedVersion: -100 }, new Set());
  assert.equal(repeated.version, left.version);
  await assert.rejects(model.join({ username: "Newcomer" }), (error) => error.status === 410);

  const churn = new GenericRoomModel(new MemoryStorage());
  await churn.create({ code: "CHN234", game: "chat", username: "Host", maxPlayers: 2 });
  let current = await churn.join({ username: "Player 0" });
  for (let index = 1; index <= GENERIC_ROOM_LIMITS.MAX_DEPARTED_MEMBERS + 5; index++) {
    await churn.act(current.token, { type: "leave" }, new Set());
    current = await churn.join({ username: `Player ${index}` });
  }
  const stored = await churn.load();
  assert.ok(stored.members.filter((member) => member.leftAt).length <= GENERIC_ROOM_LIMITS.MAX_DEPARTED_MEMBERS);
  assert.ok(stored.members.length <= GENERIC_ROOM_LIMITS.MAX_DEPARTED_MEMBERS + 2);
});
