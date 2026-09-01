import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { validateMonopolyStart, validateMonopolyTransition } from "../../../multiplayer/models/monopoly-authority.js";

const monopolyPath = fileURLToPath(new URL("../../../monopoly/index.html", import.meta.url));
const savePath = fileURLToPath(new URL("../../../arcade-save.js", import.meta.url));
const API_PREFIX = "/api/arcade/rooms";
const wait = (window, ms = 35) => new Promise((resolve) => window.setTimeout(resolve, ms));
const clone = (value) => JSON.parse(JSON.stringify(value));

class RoomServer {
  constructor() {
    this.room = null;
    this.tokens = new Map();
    this.sockets = new Set();
    this.calls = [];
    this.nextToken = 0;
    this.failLeaveOnce = false;
  }

  token() {
    const letter = String.fromCharCode(97 + this.nextToken++);
    return letter.repeat(43);
  }

  member(token) {
    const playerId = this.tokens.get(token);
    return this.room?.members.find((member) => member.playerId === playerId) || null;
  }

  view(token) {
    const member = this.member(token);
    const presence = {};
    for (const item of this.room.members) presence[item.playerId] = [...this.sockets].some((socket) => !socket.closed && socket.token === item.token);
    return clone({
      code: this.room.code, game: "monopoly", version: this.room.version, revision: this.room.revision, status: this.room.status,
      ready: this.room.members.length >= 2, hostPlayerId: this.room.hostPlayerId,
      minPlayers: 2, maxPlayers: this.room.maxPlayers, playerId: member?.playerId || null,
      seat: member?.seat ?? null,
      members: this.room.members.map(({ token: _token, ...item }) => ({ ...item, connected: presence[item.playerId] })),
      presence, turn: this.room.turn, state: this.room.state, result: this.room.result,
      chat: [], createdAt: this.room.createdAt, updatedAt: this.room.updatedAt
    });
  }

