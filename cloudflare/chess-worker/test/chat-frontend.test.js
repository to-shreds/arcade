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

async function loadChat(fetchImpl, saved = null) {
  const errors = [], sockets = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const html = await readFile(pagePath, "utf8");
  const dom = new JSDOM(html, {
    url: "https://to-shreds.github.io/arcade/chat-room/index.html",
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      if (saved) window.localStorage.setItem("arcadeChat_session_v1", JSON.stringify(saved));
      window.fetch = fetchImpl;
      window.confirm = () => true;
      window.alert = () => {};
      window.WebSocket = class {
        static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
        constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); }); }
        close() { this.readyState = 3; }
        emitState(next) { this.onmessage?.({ data: JSON.stringify({ type: "state", room: next }) }); }
      };
    }
  });
  if (dom.window.document.readyState !== "complete") await new Promise((resolve) => dom.window.addEventListener("load", resolve, { once: true }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
  return { dom, errors, sockets };
}

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
