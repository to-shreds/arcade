import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const pagePath = fileURLToPath(new URL("../../../chat-room/index.html", import.meta.url));
const token = "r".repeat(43);

function room(overrides = {}) {
  return {
    code: "ABC234", game: "chat", version: 1, revision: 1, chatVersion: 0, status: "active", ready: true,
    hostPlayerId: "p_host", minPlayers: 1, maxPlayers: 32,
    playerId: "p_host", seat: 0,
    members: [{ playerId: "p_host", seat: 0, username: "River", connected: true, joinedAt: "2026-09-01T00:00:00.000Z" }],
    presence: { p_host: true }, turn: null, state: null, result: null, chat: [],
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return value; } };
}

async function loadChat(fetchImpl, saved = null, options = {}) {
  const errors = [], sockets = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const html = await readFile(pagePath, "utf8");
  const dom = new JSDOM(html, {
    url: options.url || "https://to-shreds.github.io/arcade/chat-room/index.html",
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      if (saved) window.localStorage.setItem("arcadeChat_session_v1", JSON.stringify(saved));
      for (const [key, value] of Object.entries(options.storage || {})) window.localStorage.setItem(key, String(value));
      if (options.bridge) window.ArcadeMultiplayer = options.bridge;
      window.fetch = fetchImpl;
      window.confirm = () => true;
      window.alert = () => {};
      window.WebSocket = class {
        static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
        constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); }); }
        close() { this.readyState = 3; }
        emitState(next) { this.onmessage?.({ data: JSON.stringify({ type: "state", room: next }) }); }
      };
      options.install?.(window);
    }
  });
  if (dom.window.document.readyState !== "complete") await new Promise((resolve) => dom.window.addEventListener("load", resolve, { once: true }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
  return { dom, errors, sockets };
}

test("Nearby Chat uses the locked Arcade identity, keeps rename disabled, and prefills invitations without autojoining", async () => {
  const calls = [], invitations = [];
  let homeCalls = 0;
  const identity = { memberId: "member-logan", nickname: "Logan", avatar: "🦖" };
  const state = { nearby: true, connected: 3, identity };
  const bridge = {
    getStatus: () => state,
    preferredUsername: () => identity.nickname,
    onStatus(listener) { listener(state); return () => {}; },
    invite(...args) { invitations.push(args); return true; },
    goHome() { homeCalls++; return true; }
  };
  const lockedRoom = room({ members: [{ playerId: "p_host", seat: 0, username: "Logan", connected: true, joinedAt: "2026-09-01T00:00:00.000Z" }] });
  const fetchImpl = async (url, request = {}) => {
    calls.push({ url: String(url), options: request });
    return response({ ok: true, code: "ABC234", token, playerId: "p_host", seat: 0, room: lockedRoom });
  };
  const { dom, errors } = await loadChat(fetchImpl, null, {
    bridge,
    url: "https://to-shreds.github.io/arcade/chat-room/index.html?room=ABC234"
  });
  try {
    const { document, Event } = dom.window;
    assert.equal(calls.length, 0, "an invitation must not autojoin");
    assert.equal(document.querySelector("#joinCode").value, "ABC234");
    assert.equal(document.querySelector("#joinOverlay").classList.contains("hidden"), false);
    assert.equal(document.querySelector("#startName").value, "Logan");
    assert.equal(document.querySelector("#startNameField").hidden, true);
    assert.equal(document.querySelector("#renameBtn").hidden, true);
    assert.match(document.querySelector("#multiplayerTransportStatus").textContent, /Nearby Arcade · 3 connected.*Logan/);

    document.querySelector("#joinOverlay").classList.add("hidden");
    document.querySelector("#createBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    assert.equal(JSON.parse(calls[0].options.body).username, "Logan");
    assert.deepEqual(invitations, [["chat-room", "ABC234", "Arcade Chat"]]);

    document.querySelector("#renameInput").value = "Spoofed";
    document.querySelector("#renameForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 10));
    assert.equal(calls.length, 1, "Nearby rename must not reach the room service");

    document.querySelector("#homeBtn").click();
    assert.equal(homeCalls, 1);
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("saved chat rooms require an explicit resume and never bypass the start screen", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return response({ ok: true, code: "ABC234", token, playerId: "p_host", seat: 0, room: room() });
  };
  const { dom, errors, sockets } = await loadChat(fetchImpl, { code: "ABC234", token });
  try {
    const { document } = dom.window;
    assert.equal(document.querySelector("#startOverlay").classList.contains("hidden"), false);
    assert.equal(document.querySelector("#roomView").classList.contains("hidden"), true);
    assert.equal(document.querySelector("#resumeBtn").hidden, false);
    assert.match(document.querySelector("#resumeBtn").textContent, /ABC234/);
    assert.equal(calls.length, 0);
    assert.equal(sockets.length, 0);

    document.querySelector("#resumeBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/arcade\/rooms\/ABC234\/join$/);
    assert.deepEqual(JSON.parse(calls[0].options.body), { reconnectToken: token });
    assert.equal(document.querySelector("#startOverlay").classList.contains("hidden"), true);
    assert.equal(document.querySelector("#roomView").classList.contains("hidden"), false);
    assert.equal(sockets.length, 1);
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("chat creation, safe message rendering, presence, and nickname changes work", async () => {
  const calls = [];
  let current = room();
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const path = new URL(String(url)).pathname;
    if (path === "/api/arcade/rooms") return response({ ok: true, code: "ABC234", token, playerId: "p_host", seat: 0, room: current });
    const action = JSON.parse(options.body || "{}");
    if (action.type === "chat") {
      current = room({ revision: 2, chatVersion: 1, chat: [{ id: "m_1", playerId: "p_host", seat: 0, username: "River", text: action.text, createdAt: "2026-09-01T00:01:00.000Z" }] });
      return response({ ok: true, room: current });
    }
    if (action.type === "rename") {
      current = room({ revision: 3, chatVersion: 1, members: [{ playerId: "p_host", seat: 0, username: action.username, connected: true, joinedAt: "2026-09-01T00:00:00.000Z" }] });
      return response({ ok: true, room: current });
    }
    throw new Error("Unexpected request " + path);
  };
  const { dom, errors, sockets } = await loadChat(fetchImpl);
  try {
    const { document, Event } = dom.window;
    document.querySelector("#startName").value = "River";
    document.querySelector("#createBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    assert.deepEqual(JSON.parse(calls[0].options.body), { game: "chat", username: "River", maxPlayers: 32 });
    assert.equal(document.querySelector("#roomCode").textContent, "ABC234");
    assert.match(document.querySelector("#members").textContent, /River \(you\)/);
    assert.equal(document.querySelector(".presence").classList.contains("on"), true);
    assert.equal(sockets.length, 1);

    const message = '<img src=x onerror="globalThis.hacked=true"> hello';
    document.querySelector("#messageInput").value = message;
    document.querySelector("#composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    assert.equal(JSON.parse(calls[1].options.body).text, message);
    assert.equal(document.querySelector(".messageText").textContent, message);
    assert.equal(document.querySelector(".messageText img"), null);
    assert.equal(dom.window.hacked, undefined);

    document.querySelector("#renameBtn").click();
    document.querySelector("#renameInput").value = "Sky";
    document.querySelector("#renameForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    assert.deepEqual(JSON.parse(calls[2].options.body), { type: "rename", expectedVersion: 1, username: "Sky" });
    assert.match(document.querySelector("#members").textContent, /Sky \(you\)/);
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("join opens a full room-code field and preserves typed character order", async () => {
  const calls = [];
  const guestRoom = room({ playerId: "p_guest", seat: 1, members: [
    { playerId: "p_host", seat: 0, username: "River", connected: true, joinedAt: "2026-09-01T00:00:00.000Z" },
    { playerId: "p_guest", seat: 1, username: "Sky", connected: true, joinedAt: "2026-09-01T00:01:00.000Z" }
  ] });
  const fetchImpl = async (url, options = {}) => { calls.push({ url: String(url), options }); return response({ ok: true, code: "ABC234", token, playerId: "p_guest", seat: 1, room: guestRoom }); };
  const { dom, errors } = await loadChat(fetchImpl);
  try {
    const { document, Event } = dom.window;
    document.querySelector("#startName").value = "Sky";
    document.querySelector("#joinOpenBtn").click();
    const input = document.querySelector("#joinCode");
    for (const character of "abc234") {
      input.value += character;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    assert.equal(input.value, "ABC234");
    document.querySelector("#joinForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    assert.match(calls[0].url, /\/api\/arcade\/rooms\/ABC234\/join$/);
    assert.deepEqual(JSON.parse(calls[0].options.body), { username: "Sky" });
    assert.match(document.querySelector("#members").textContent, /Sky \(you\)/);
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("a replacement chat socket cancels the older reconnect timer", async () => {
  const fetchImpl = async () => response({ ok: true, code: "ABC234", token, playerId: "p_host", seat: 0, room: room() });
  const { dom, errors, sockets } = await loadChat(fetchImpl);
  try {
    const { document } = dom.window;
    document.querySelector("#startName").value = "River";
    document.querySelector("#createBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    assert.equal(sockets.length, 1);
    const first = sockets[0];
    first.readyState = 3;
    first.onclose?.({});
    dom.window.dispatchEvent(new dom.window.Event("online"));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 750));
    assert.equal(sockets.length, 2);
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("out-of-order equal-version chat snapshots cannot erase newer messages", async () => {
  const fetchImpl = async () => response({ ok: true, code: "ABC234", token, playerId: "p_host", seat: 0, room: room() });
  const { dom, errors, sockets } = await loadChat(fetchImpl);
  try {
    const { document } = dom.window;
    document.querySelector("#startName").value = "River";
    document.querySelector("#createBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    const newest = room({ version: 1, revision: 3, chatVersion: 2, chat: [{ id: "m_2", playerId: "p_host", seat: 0, username: "River", text: "Newest", createdAt: "2026-09-01T00:02:00.000Z" }] });
    const stale = room({ version: 1, revision: 2, chatVersion: 1, chat: [] });
    sockets[0].emitState(newest);
    sockets[0].emitState(stale);
    assert.equal(document.querySelector(".messageText").textContent, "Newest");
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("incoming message sound ignores history, replay, own messages, and a persisted mute", async () => {
  let chimeStarts = 0;
  const history = { id: "m_history", playerId: "p_guest", seat: 1, username: "Sky", text: "Earlier", createdAt: "2026-09-01T00:01:00.000Z" };
  const initial = room({ chatVersion: 1, chat: [history] });
  const installAudio = (window) => {
    window.AudioContext = class {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      createOscillator() { return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() { chimeStarts++; }, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    };
  };
  const fetchImpl = async () => response({ ok: true, code: "ABC234", token, playerId: "p_host", seat: 0, room: initial });
  const { dom, errors, sockets } = await loadChat(fetchImpl, null, { install: installAudio });
  try {
    const { document } = dom.window;
    document.querySelector("#startName").value = "River";
    document.querySelector("#createBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    const log = document.querySelector("#messages");
    assert.equal(log.getAttribute("role"), "log");
    assert.equal(log.getAttribute("aria-live"), "polite");
    assert.equal(log.getAttribute("aria-relevant"), "additions");
    assert.equal(chimeStarts, 0, "room history must be silent");

    const incoming = { id: "m_new", playerId: "p_guest", seat: 1, username: "Sky", text: "Hello", createdAt: "2026-09-01T00:02:00.000Z" };
    const newest = room({ revision: 2, chatVersion: 2, chat: [history, incoming] });
    const historyNode = document.querySelector('[data-message-key="m_history"]');
    sockets[0].emitState(newest);
    assert.equal(chimeStarts, 1);
    sockets[0].emitState(newest);
    assert.equal(chimeStarts, 1, "a replayed snapshot must not chime again");
    assert.equal(document.querySelector('[data-message-key="m_history"]'), historyNode, "replay must not rebuild and re-announce history");

    const own = { id: "m_own", playerId: "p_host", seat: 0, username: "River", text: "Mine", createdAt: "2026-09-01T00:03:00.000Z" };
    sockets[0].emitState(room({ revision: 3, chatVersion: 3, chat: [history, incoming, own] }));
    assert.equal(chimeStarts, 1, "own messages must be silent");

    document.querySelector("#soundBtn").click();
    assert.equal(document.querySelector("#soundBtn").getAttribute("aria-pressed"), "false");
    assert.equal(document.querySelector("#soundText").textContent, "Muted");
    assert.equal(dom.window.localStorage.getItem("arcadeChat_sound_v1"), "0");
    const mutedIncoming = { id: "m_muted", playerId: "p_guest", seat: 1, username: "Sky", text: "Still there?", createdAt: "2026-09-01T00:04:00.000Z" };
    sockets[0].emitState(room({ revision: 4, chatVersion: 4, chat: [history, incoming, own, mutedIncoming] }));
    assert.equal(chimeStarts, 1, "muted incoming messages must be silent");
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }

  const mutedLoad = await loadChat(fetchImpl, null, { install: installAudio, storage: { arcadeChat_sound_v1: "0" } });
  try {
    assert.equal(mutedLoad.dom.window.document.querySelector("#soundText").textContent, "Muted", "mute preference is restored on reload");
    assert.equal(mutedLoad.errors.length, 0, mutedLoad.errors.map((error) => error.message).join("\n"));
  } finally { mutedLoad.dom.window.close(); }
});

test("desktop notifications are gesture-opt-in, background-only, plain text, and deduplicated across reconnect", async () => {
  const notifications = [];
  let permissionRequests = 0;
  let notificationPermission = "default";
  const history = { id: "m_history", playerId: "p_guest", seat: 1, username: "Sky", text: "Earlier", createdAt: "2026-09-01T00:01:00.000Z" };
  const initial = room({ chatVersion: 1, chat: [history] });
  const fetchImpl = async () => response({ ok: true, code: "ABC234", token, playerId: "p_host", seat: 0, room: initial });
  const installNotifications = (window) => {
    window.Notification = class {
      static get permission() { return notificationPermission; }
      static async requestPermission() { permissionRequests++; notificationPermission = "granted"; return "granted"; }
      constructor(title, options) { notifications.push({ title, options }); }
    };
  };
  const { dom, errors, sockets } = await loadChat(fetchImpl, null, { install: installNotifications });
  try {
    const { document, Event } = dom.window;
    let hidden = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
    document.hasFocus = () => !hidden;
    assert.equal(permissionRequests, 0, "loading Chat must not request notification permission");
    document.querySelector("#notifyBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 10));
    assert.equal(permissionRequests, 1, "permission is requested only by the notification button gesture");
    assert.equal(document.querySelector("#notifyBtn").getAttribute("aria-pressed"), "true");
    assert.equal(dom.window.localStorage.getItem("arcadeChat_notifications_v1"), "1");

    document.querySelector("#startName").value = "River";
    document.querySelector("#createBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    assert.equal(notifications.length, 0, "history must not trigger a desktop notification");

    const incoming = { id: "m_notify", playerId: "p_guest", seat: 1, username: "<Sky>\u0000", text: "<b>Hello</b>\u0000 there", createdAt: "2026-09-01T00:02:00.000Z" };
    const newest = room({ revision: 2, chatVersion: 2, chat: [history, incoming] });
    sockets[0].emitState(newest);
    assert.equal(notifications.length, 1);
    assert.doesNotMatch(notifications[0].title, /[<>\u0000-\u001f\u007f]/);
    assert.doesNotMatch(notifications[0].options.body, /[<>\u0000-\u001f\u007f]/);
    assert.equal(notifications[0].options.silent, true);

    sockets[0].readyState = 3;
    sockets[0].onclose?.({});
    dom.window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    assert.equal(sockets.length, 2);
    sockets[1].emitState(newest);
    assert.equal(notifications.length, 1, "reconnect replay must not notify twice");

    const own = { id: "m_own", playerId: "p_host", seat: 0, username: "River", text: "Mine", createdAt: "2026-09-01T00:03:00.000Z" };
    sockets[1].emitState(room({ revision: 3, chatVersion: 3, chat: [history, incoming, own] }));
    assert.equal(notifications.length, 1, "own messages must not notify");

    hidden = false;
    const visibleIncoming = { id: "m_visible", playerId: "p_guest", seat: 1, username: "Sky", text: "Visible", createdAt: "2026-09-01T00:04:00.000Z" };
    sockets[1].emitState(room({ revision: 4, chatVersion: 4, chat: [history, incoming, own, visibleIncoming] }));
    assert.equal(notifications.length, 1, "focused visible Chat must not send a desktop notification");
    assert.equal(permissionRequests, 1);
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }

  const enabledLoad = await loadChat(fetchImpl, null, { install: installNotifications, storage: { arcadeChat_notifications_v1: "1" } });
  try {
    assert.equal(enabledLoad.dom.window.document.querySelector("#notifyText").textContent, "Notify on", "notification preference is restored when permission remains granted");
    assert.equal(enabledLoad.dom.window.document.querySelector("#notifyBtn").getAttribute("aria-pressed"), "true");
    assert.equal(permissionRequests, 1, "restoring the preference never requests permission during load");
    assert.equal(enabledLoad.errors.length, 0, enabledLoad.errors.map((error) => error.message).join("\n"));
  } finally { enabledLoad.dom.window.close(); }
});

test("failed new Chat attempts release their implicit authority pin", async () => {
  let resets = 0;
  const calls = [];
  const bridge = {
    getStatus: () => ({ nearby: true, effectiveTransport: "nearby", connected: 2 }),
    preferredUsername: (fallback) => fallback,
    resetRoomTransport() { resets++; }
  };
  const fetchImpl = async (url, options = {}) => { calls.push({ url: String(url), options }); return response({ ok: false, error: "Nearby unavailable" }, 503); };
  const { dom, errors } = await loadChat(fetchImpl, null, { bridge });
  try {
    const { document, Event } = dom.window;
    document.querySelector("#startName").value = "River";
    document.querySelector("#createBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    assert.equal(resets, 1);
    assert.equal(dom.window.localStorage.getItem("arcadeChat_session_v1"), null);

    document.querySelector("#joinOpenBtn").click();
    document.querySelector("#joinCode").value = "ABC234";
    document.querySelector("#joinForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    assert.equal(resets, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((call) => !call.options.headers?.authorization), true, "a failed new attempt must not send a saved token");
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});

test("saved Chat resumes keep their authority on transient failure and clear it on terminal 410", async () => {
  let resets = 0, attempts = 0;
  const pins = [];
  const saved = { code: "ABC234", token, transport: "nearby" };
  const bridge = {
    getStatus: () => ({ nearby: false, effectiveTransport: "cloudflare", connected: 1 }),
    pinRoomTransport(value) { pins.push(value); return value; },
    resetRoomTransport() { resets++; }
  };
  const fetchImpl = async () => ++attempts === 1
    ? response({ ok: false, error: "Nearby temporarily unavailable" }, 503)
    : response({ ok: false, error: "Room is gone" }, 410);
  const { dom, errors } = await loadChat(fetchImpl, saved, { bridge });
  try {
    const { document } = dom.window;
    document.querySelector("#resumeBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    assert.deepEqual(pins, ["nearby"]);
    assert.equal(resets, 0, "transient resume failure preserves saved-room authority");
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("arcadeChat_session_v1")), saved);
    assert.equal(document.querySelector("#resumeBtn").hidden, false);

    document.querySelector("#resumeBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    assert.deepEqual(pins, ["nearby", "nearby"]);
    assert.equal(resets, 1);
    assert.equal(dom.window.localStorage.getItem("arcadeChat_session_v1"), null);
    assert.equal(document.querySelector("#resumeBtn").hidden, true);
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally { dom.window.close(); }
});