  response(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, async json() { return clone(data); } };
  }

  error(message, status) {
    return this.response({ ok: false, error: message }, status);
  }

  broadcast() {
    for (const socket of this.sockets) {
      if (!socket.closed) socket.emit("message", { data: JSON.stringify({ type: "state", room: this.view(socket.token) }) });
    }
  }

  socketClass() {
    const server = this;
    return class FakeWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) {
        this.url = String(url); this.readyState = 0; this.closed = false; this.listeners = new Map();
        this.token = new URL(this.url).searchParams.get("token"); server.sockets.add(this);
        queueMicrotask(() => { if (this.closed) return; this.readyState = 1; this.emit("open", {}); server.broadcast(); });
      }
      addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
      emit(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
      close() { if (this.closed) return; this.closed = true; this.readyState = 3; server.sockets.delete(this); queueMicrotask(() => this.emit("close", {})); server.broadcast(); }
    };
  }

  async fetch(input, options = {}) {
    const url = new URL(String(input));
    const path = url.pathname.slice(API_PREFIX.length);
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : {};
    const authorization = options.headers?.authorization || options.headers?.Authorization || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    this.calls.push({ path, method, body, token });

    if (path === "" && method === "POST") {
      const hostToken = this.token(), playerId = "player-0", now = new Date().toISOString();
      this.room = { code: "MON123", version: 1, revision: 1, status: "lobby", hostPlayerId: playerId, maxPlayers: body.maxPlayers,
        members: [{ playerId, seat: 0, username: body.username, token: hostToken, joinedAt: now }], turn: null,
        state: null, result: null, createdAt: now, updatedAt: now };
      this.tokens.set(hostToken, playerId);
      return this.response({ ok: true, code: this.room.code, token: hostToken, playerId, seat: 0, room: this.view(hostToken) });
    }

    const match = /^\/([A-Z0-9]{6})(?:\/(join|state|actions))?$/.exec(path);
    if (!match || !this.room || match[1] !== this.room.code) return this.error("Room not found", 404);
    const operation = match[2];

    if (operation === "join" && method === "POST") {
      if (body.reconnectToken) {
        const member = this.member(body.reconnectToken);
        if (!member) return this.error("Reconnect token is invalid", 401);
        return this.response({ ok: true, code: this.room.code, token: body.reconnectToken, playerId: member.playerId, seat: member.seat, room: this.view(body.reconnectToken) });
      }
      if (this.room.status !== "lobby") return this.error("Game already started", 409);
      if (this.room.members.length >= this.room.maxPlayers) return this.error("Room is full", 409);
      const seat = this.room.members.length, joinToken = this.token(), playerId = `player-${seat}`;
      this.room.members.push({ playerId, seat, username: body.username, token: joinToken, joinedAt: new Date().toISOString() });
      this.tokens.set(joinToken, playerId); this.room.version++; this.room.revision++; this.room.updatedAt = new Date().toISOString(); this.broadcast();
      return this.response({ ok: true, code: this.room.code, token: joinToken, playerId, seat, room: this.view(joinToken) });
    }

    if (operation === "state" && method === "GET") {
      if (!this.member(token)) return this.error("Invalid room token", 401);
      return this.response({ ok: true, room: this.view(token) });
    }

    if (operation === "actions" && method === "POST") {
      const member = this.member(token);
      if (!member) return this.error("Invalid room token", 401);
      if (body.type === "leave" && this.failLeaveOnce) { this.failLeaveOnce = false; return this.error("Temporary outage", 503); }
      if (body.type !== "leave" && body.expectedVersion !== this.room.version) return this.error("Room state changed", 409);
      if (body.type === "start") {
        if (member.playerId !== this.room.hostPlayerId) return this.error("Only the host can start", 403);
        this.room.status = "active"; this.room.state = clone(body.state);
        this.room.turn = { seat: body.firstSeat, playerId: this.room.members.find((item) => item.seat === body.firstSeat)?.playerId, number: 1 };
      } else if (body.type === "state") {
        if (this.room.status !== "active" || this.room.turn?.seat !== member.seat) return this.error("It is not your turn", 403);
        if (!this.room.members.some((item) => item.seat === body.nextSeat)) return this.error("Next seat is unavailable", 409);
        this.room.state = clone(body.state); this.room.result = body.result || null;
        this.room.status = body.finish ? "finished" : "active";
        this.room.turn = body.finish ? null : { seat: body.nextSeat, playerId: this.room.members.find((item) => item.seat === body.nextSeat)?.playerId, number: (this.room.turn.number || 0) + 1 };
      } else if (body.type === "leave") {
        const departedSeat = member.seat;
        this.room.members = this.room.members.filter((item) => item.playerId !== member.playerId);
        if (!this.room.members.length) {
          this.room.status = "finished"; this.room.turn = null; this.room.result = { type: "abandoned", reason: "all-players-left" };
        } else if (this.room.status === "active") {
          if (this.room.members.length < 2) {
            this.room.status = "finished"; this.room.turn = null; this.room.result = { type: "abandoned", reason: "not-enough-players", departedPlayerId: member.playerId };
          } else if (this.room.turn?.seat === departedSeat) {
            const seats = this.room.members.map((item) => item.seat).sort((a, b) => a - b);
            const nextSeat = seats.find((seat) => seat > departedSeat) ?? seats[0];
            const next = this.room.members.find((item) => item.seat === nextSeat);
            this.room.turn = { seat: next.seat, playerId: next.playerId, number: (this.room.turn.number || 0) + 1 };
          }
        }
      } else return this.error("Unsupported action", 400);
      this.room.version++; this.room.revision++; this.room.updatedAt = new Date().toISOString(); this.broadcast();
      return this.response({ ok: true, room: this.view(token) });
    }
    return this.error("Not found", 404);
  }
}

async function loadMonopoly(server = null, savedOnline = null, arcadeMultiplayer = null) {
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const [pageHtml, saveScript] = await Promise.all([readFile(monopolyPath, "utf8"), readFile(savePath, "utf8")]);
  const html = pageHtml.replace('<script src="../arcade-save.js"></script>', `<script>${saveScript}</script>`);
  const dom = new JSDOM(html, {
    url: "https://to-shreds.github.io/arcade/monopoly/", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      if (savedOnline) window.localStorage.setItem("arcade_monopoly_online_v1", savedOnline);
      window.fetch = server ? server.fetch.bind(server) : async () => { throw new Error("Unexpected network request"); };
      window.WebSocket = server ? server.socketClass() : class { constructor() { throw new Error("Unexpected socket"); } };
      if (arcadeMultiplayer) window.ArcadeMultiplayer = arcadeMultiplayer;
      window.confirm = () => true; window.alert = () => {};
      window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });
  if (dom.window.document.readyState !== "complete") await new Promise((resolve) => dom.window.addEventListener("load", resolve, { once: true }));
  await wait(dom.window);
  return { dom, errors };
}

