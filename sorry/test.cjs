const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("../cloudflare/chess-worker/node_modules/jsdom");

const pagePath = path.join(__dirname, "index.html");

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function lobby(overrides = {}) {
  return Object.assign({
    code: "ABC234", game: "sorry", version: 1, status: "lobby", ready: false,
    hostPlayerId: "p0", playerId: "p0", seat: 0, minPlayers: 2, maxPlayers: 4,
    members: [{ playerId: "p0", seat: 0, username: "Alex", connected: true }],
    presence: { p0: true }, turn: null, state: { lobby: { kind: "sorry-lobby", mode: "fireIce", showEndpoints: true, colors: [0, 1, 2, 3] } }, result: null, chat: []
  }, overrides);
}

async function loadSorry(fetchImpl, savedSession) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error));
  const html = fs.readFileSync(pagePath, "utf8").replace('<script src="../arcade-save.js"></script>', "");
  const dom = new JSDOM(html, {
    url: "https://to-shreds.github.io/arcade/sorry/index.html",
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      if (savedSession) window.localStorage.setItem("arcadeSorry_onlineSession_v1", JSON.stringify(savedSession));
      window.fetch = fetchImpl || (async url => { throw new Error("unexpected fetch " + url); });
      window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
      window.HTMLElement.prototype.animate = () => ({ cancel() {} });
      window.__sorrySockets = [];
      window.WebSocket = class {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        constructor(url) {
          this.url = url; this.readyState = 0; this.listeners = new Map(); window.__sorrySockets.push(this);
          window.queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1; this.emit("open", {}); });
        }
        addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
        emit(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
        close() { if (this.readyState === 3) return; this.readyState = 3; window.queueMicrotask(() => this.emit("close", {})); }
      };
    }
  });
  if (dom.window.document.readyState !== "complete") await new Promise(resolve => dom.window.addEventListener("load", resolve, { once: true }));
  await new Promise(resolve => dom.window.setTimeout(resolve, 20));
  return { dom, errors };
}

function wait(window, ms = 30) { return new Promise(resolve => window.setTimeout(resolve, ms)); }

