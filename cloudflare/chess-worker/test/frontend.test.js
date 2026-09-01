import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const chessPath = fileURLToPath(new URL("../../../chess/index.html", import.meta.url));
const savePath = fileURLToPath(new URL("../../../arcade-save.js", import.meta.url));

function startBoard() {
  const board = Array(64).fill(null);
  for (const [index, piece] of [[0,"R"],[1,"N"],[2,"B"],[3,"Q"],[4,"K"],[5,"B"],[6,"N"],[7,"R"],[56,"r"],[57,"n"],[58,"b"],[59,"q"],[60,"k"],[61,"b"],[62,"n"],[63,"r"]]) board[index] = piece;
  for (let i = 8; i < 16; i++) board[i] = "P";
  for (let i = 48; i < 56; i++) board[i] = "p";
  return board;
}

function room(side = "w", code = "ABC234") {
  return {
    code, version: 2, side, ready: true, presence: { w: true, b: true }, pending: null,
    game: { board: startBoard(), turn: "w", castling: "KQkq", enPassant: null, halfmove: 0, fullmove: 1, moves: [], result: { over: false, reason: null, winner: null, check: false } }
  };
}

function tapSquare(window, square) {
  const target = window.document.querySelector(`#board .sq[data-sq="${square}"]`);
  assert.ok(target, `square ${square} exists`);
  for (const type of ["pointerdown", "pointerup"]) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, clientX: { value: 10 }, clientY: { value: 10 } });
    target.dispatchEvent(event);
  }
}