test("Monopoly keeps its complete local setup and local engine", async () => {
  const { dom, errors } = await loadMonopoly();
  try {
    const { document, MonopolyGame } = dom.window;
    assert.equal(document.querySelector('[data-play-mode="local"]').classList.contains("selected"), true);
    assert.equal(document.querySelector("#onlineSetup").classList.contains("hidden"), true);
    const started = MonopolyGame.startGame({ players: ["Alice", "Bob"], mode: "standard", handoff: false });
    assert.equal(started.players.length, 2);
    assert.equal(MonopolyGame.rollDice([1, 2]), true);
    assert.equal(MonopolyGame.getState().phase, "offer");
    assert.equal(MonopolyGame.saveGame(true), true);
    assert.equal(MonopolyGame.getOnline(), null);
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("Monopoly snapshot normalization preserves bankruptcy mortgage decisions without legacy wire fields", async () => {
  const { dom, errors } = await loadMonopoly();
  try {
    const game = dom.window.MonopolyGame;
    const snapshot = game.startGame({ players: ["Alice", "Bob"], mode: "standard", handoff: false });
    snapshot.phase = "debt";
    snapshot.pendingDebt = null;
    snapshot.deeds[1] = { owner: 0, mortgaged: true, houses: 0 };
    snapshot.pendingMortgageChoices = [{ playerId: 0, spaceId: 1 }];
    snapshot.mortgageChoiceResume = "afterBankruptcy";
    snapshot.bankruptcyContext = { playerId: 1, wasCurrent: false, resume: "finish" };
    delete snapshot.bankruptcyStack;
    delete snapshot.endReason;
    game.importState(snapshot);
    const normalized = game.getState();
    assert.equal(normalized.phase, "debt", "a transferred-mortgage choice remains actionable after server echo normalization");
    assert.deepEqual(JSON.parse(JSON.stringify(normalized.bankruptcyStack)), [{ playerId: 1, wasCurrent: false, resume: "finish" }]);
    assert.equal(Object.hasOwn(normalized, "bankruptcyContext"), false, "legacy bankruptcyContext never returns to the authoritative wire state");
    assert.equal(normalized.endReason, "", "the initial and normalized state use the same empty end reason");
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("two independent Monopoly clients create, join, start, hand off decisions, sync turns, and reconnect", async () => {
  const server = new RoomServer();
  const host = await loadMonopoly(server), guest = await loadMonopoly(server);
  let resumed = null;
  try {
    const hostDoc = host.dom.window.document, guestDoc = guest.dom.window.document;
    host.dom.window.MonopolyGame.startGame({ players: ["Local One", "Local Two"], handoff: false });
    host.dom.window.MonopolyGame.saveGame(true);
    const preservedLocalSave = JSON.parse(host.dom.window.localStorage.getItem("arcade_monopoly_save_v1"));
    delete preservedLocalSave.savedAt;
    hostDoc.querySelector("#menuBtn").click();
    hostDoc.querySelector("#newGameBtn").click();
    hostDoc.querySelector('[data-play-mode="online"]').click();
    hostDoc.querySelector("#onlineName").value = "Alice";
    hostDoc.querySelector("#createOnlineBtn").click();
    await wait(host.dom.window, 70);
    assert.equal(hostDoc.querySelector("#lobbyCode").textContent, "MON123");
    assert.equal(host.dom.window.MonopolyGame.getOnline().status, "lobby");

    guestDoc.querySelector('[data-play-mode="online"]').click();
    guestDoc.querySelector("#onlineName").value = "Bob";
    guestDoc.querySelector("#onlineCode").value = "mon123";
    guestDoc.querySelector("#onlineCode").dispatchEvent(new guest.dom.window.Event("input", { bubbles: true }));
    assert.equal(guestDoc.querySelector("#onlineCode").value, "MON123");
    guestDoc.querySelector("#joinOnlineBtn").click();
    await wait(guest.dom.window, 80);
    assert.equal(hostDoc.querySelectorAll("#lobbyMembers .roomMember").length, 2);
    assert.equal(guestDoc.querySelector("#startOnlineBtn").classList.contains("hidden"), true);
    assert.equal(hostDoc.querySelector("#startOnlineBtn").disabled, false);

    hostDoc.querySelector("#startOnlineBtn").click();
    await wait(host.dom.window, 90);
    assert.equal(host.dom.window.MonopolyGame.getOnline().status, "active");
    assert.equal(guest.dom.window.MonopolyGame.getOnline().status, "active");
    assert.deepEqual(Array.from(host.dom.window.MonopolyGame.getState().players, (p) => p.name), ["Alice", "Bob"]);
    assert.equal(hostDoc.querySelector('[data-act="roll"]').disabled, false);
    assert.equal(guestDoc.querySelector('[data-act="roll"]').disabled, true);

    assert.equal(host.dom.window.MonopolyGame.rollDice([1, 2]), true);
    await wait(host.dom.window, 80);
    assert.equal(server.room.state.phase, "offer");
    assert.equal(guest.dom.window.MonopolyGame.getState().offerSpace, 3);
    assert.equal(guest.dom.window.MonopolyGame.rollDice([1, 2]), false);
    const startWire = server.calls.find((call) => call.body?.type === "start");
    const rollWire = server.calls.find((call) => call.body?.type === "state" && call.body.intent?.kind === "roll");
    const authorityMembers = server.room.members.map((member) => ({ playerId: member.playerId, seat: member.seat, username: member.username, leftAt: null }));
    const authorityRoom = { game: "monopoly", state: startWire.body.state, maxPlayers: 2, members: authorityMembers, turn: { seat: 0, playerId: authorityMembers[0].playerId, number: 1 } };
    assert.doesNotThrow(() => validateMonopolyStart(authorityRoom, startWire.body), "a fresh frontend start snapshot satisfies the Nearby authority");
    assert.doesNotThrow(() => validateMonopolyTransition(authorityRoom, authorityMembers[0], rollWire.body), "the first post-echo frontend roll satisfies the Nearby authority");

    hostDoc.querySelector('[data-act="trade"]').click();
    hostDoc.querySelector("#offerCash").value = "10";
    hostDoc.querySelector("#proposeTrade").click();
    await wait(host.dom.window, 90);
    assert.equal(server.room.turn.seat, 1);
    assert.equal(hostDoc.querySelector("#acceptTrade").disabled, true);
    assert.equal(guestDoc.querySelector("#acceptTrade").disabled, false);
    guestDoc.querySelector("#acceptTrade").click();
    await wait(guest.dom.window, 90);
    assert.equal(server.room.state.players[0].cash, 1490);
    assert.equal(server.room.state.players[1].cash, 1510);
    assert.equal(server.room.turn.seat, 0);

    assert.equal(host.dom.window.MonopolyGame.buyProperty(), undefined);
    await wait(host.dom.window, 80);
    assert.equal(server.room.state.deeds[3].owner, 0);
    assert.equal(host.dom.window.MonopolyGame.endTurn(), true);
    await wait(host.dom.window, 90);
    assert.equal(server.room.turn.seat, 1);
    assert.equal(guest.dom.window.MonopolyGame.getState().turnIndex, 1);
    assert.equal(host.dom.window.MonopolyGame.rollDice([1, 2]), false);
    assert.equal(guestDoc.querySelector('[data-act="roll"]').disabled, false);
    const stateIntents = server.calls.filter((call) => call.body?.type === "state").map((call) => call.body.intent);
    assert.ok(stateIntents.length >= 5);
    assert.equal(stateIntents.every((intent) => intent?.version === 1), true, "every Monopoly state action declares a versioned authority intent");
    for (const kind of ["roll", "trade-propose", "trade-accept", "buy", "end-turn"]) {
      assert.ok(stateIntents.some((intent) => intent.kind === kind), `Monopoly sends its ${kind} intent`);
    }

    server.room.state.players[0].name = "Forged Alice";
    server.room.state.players[0].color = 'red" onmouseover="window.__stolen=true';
    server.room.state.bank.houses = '0</div><img id="snapshot-attack" src=x>';
    server.room.version++;
    server.room.revision++;
    server.broadcast();
    await wait(host.dom.window, 60);
    assert.equal(host.dom.window.MonopolyGame.getState().players[0].name, "Alice", "room membership owns online identity");
    assert.equal(host.dom.window.MonopolyGame.getState().players[0].color, "#30d8ff");
    assert.equal(hostDoc.querySelector("[onmouseover]"), null);
    assert.equal(hostDoc.querySelector("#snapshot-attack"), null);
    const acceptedCash = host.dom.window.MonopolyGame.getState().players[0].cash;
    const hostToken = server.room.members.find((member) => member.seat === 0).token;
    const staleRoom = server.view(hostToken);
    staleRoom.revision--;
    staleRoom.state.players[0].cash = 1;
    const hostSocket = [...server.sockets].find((socket) => socket.token === hostToken);
    hostSocket.emit("message", { data: JSON.stringify({ type: "state", room: staleRoom }) });
    await wait(host.dom.window, 30);
    assert.equal(host.dom.window.MonopolyGame.getState().players[0].cash, acceptedCash, "older equal-version revisions cannot roll state back");

    const savedSession = guest.dom.window.localStorage.getItem("arcade_monopoly_online_v1");
    guest.dom.window.MonopolyGame.disconnectOnline();
    assert.equal(guest.dom.window.MonopolyGame.getOnline().connected, false);
    guest.dom.window.MonopolyGame.reconnectOnline();
    await wait(guest.dom.window, 60);
    assert.equal(guest.dom.window.MonopolyGame.getOnline().connected, true);

    const callsBeforeResume = server.calls.length;
    resumed = await loadMonopoly(server, savedSession);
    assert.equal(server.calls.length, callsBeforeResume, "saved rooms never auto-open over the mode menu");
    assert.equal(resumed.dom.window.document.querySelector('[data-play-mode="local"]').classList.contains("selected"), true);
    resumed.dom.window.document.querySelector('[data-play-mode="online"]').click();
    assert.equal(resumed.dom.window.document.querySelector("#resumeOnlineBtn").classList.contains("hidden"), false);
    resumed.dom.window.document.querySelector("#resumeOnlineBtn").click();
    await wait(resumed.dom.window, 80);
    assert.equal(resumed.dom.window.MonopolyGame.getOnline().status, "active");
    assert.equal(resumed.dom.window.MonopolyGame.getState().turnIndex, 1);
    const localSaveAfterOnline = JSON.parse(host.dom.window.localStorage.getItem("arcade_monopoly_save_v1"));
    delete localSaveAfterOnline.savedAt;
    assert.deepEqual(localSaveAfterOnline, preservedLocalSave, "online snapshots never overwrite the local save");

    assert.equal(host.errors.length, 0, host.errors.map((error) => error.message).join("\n"));
    assert.equal(guest.errors.length, 0, guest.errors.map((error) => error.message).join("\n"));
    assert.equal(resumed.errors.length, 0, resumed.errors.map((error) => error.message).join("\n"));
  } finally {
    host.dom.window.MonopolyGame.disconnectOnline(); guest.dom.window.MonopolyGame.disconnectOnline();
    if (resumed) resumed.dom.window.MonopolyGame.disconnectOnline();
    host.dom.window.close(); guest.dom.window.close(); if (resumed) resumed.dom.window.close();
  }
});

test("a three-player departure safely forfeits assets and room turn authority overrides a conflicting snapshot", async () => {
  const server = new RoomServer();
  const alice = await loadMonopoly(server), bob = await loadMonopoly(server), cara = await loadMonopoly(server);
  try {
    const aliceDoc = alice.dom.window.document, bobDoc = bob.dom.window.document, caraDoc = cara.dom.window.document;
    aliceDoc.querySelector('[data-play-mode="online"]').click();
    aliceDoc.querySelector("#onlineName").value = "Alice";
    aliceDoc.querySelector("#onlinePlayers").value = "3";
    aliceDoc.querySelector("#createOnlineBtn").click();
    await wait(alice.dom.window, 65);

    for (const [client, name] of [[bob, "Bob"], [cara, "Cara"]]) {
      const document = client.dom.window.document;
      document.querySelector('[data-play-mode="online"]').click();
      document.querySelector("#onlineName").value = name;
      document.querySelector("#onlineCode").value = "MON123";
      document.querySelector("#joinOnlineBtn").click();
      await wait(client.dom.window, 70);
    }
    aliceDoc.querySelector("#startOnlineBtn").click();
    await wait(alice.dom.window, 90);
    assert.equal(server.room.members.length, 3);

    server.room.state.turnIndex = 1;
    server.room.state.phase = "end";
    server.room.state.status = "Bob may end the turn.";
    server.room.state.players[1].getOut = { chance: 1, community: 1 };
    server.room.state.decks.chance = server.room.state.decks.chance.filter((id) => id !== "c_jailcard");
    server.room.state.decks.community = server.room.state.decks.community.filter((id) => id !== "m_jailcard");
    server.room.state.deeds[1] = { owner: 1, mortgaged: false, houses: 4 };
    server.room.state.deeds[3] = { owner: 1, mortgaged: false, houses: 5 };
    server.room.state.bank.houses = 28;
    server.room.state.bank.hotels = 11;
    server.room.turn = { seat: 1, playerId: "player-1", number: 4 };
    server.room.version++; server.room.revision++; server.broadcast();
    await wait(alice.dom.window, 70);
    assert.equal(bob.dom.window.MonopolyGame.getState().players[bob.dom.window.MonopolyGame.getState().turnIndex].id, 1);

    bobDoc.querySelector("#onlineStatusBtn").click();
    bobDoc.querySelector("#leaveOnlineBtn").click();
    await wait(bob.dom.window, 100);
    assert.equal(server.room.members.length, 2);
    assert.equal(server.room.turn.seat, 2, "the backend advances past the departed current seat");

    const recovered = alice.dom.window.MonopolyGame.getState();
    assert.deepEqual(Array.from(recovered.players, (player) => player.id), [0, 2]);
    assert.equal(recovered.players[1].name, "Cara");
    assert.equal(recovered.players[1].color, "#ffd447", "seat color remains stable after another seat leaves");
    assert.equal(JSON.stringify(recovered.deeds[1]), JSON.stringify({ owner: null, mortgaged: false, houses: 0 }));
    assert.equal(JSON.stringify(recovered.deeds[3]), JSON.stringify({ owner: null, mortgaged: false, houses: 0 }));
    assert.equal(recovered.bank.houses, 32, "forfeited houses return to bank inventory");
    assert.equal(recovered.bank.hotels, 12, "forfeited hotels return to bank inventory");
    assert.equal(recovered.decks.chance.includes("c_jailcard"), true);
    assert.equal(recovered.decks.community.includes("m_jailcard"), true);
    assert.equal(recovered.players[recovered.turnIndex].id, 2);
    assert.equal(recovered.phase, "roll", "an interrupted departed turn restarts safely for the authoritative seat");
    assert.equal(aliceDoc.querySelector('[data-act="roll"]').disabled, true);
    assert.equal(caraDoc.querySelector('[data-act="roll"]').disabled, false);

    server.room.state = clone(cara.dom.window.MonopolyGame.getState());
    server.room.state.pendingTrade = {
      fromId: 2, toId: 0, offerCash: 0, askCash: 0,
      offerChance: 0, offerCommunity: 0, askChance: 0, askCommunity: 0,
      offerProps: [], askProps: []
    };
    server.room.state.phase = "end";
    server.room.version++; server.room.revision++; server.broadcast();
    await wait(cara.dom.window, 65);
    const authorityRecovered = cara.dom.window.MonopolyGame.getState();
    assert.equal(authorityRecovered.pendingTrade, null, "a snapshot cannot delegate UI control away from the server turn");
    assert.equal(authorityRecovered.players[authorityRecovered.turnIndex].id, 2);
    assert.equal(authorityRecovered.phase, "roll");
    assert.equal(cara.dom.window.MonopolyGame.rollDice([1, 2]), true, "the authoritative player can continue after recovery");
    await wait(cara.dom.window, 80);
    assert.equal(server.room.state.players[server.room.state.turnIndex].id, 2);

    for (const client of [alice, bob, cara]) assert.equal(client.errors.length, 0, client.errors.map((error) => error.message).join("\n"));
  } finally {
    for (const client of [alice, bob, cara]) {
      client.dom.window.MonopolyGame.disconnectOnline();
      client.dom.window.close();
    }
  }
});

test("leaving a Monopoly room retains its reconnect token on transient failure and forgets it after success", async () => {
  const server = new RoomServer(), client = await loadMonopoly(server);
  try {
    const { document } = client.dom.window;
    document.querySelector('[data-play-mode="online"]').click();
    document.querySelector("#onlineName").value = "Alice";
    document.querySelector("#createOnlineBtn").click();
    await wait(client.dom.window, 70);
    const saved = client.dom.window.localStorage.getItem("arcade_monopoly_online_v1");
    assert.ok(saved);

    server.failLeaveOnce = true;
    document.querySelector("#leaveOnlineBtn").click();
    await wait(client.dom.window, 80);
    assert.equal(client.dom.window.localStorage.getItem("arcade_monopoly_online_v1"), saved);
    assert.equal(client.dom.window.MonopolyGame.getOnline().status, "lobby");
    assert.match(document.querySelector("#lobbyStatus").textContent, /Could not leave yet/);

    document.querySelector("#leaveOnlineBtn").click();
    await wait(client.dom.window, 80);
    assert.equal(client.dom.window.localStorage.getItem("arcade_monopoly_online_v1"), null);
    assert.equal(client.dom.window.MonopolyGame.getOnline(), null);
    assert.equal(document.querySelector("#setupOverlay").classList.contains("hidden"), false);
    assert.equal(client.errors.length, 0, client.errors.map((error) => error.message).join("\n"));
  } finally { client.dom.window.MonopolyGame.disconnectOnline(); client.dom.window.close(); }
});

test("Monopoly pins saved authority before locked identity and releases failed fresh attempts", async () => {
  const events = [];
  let failureStatus = 503;
  const server = {
    async fetch() {
      events.push("fetch");
      return { ok: false, status: failureStatus, async json() { return { ok: false, error: "room unavailable" }; } };
    },
    socketClass() { return class { constructor() { throw new Error("Unexpected socket"); } }; }
  };
  const bridge = {
    getStatus() { return { effectiveTransport: "nearby", nearby: true, connected: 2, identity: { nickname: "Nearby Name", avatar: "🚀" } }; },
    onStatus() { return () => {}; },
    pinRoomTransport(transport) { events.push("pin:" + transport); return transport; },
    resetRoomTransport() { events.push("reset"); },
    preferredUsername(name) { events.push("name:" + name); return name; },
    invite() {}, goHome() {}
  };
  const saved = JSON.stringify({ code: "ABC234", token: "r".repeat(43), username: "Saved Name", transport: "cloudflare" });
  const { dom, errors } = await loadMonopoly(server, saved, bridge);
  try {
    const { document } = dom.window;
    document.querySelector('[data-play-mode="online"]').click();
    events.length = 0;
    document.querySelector("#resumeOnlineBtn").click();
    await wait(dom.window, 45);
    assert.deepEqual(events.slice(0, 3), ["pin:cloudflare", "name:Saved Name", "fetch"], "saved authority wins before locked identity lookup or network access");
    assert.doesNotMatch(events.join(","), /reset/, "transient resume failure preserves the saved authority pin");
    assert.notEqual(dom.window.localStorage.getItem("arcade_monopoly_online_v1"), null);

    failureStatus = 410;
    events.length = 0;
    document.querySelector("#resumeOnlineBtn").click();
    await wait(dom.window, 45);
    assert.ok(events.includes("reset"), "terminal Gone releases the room authority pin");
    assert.equal(dom.window.localStorage.getItem("arcade_monopoly_online_v1"), null);

    events.length = 0;
    document.querySelector("#onlineName").value = "Fresh Host";
    document.querySelector("#createOnlineBtn").click();
    await wait(dom.window, 45);
    assert.ok(events.includes("reset"), "failed fresh create cannot retain a transport pin without an accepted room");

    events.length = 0;
    document.querySelector("#onlineCode").value = "ABC234";
    document.querySelector("#joinOnlineBtn").click();
    await wait(dom.window, 45);
    assert.ok(events.includes("reset"), "failed fresh join cannot retain a transport pin without an accepted room");
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("a socket broadcast cannot unlock Monopoly while its originating action is pending", async () => {
  const source = await readFile(monopolyPath, "utf8");
  const applyRoom = /function applyOnlineRoom\(room,force=false\)\{([^\n]+)\}/.exec(source)?.[1] || "";
  assert.ok(applyRoom, "online room applicator remains present");
  assert.doesNotMatch(applyRoom, /onlineSyncing\s*=\s*false/, "only the action promise may release its input lock");
});