test("local play remains intact and is preserved when an online room is created", async () => {
  let room = lobby();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/api/arcade/rooms") && options.method === "POST") return response({ ok: true, code: room.code, token: "host-token", playerId: "p0", seat: 0, room });
    if (String(url).endsWith("/state")) return response({ ok: true, room });
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadSorry(fetchImpl);
  try {
    const { document, SorryGame } = dom.window;
    document.querySelector("#startBtn").click();
    assert.equal(SorryGame.getState().started, true);
    assert.equal(SorryGame.getState().online, false);

    document.querySelector("#menuBtn").click();
    document.querySelector("#newGameBtn").click();
    document.querySelector('#playModeChoices [data-value="online"]').click();
    document.querySelector("#onlineName").value = "Alex";
    document.querySelector('#onlinePlayerCountChoices [data-value="4"]').click();
    document.querySelector("#createOnlineBtn").click();
    await wait(dom.window, 60);

    const create = calls.find(call => call.url.endsWith("/api/arcade/rooms") && call.options.method === "POST");
    assert.ok(create);
    assert.deepEqual(JSON.parse(create.options.body), { game: "sorry", username: "Alex", maxPlayers: 4, state: { lobby: { kind: "sorry-lobby", mode: "fireIce", showEndpoints: true, colors: [0, 1, 2, 3] } } });
    assert.equal(SorryGame.online.getSession().active, true);
    assert.equal(SorryGame.online.getLocalBackup().started, true);
    assert.equal(document.querySelector("#roomOverlay").classList.contains("hidden"), false);
    assert.equal(errors.length, 0, errors.map(error => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("join submits a visible room code and username", async () => {
  let room = lobby({ playerId: "p1", seat: 1, members: [
    { playerId: "p0", seat: 0, username: "Alex", connected: true },
    { playerId: "p1", seat: 1, username: "Sam", connected: true }
  ], presence: { p0: true, p1: true }, ready: true });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/ABC234/join")) return response({ ok: true, code: room.code, token: "guest-token", playerId: "p1", seat: 1, room });
    if (String(url).endsWith("/state")) return response({ ok: true, room });
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadSorry(fetchImpl);
  try {
    const { document } = dom.window;
    document.querySelector('#playModeChoices [data-value="online"]').click();
    document.querySelector("#onlineName").value = "Sam";
    document.querySelector("#showJoinBtn").click();
    const code = document.querySelector("#onlineJoinCode"); code.value = "abc234";
    code.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    assert.equal(code.value, "ABC234");
    document.querySelector("#joinOnlineBtn").click();
    await wait(dom.window, 60);
    const join = calls.find(call => call.url.endsWith("/ABC234/join"));
    assert.deepEqual(JSON.parse(join.options.body), { username: "Sam" });
    assert.equal(dom.window.SorryGame.online.getSession().seat, 1);
    assert.equal(errors.length, 0, errors.map(error => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("online setup requests are single-flight under rapid double taps", async () => {
  const room = lobby(); let createCalls = 0; let releaseCreate;
  const pendingCreate = new Promise(resolve => { releaseCreate = resolve; });
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/api/arcade/rooms") && options.method === "POST") { createCalls++; return pendingCreate; }
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadSorry(fetchImpl);
  try {
    const { document, SorryGame } = dom.window;
    document.querySelector('#playModeChoices [data-value="online"]').click();
    const first = SorryGame.online.create();
    const second = SorryGame.online.create();
    assert.equal(createCalls, 1);
    assert.equal(document.querySelector("#createOnlineBtn").disabled, true);
    assert.equal(document.querySelector("#joinOnlineBtn").disabled, true);
    releaseCreate(response({ ok: true, code: room.code, token: "host-token", playerId: "p0", seat: 0, room }));
    await Promise.all([first, second]); await wait(dom.window, 30);
    assert.equal(createCalls, 1);
    assert.equal(document.querySelector("#createOnlineBtn").disabled, false);
    assert.equal(errors.length, 0, errors.map(error => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("host start, turn gating, completed-turn snapshots, hydration, and reconnect work", async () => {
  let room = lobby({ ready: true, members: [
    { playerId: "p0", seat: 0, username: "Alex", connected: true },
    { playerId: "p1", seat: 1, username: "Sam", connected: true }
  ], presence: { p0: true, p1: true } });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/api/arcade/rooms") && options.method === "POST") return response({ ok: true, code: room.code, token: "host-token", playerId: "p0", seat: 0, room });
    if (String(url).endsWith("/state")) return response({ ok: true, room });
    if (String(url).endsWith("/actions")) {
      const action = JSON.parse(options.body);
      if (action.type === "start" || action.type === "restart") room = Object.assign({}, room, { version: room.version + 1, status: "active", turn: { seat: action.firstSeat, playerId: "p0", number: 1 }, state: action.state });
      else if (action.type === "state") room = Object.assign({}, room, { version: room.version + 1, status: action.finish ? "finished" : "active", turn: action.finish ? null : { seat: Number.isInteger(action.nextSeat) ? action.nextSeat : room.turn.seat, playerId: Number.isInteger(action.nextSeat) && action.nextSeat === 1 ? "p1" : "p0", number: (room.turn && room.turn.number || 0) + (Number.isInteger(action.nextSeat) ? 1 : 0) }, state: action.state, result: action.result || null });
      return response({ ok: true, room });
    }
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadSorry(fetchImpl);
  try {
    const { document, SorryGame } = dom.window;
    document.querySelector('#playModeChoices [data-value="online"]').click();
    document.querySelector("#onlineName").value = "Alex";
    document.querySelector("#createOnlineBtn").click();
    await wait(dom.window, 60);
    document.querySelector("#startOnlineBtn").click();
    await wait(dom.window, 60);

    const startCall = calls.find(call => call.url.endsWith("/actions") && JSON.parse(call.options.body).type === "start");
    const startAction = JSON.parse(startCall.options.body);
    assert.equal(startAction.expectedVersion, 1);
    assert.equal(startAction.firstSeat, 0);
    assert.equal(startAction.state.players.length, 2);
    assert.deepEqual(startAction.state.players.map(player => player.seat), [0, 1]);
    assert.equal(SorryGame.online.canAct(), true);

    const controlled = structuredClone(room);
    controlled.version += 1;
    controlled.turn = { seat: 0, playerId: "p0", number: 1 };
    controlled.state.phase = "action";
    controlled.state.currentCard = "3";
    controlled.state.deck.splice(controlled.state.deck.indexOf("3"), 1);
    controlled.state.pawns[0].zone = "track";
    controlled.state.pawns[0].pos = 4;
    SorryGame.online.applyRoom(controlled);
    room = controlled;
    const marker = Array.from(document.querySelectorAll("#endpointLayer .endpoint-marker")).find(node => /move forward 3/i.test(node.getAttribute("aria-label") || ""));
    assert.ok(marker, "a legal endpoint is rendered for the active online seat");
    marker.click();
    await wait(dom.window, 650);
    const stateCalls = calls.filter(call => call.url.endsWith("/actions") && JSON.parse(call.options.body).type === "state");
    assert.ok(stateCalls.length >= 1, "a completed turn submits a full snapshot");
    const completed = JSON.parse(stateCalls.at(-1).options.body);
    assert.equal(completed.nextSeat, 1);
    assert.equal(completed.state.turn, 1);
    assert.equal(completed.state.pawns[0].pos, 7);
    assert.equal(SorryGame.online.canAct(), false);

    const remote = structuredClone(room);
    remote.version += 1; remote.state.pawns[3].zone = "track"; remote.state.pawns[3].pos = 22;
    SorryGame.online.applyRoom(remote); room = remote;
    assert.equal(SorryGame.getState().pawns[3].pos, 22, "remote room snapshot hydrates the local board");

    const safeState = structuredClone(SorryGame.getState());
    const hostile = structuredClone(room); hostile.version += 1;
    hostile.state.players[0].name = '<img src=x onerror="window.pwned=1">';
    hostile.state.deck[0] = '<img src=x onerror="window.pwned=1">';
    SorryGame.online.applyRoom(hostile);
    assert.equal(JSON.stringify(SorryGame.getState()), JSON.stringify(safeState), "an invalid opaque snapshot cannot replace the last safe board");
    assert.equal(document.querySelectorAll("img").length, 0);
    assert.equal(dom.window.pwned, undefined);

    const firstSocket = dom.window.__sorrySockets[0];
    firstSocket.emit("close", {});
    assert.equal(SorryGame.online.getSession().status, "reconnecting");
    await wait(dom.window, 780);
    assert.ok(dom.window.__sorrySockets.length >= 2, "a replacement socket is opened");
    await wait(dom.window, 30);
    assert.equal(SorryGame.online.getSession().status, "connected");
    assert.equal(errors.length, 0, errors.map(error => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("a same-seat 409 applies the newer authoritative decision instead of retrying stale state", async () => {
  let room = lobby({ ready: true, members: [
    { playerId: "p0", seat: 0, username: "Alex", connected: true },
    { playerId: "p1", seat: 1, username: "Sam", connected: true }
  ], presence: { p0: true, p1: true } });
  let statePosts = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/api/arcade/rooms") && options.method === "POST") return response({ ok: true, code: room.code, token: "host-token", playerId: "p0", seat: 0, room });
    if (String(url).endsWith("/state")) return response({ ok: true, room });
    if (String(url).endsWith("/actions")) {
      const action = JSON.parse(options.body);
      if (action.type === "start") {
        room = Object.assign({}, room, { version: room.version + 1, status: "active", turn: { seat: 0, playerId: "p0", number: 1 }, state: action.state });
        return response({ ok: true, room });
      }
      if (action.type === "state") {
        statePosts++;
        const accepted = structuredClone(room);
        accepted.version += 1;
        accepted.state.deck.push(accepted.state.currentCard);
        accepted.state.currentCard = "5";
        accepted.state.deck.splice(accepted.state.deck.indexOf("5"), 1);
        accepted.state.phase = "action";
        accepted.state.turn = 0;
        accepted.turn = { seat: 0, playerId: "p0", number: 2 };
        room = accepted;
        return response({ error: "Room state changed; refresh and try again" }, 409);
      }
    }
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadSorry(fetchImpl);
  try {
    const { document, SorryGame } = dom.window;
    document.querySelector('#playModeChoices [data-value="online"]').click();
    document.querySelector("#createOnlineBtn").click(); await wait(dom.window, 60);
    document.querySelector("#startOnlineBtn").click(); await wait(dom.window, 60);

    const controlled = structuredClone(room); controlled.version += 1;
    controlled.state.phase = "action"; controlled.state.currentCard = "3";
    controlled.state.deck.splice(controlled.state.deck.indexOf("3"), 1);
    controlled.state.pawns[0].zone = "track"; controlled.state.pawns[0].pos = 4;
    room = controlled; SorryGame.online.applyRoom(controlled);
    const marker = Array.from(document.querySelectorAll("#endpointLayer .endpoint-marker")).find(node => /move forward 3/i.test(node.getAttribute("aria-label") || ""));
    assert.ok(marker); marker.click(); await wait(dom.window, 500);

    assert.equal(statePosts, 1, "the stale snapshot is never retried with a newer expectedVersion");
    assert.equal(SorryGame.getState().currentCard, "5");
    assert.equal(SorryGame.getState().phase, "action");
    assert.equal(SorryGame.getState().turn, 0);
    assert.equal(SorryGame.getState().pawns[0].pos, 4, "the stale local move is discarded");
    assert.equal(SorryGame.online.canAct(), true);
    assert.equal(errors.length, 0, errors.map(error => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("a failed uncommitted state POST force-restores the same-version authoritative board", async () => {
  let room = lobby({ ready: true, members: [
    { playerId: "p0", seat: 0, username: "Alex", connected: true },
    { playerId: "p1", seat: 1, username: "Sam", connected: true }
  ], presence: { p0: true, p1: true } });
  let failStatePost = true; let statePosts = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/api/arcade/rooms") && options.method === "POST") return response({ ok: true, code: room.code, token: "host-token", playerId: "p0", seat: 0, room });
    if (String(url).endsWith("/state")) return response({ ok: true, room });
    if (String(url).endsWith("/actions")) {
      const action = JSON.parse(options.body);
      if (action.type === "start") {
        room = Object.assign({}, room, { version: room.version + 1, status: "active", turn: { seat: 0, playerId: "p0", number: 1 }, state: action.state });
        return response({ ok: true, room });
      }
      if (action.type === "state") {
        statePosts++;
        if (failStatePost) return response({ error: "temporary upstream failure" }, 503);
        room = Object.assign({}, room, { version: room.version + 1, turn: { seat: action.nextSeat, playerId: "p1", number: room.turn.number + 1 }, state: action.state });
        return response({ ok: true, room });
      }
    }
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadSorry(fetchImpl);
  try {
    const { document, SorryGame } = dom.window;
    document.querySelector('#playModeChoices [data-value="online"]').click();
    document.querySelector("#createOnlineBtn").click(); await wait(dom.window, 60);
    document.querySelector("#startOnlineBtn").click(); await wait(dom.window, 60);

    const controlled = structuredClone(room); controlled.version += 1;
    controlled.state.phase = "action"; controlled.state.currentCard = "3";
    controlled.state.deck.splice(controlled.state.deck.indexOf("3"), 1);
    controlled.state.pawns[0].zone = "track"; controlled.state.pawns[0].pos = 4;
    room = controlled; SorryGame.online.applyRoom(controlled);
    const marker = () => Array.from(document.querySelectorAll("#endpointLayer .endpoint-marker")).find(node => /move forward 3/i.test(node.getAttribute("aria-label") || ""));
    assert.ok(marker()); marker().click(); await wait(dom.window, 500);

    assert.equal(statePosts, 1);
    assert.equal(SorryGame.getState().currentCard, "3");
    assert.equal(SorryGame.getState().phase, "action");
    assert.equal(SorryGame.getState().turn, 0);
    assert.equal(SorryGame.getState().pawns[0].pos, 4, "same-version GET rolls back the speculative move");
    assert.equal(SorryGame.online.canAct(), true);

    failStatePost = false;
    assert.ok(marker()); marker().click(); await wait(dom.window, 500);
    assert.equal(statePosts, 2, "only an explicit fresh retry submits again");
    assert.equal(SorryGame.getState().pawns[0].pos, 7);
    assert.equal(SorryGame.getState().turn, 1);
    assert.equal(errors.length, 0, errors.map(error => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("a three-player game retains a departed middle identity and skips its vacant seat", async () => {
  let room = lobby({ maxPlayers: 3, ready: true, members: [
    { playerId: "p0", seat: 0, username: "Alex", connected: true },
    { playerId: "p1", seat: 1, username: "Sam", connected: true },
    { playerId: "p2", seat: 2, username: "Jordan", connected: true }
  ], presence: { p0: true, p1: true, p2: true } });
  let completedAction = null;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/api/arcade/rooms") && options.method === "POST") return response({ ok: true, code: room.code, token: "host-token", playerId: "p0", seat: 0, room });
    if (String(url).endsWith("/actions")) {
      const action = JSON.parse(options.body);
      if (action.type === "start") {
        room = Object.assign({}, room, { version: room.version + 1, status: "active", turn: { seat: 0, playerId: "p0", number: 1 }, state: action.state });
      } else if (action.type === "state") {
        completedAction = action;
        room = Object.assign({}, room, { version: room.version + 1, turn: { seat: action.nextSeat, playerId: action.nextSeat === 2 ? "p2" : "p0", number: room.turn.number + 1 }, state: action.state });
      }
      return response({ ok: true, room });
    }
    if (String(url).endsWith("/state")) return response({ ok: true, room });
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadSorry(fetchImpl);
  try {
    const { document, SorryGame } = dom.window;
    document.querySelector('#playModeChoices [data-value="online"]').click();
    document.querySelector('#onlinePlayerCountChoices [data-value="3"]').click();
    document.querySelector("#createOnlineBtn").click(); await wait(dom.window, 60);
    document.querySelector("#startOnlineBtn").click(); await wait(dom.window, 60);
    assert.equal(SorryGame.getState().players.length, 3);

    const interrupted = structuredClone(room); interrupted.version += 1;
    interrupted.state.turn = 1; interrupted.state.phase = "action"; interrupted.state.currentCard = "5";
    interrupted.state.deck.splice(interrupted.state.deck.indexOf("5"), 1);
    interrupted.state.pawns[3].zone = "track"; interrupted.state.pawns[3].pos = 19;
    interrupted.turn = { seat: 1, playerId: "p1", number: 2 };
    room = interrupted; SorryGame.online.applyRoom(interrupted);

    const departed = structuredClone(room); departed.version += 1;
    departed.members = departed.members.filter(member => member.seat !== 1);
    departed.presence = { p0: true, p2: true };
    departed.turn = { seat: 2, playerId: "p2", number: 3 };
    room = departed; SorryGame.online.applyRoom(departed);
    assert.equal(SorryGame.getState().players.length, 3);
    assert.equal(SorryGame.getState().players[1].name, "Sam", "the safe prior identity remains attached to the departed seat");
    assert.equal(SorryGame.getState().turn, 2, "the authoritative room turn replaces the departed current seat");
    assert.equal(SorryGame.getState().phase, "draw");
    assert.equal(SorryGame.getState().currentCard, null);
    assert.equal(SorryGame.online.canAct(), false);

    const controlled = structuredClone(departed); controlled.version += 1;
    controlled.state = structuredClone(SorryGame.getState());
    controlled.state.turn = 0; controlled.state.phase = "action"; controlled.state.currentCard = "3";
    controlled.state.deck.splice(controlled.state.deck.indexOf("3"), 1);
    controlled.state.pawns[0].zone = "track"; controlled.state.pawns[0].pos = 4;
    controlled.turn = { seat: 0, playerId: "p0", number: 4 };
    room = controlled; SorryGame.online.applyRoom(controlled);
    assert.equal(SorryGame.online.canAct(), true);

    const marker = Array.from(document.querySelectorAll("#endpointLayer .endpoint-marker")).find(node => /move forward 3/i.test(node.getAttribute("aria-label") || ""));
    assert.ok(marker); marker.click(); await wait(dom.window, 500);
    assert.ok(completedAction);
    assert.equal(completedAction.nextSeat, 2, "the completed turn skips vacant seat 1");
    assert.equal(completedAction.state.turn, 2);
    assert.equal(SorryGame.getState().turn, 2);
    assert.equal(SorryGame.getState().players[2].name, "Jordan");
    assert.equal(errors.length, 0, errors.map(error => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("leaving relinquishes the server seat and retains the session on a transient failure", async () => {
  let room = lobby(); let failLeave = true;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith("/api/arcade/rooms") && options.method === "POST") return response({ ok: true, code: room.code, token: "host-token", playerId: "p0", seat: 0, room });
    if (String(url).endsWith("/state")) return response({ ok: true, room });
    if (String(url).endsWith("/actions")) {
      const action = JSON.parse(options.body);
      assert.deepEqual(action, { type: "leave" });
      if (failLeave) return response({ error: "temporary" }, 503);
      return response({ ok: true, room: Object.assign({}, room, { status: "finished", members: [] }) });
    }
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadSorry(fetchImpl);
  try {
    const { document, SorryGame } = dom.window;
    document.querySelector('#playModeChoices [data-value="online"]').click();
    document.querySelector("#createOnlineBtn").click(); await wait(dom.window, 60);
    document.querySelector("#leaveRoomBtn").click(); await wait(dom.window, 30);
    assert.equal(SorryGame.online.getSession().active, true);
    assert.ok(dom.window.localStorage.getItem("arcadeSorry_onlineSession_v1"));
    failLeave = false;
    document.querySelector("#leaveRoomBtn").click(); await wait(dom.window, 30);
    assert.equal(SorryGame.online.getSession().active, false);
    assert.equal(dom.window.localStorage.getItem("arcadeSorry_onlineSession_v1"), null);
    assert.equal(errors.length, 0, errors.map(error => error.message).join("\n"));
  } finally { dom.window.close(); }
});