async function loadChess(fetchImpl = async () => { throw new Error("unexpected fetch"); }, savedSettings = null) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const [pageHtml, saveScript] = await Promise.all([readFile(chessPath,"utf8"),readFile(savePath,"utf8")]);
  const html = pageHtml.replace('<script src="../arcade-save.js"></script>', `<script>${saveScript}</script>`);
  const dom = new JSDOM(html, {
    url: "https://to-shreds.github.io/arcade/chess/index.html",
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      if (savedSettings) window.localStorage.setItem("arcadeChess_settings", savedSettings);
      window.fetch = fetchImpl;
      window.confirm = () => true;
      window.alert = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.HTMLElement.prototype.setPointerCapture = () => {};
      window.HTMLElement.prototype.releasePointerCapture = () => {};
      window.__chessTestSockets = [];
      window.WebSocket = class {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        constructor(url) { this.url = url; this.readyState = 0; this.listeners = new Map(); window.__chessTestSockets.push(this); queueMicrotask(() => { this.readyState = 1; this.emit("open", {}); }); }
        addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
        emit(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
        close() { this.readyState = 3; queueMicrotask(() => this.emit("close", {})); }
      };
    }
  });
  if (dom.window.document.readyState !== "complete") await new Promise((resolve) => dom.window.addEventListener("load", resolve, { once: true }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
  return { dom, errors };
}

test("simplified setup preserves local play, all CPU levels and secondary settings", async () => {
  const { dom, errors } = await loadChess();
  const { document, Event } = dom.window;
  assert.equal(document.querySelectorAll("#startPane .startCard").length, 3);
  assert.equal(document.querySelector("#diffRange").min, "1");
  assert.equal(document.querySelector("#diffRange").max, "10");

  document.querySelector("#prefsOpen").click();
  assert.equal(document.querySelector("#prefsPane").hidden, false);
  const orientation = document.querySelector("#opponentFacingCheck");
  orientation.checked = false;
  orientation.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(JSON.parse(dom.window.localStorage.getItem("arcadeChess_settings")).opponentFacing, false);
  document.querySelector("#prefsBack").click();
  document.querySelector("#modePvp").click();
  assert.equal(document.querySelectorAll("#board .sq").length, 64);
  assert.match(document.querySelector("#modeText").textContent, /LOCAL PVP/);
  tapSquare(dom.window, 12);
  tapSquare(dom.window, 28);
  assert.equal(document.querySelector("#turnText").textContent, "BLACK");

  for (let level = 1; level <= 10; level++) {
    document.querySelector("#newBtn").click();
    const range = document.querySelector("#diffRange");
    range.value = String(level);
    range.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#sideWhite").click();
    document.querySelector("#modeCpu").click();
    assert.match(document.querySelector("#modeText").textContent, new RegExp("L" + level + "\\)"));
  }
  assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  dom.window.close();
});

test("flipped coordinates and opponent-piece orientation persist correctly", async () => {
  const first = await loadChess();
  const { document, Event } = first.dom.window;
  document.querySelector("#sideBlack").click();
  const topLeft = document.querySelector("#board .sq:first-child");
  const bottomLeft = document.querySelectorAll("#board .sq")[56];
  assert.equal(topLeft.dataset.sq, "7");
  assert.equal(topLeft.querySelector(".coord.rank").textContent, "1");
  assert.equal(bottomLeft.dataset.sq, "63");
  assert.equal(bottomLeft.querySelector(".coord.file").textContent, "h");
  assert.equal(document.querySelectorAll("#board .piece.opposite-facing").length, 16);

  const orientation = document.querySelector("#opponentFacingCheck");
  orientation.checked = false;
  orientation.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(document.querySelectorAll("#board .piece.opposite-facing").length, 0);
  const saved = first.dom.window.localStorage.getItem("arcadeChess_settings");
  first.dom.window.close();

  const restored = await loadChess(undefined, saved);
  assert.equal(restored.dom.window.document.querySelector("#opponentFacingCheck").checked, false);
  assert.equal(restored.dom.window.document.querySelectorAll("#board .piece.opposite-facing").length, 0);
  assert.equal(restored.errors.length, 0, restored.errors.map((error) => error.message).join("\n"));
  restored.dom.window.close();
});

test("online creation enters the shared board and exposes room/reconnect state", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/api/chess/rooms")) {
      return { ok: true, status: 200, async json() { return { ok: true, token: "t".repeat(43), side: "w", room: room("w") }; } };
    }
    if (String(url).endsWith("/actions")) {
      return { ok: true, status: 200, async json() { return { ok: true, room: room("w") }; } };
    }
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadChess(fetchImpl);
  const { document } = dom.window;
  document.querySelector("#onlineCreateBtn").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /arcade-chess\.jonathanjablon\.workers\.dev\/api\/chess\/rooms$/);
  assert.match(document.querySelector("#modeText").textContent, /ONLINE ABC234/);
  assert.equal(document.querySelector("#onlineBar").classList.contains("show"), true);
  assert.match(document.querySelector("#onlineRoomCode").textContent, /ABC234/);
  const session = JSON.parse(dom.window.localStorage.getItem("arcadeChess_onlineSession_v1"));
  assert.deepEqual(session, { code: "ABC234", token: "t".repeat(43) });
  tapSquare(dom.window, 12);
  tapSquare(dom.window, 28);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), { type: "move", expectedVersion: 2, uci: "e2e4" });
  assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  dom.window.close();
});

