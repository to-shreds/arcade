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

function room(side = "w") {
  return {
    code: "ABC234", version: 2, side, ready: true, presence: { w: true, b: true }, pending: null,
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

async function loadChess(fetchImpl = async () => { throw new Error("unexpected fetch"); }) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const [pageHtml, saveScript] = await Promise.all([readFile(chessPath,"utf8"),readFile(savePath,"utf8")]);
  const html = pageHtml.replace('<script src="../arcade-save.js"></script>', `<script>${saveScript}</script>`);
  const dom = new JSDOM(html, {
    url: "https://to-shreds.github.io/arcade/chess/index.html",
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      window.fetch = fetchImpl;
      window.confirm = () => true;
      window.alert = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.HTMLElement.prototype.setPointerCapture = () => {};
      window.HTMLElement.prototype.releasePointerCapture = () => {};
      window.WebSocket = class {
        static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
        constructor(url) { this.url = url; this.readyState = 0; this.listeners = new Map(); queueMicrotask(() => { this.readyState = 1; this.emit("open", {}); }); }
        addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
        emit(type, event) { for (const fn of this.listeners.get(type) || []) fn(event); }
        close() { this.readyState = 3; this.emit("close", {}); }
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