test("online join uses a roomy native field and preserves typed character order", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/api/chess/rooms/ABC234/join")) {
      return { ok: true, status: 200, async json() { return { ok: true, token: "b".repeat(43), side: "b", room: room("b") }; } };
    }
    throw new Error("unexpected fetch " + url);
  };
  const { dom, errors } = await loadChess(fetchImpl);
  try {
    const { document, Event } = dom.window;

    assert.equal(document.querySelector(".startCard.online input"), null);
    document.querySelector("#onlineJoinOpenBtn").click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    assert.equal(document.querySelector("#joinPane").hidden, false);
    const input = document.querySelector("#onlineJoinCode");
    assert.equal(document.activeElement, input);
    assert.equal(input.readOnly, false);
    assert.equal(input.inputMode, "text");

    for (const character of "ABCDE") {
      input.value += character;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    assert.equal(input.value, "ABCDE");
    document.querySelector("#onlineJoinForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    assert.equal(calls.length, 0);
    assert.match(document.querySelector("#onlineJoinStatus").textContent, /valid six-character/i);

    document.querySelector("#onlineJoinBack").click();
    assert.equal(document.querySelector("#joinPane").hidden, true);
    assert.equal(document.querySelector("#startPane").hidden, false);
    document.querySelector("#onlineJoinOpenBtn").click();
    input.value = "abc234";
    document.querySelector("#onlineJoinForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/chess\/rooms\/ABC234\/join$/);
    assert.deepEqual(JSON.parse(calls[0].options.body), {});
    assert.equal(input.value, "ABC234");
    assert.match(document.querySelector("#modeText").textContent, /ONLINE ABC234/);
    assert.notEqual(document.activeElement, input);
    assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  } finally {
    dom.window.close();
  }
});

test("out-of-order online snapshots cannot roll the board back", async () => {
  const initial = room("w");
  const fetchImpl = async (url) => {
    if (!String(url).endsWith("/api/chess/rooms")) throw new Error("unexpected fetch " + url);
    return { ok: true, status: 200, async json() { return { ok: true, token: "t".repeat(43), side: "w", room: initial }; } };
  };
  const { dom, errors } = await loadChess(fetchImpl);
  const { document } = dom.window;
  document.querySelector("#onlineCreateBtn").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
  const advanced = room("w");
  advanced.version = 3;
  advanced.game.board[12] = null;
  advanced.game.board[28] = "P";
  advanced.game.turn = "b";
  advanced.game.moves = [{ uci: "e2e4", san: "e4", from: "e2", to: "e4", promotion: null }];
  const socket = dom.window.__chessTestSockets[0];
  socket.emit("message", { data: JSON.stringify({ type: "state", room: advanced }) });
  socket.emit("message", { data: JSON.stringify({ type: "state", room: initial }) });
  assert.equal(document.querySelector("#turnText").textContent, "BLACK");
  assert.equal(document.querySelector("#plyMax").textContent, "1");
  assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  dom.window.close();
});

test("entering an online room preserves the in-progress local game for loading", async () => {
  const fetchImpl = async (url) => {
    if (!String(url).endsWith("/api/chess/rooms")) throw new Error("unexpected fetch " + url);
    return { ok: true, status: 200, async json() { return { ok: true, token: "t".repeat(43), side: "w", room: room("w") }; } };
  };
  const { dom, errors } = await loadChess(fetchImpl);
  const { document } = dom.window;
  document.querySelector("#modePvp").click();
  tapSquare(dom.window, 12);
  tapSquare(dom.window, 28);
  document.querySelector("#newBtn").click();
  document.querySelector("#onlineCreateBtn").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
  document.querySelector("#saveBtn").click();
  const saved = JSON.parse(dom.window.localStorage.getItem("arcade_chess_save_v1"));
  assert.equal(saved.settings.mode, "pvp");
  assert.equal(saved.moves.length, 1);
  assert.equal(saved.moves[0].from, 12);
  assert.equal(saved.moves[0].to, 28);
  assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  dom.window.close();
});

test("a deliberately replaced online socket cannot start a duplicate reconnect loop", async () => {
  let creates = 0;
  const fetchImpl = async (url) => {
    if (!String(url).endsWith("/api/chess/rooms")) throw new Error("unexpected fetch " + url);
    const code = creates++ === 0 ? "ABC234" : "XYZ789";
    return { ok: true, status: 200, async json() { return { ok: true, token: code.repeat(8), side: "w", room: room("w", code) }; } };
  };
  const { dom, errors } = await loadChess(fetchImpl);
  const { document } = dom.window;
  document.querySelector("#onlineCreateBtn").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
  document.querySelector("#onlineCreateBtn").click();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 950));
  assert.equal(dom.window.__chessTestSockets.length, 2);
  assert.match(dom.window.__chessTestSockets[1].url, /XYZ789/);
  assert.equal(errors.length, 0, errors.map((error) => error.message).join("\n"));
  dom.window.close();
});
