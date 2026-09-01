import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM, VirtualConsole } from "../../cloudflare/chess-worker/node_modules/jsdom/lib/api.js";

const source = await readFile(new URL("../arcade-multiplayer.js", import.meta.url), "utf8");

function tick(delay = 0){ return new Promise(resolve => setTimeout(resolve, delay)); }

function environment({ framed = true, serviceWorker = false, nearbyMarker = false, handshakeTimeoutMs = null } = {}){
  const calls = [];
  const nativeFetchCalls = [];
  const nativeSockets = [];
  const serviceWorkerMessages = [];
  const serviceWorkerListeners = new Map();
  const dom = new JSDOM("<!doctype html><title>Game</title>", {
    url: `https://to-shreds.github.io/arcade/chess/${nearbyMarker ? "?_arcadeTransport=nearby" : ""}`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
  });
  const { window } = dom;
  window.Response = Response;
  window.Headers = Headers;
  window.Request = Request;
  window.AbortController = AbortController;
  window.TextEncoder = TextEncoder;
  window.fetch = async(input, init) => {
    nativeFetchCalls.push({ input: String(input), init });
    return new Response(JSON.stringify({ ok: true, source: "cloudflare" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  class NativeSocket {
    constructor(url){ this.url = url; this.readyState = 0; nativeSockets.push(this); }
    addEventListener(){}
    close(){ this.readyState = 3; }
  }
  NativeSocket.CONNECTING = 0;
  NativeSocket.OPEN = 1;
  NativeSocket.CLOSING = 2;
  NativeSocket.CLOSED = 3;
  window.WebSocket = NativeSocket;
  const parent = framed ? { postMessage(message, origin){ calls.push({ message, origin }); } } : window;
  if(framed) Object.defineProperty(window, "parent", { configurable: true, value: parent });
  if(serviceWorker){
    const controller = { postMessage(message){ serviceWorkerMessages.push(message); } };
    Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: {
      controller,
      ready: Promise.resolve({ active: controller }),
      addEventListener(type, listener){ serviceWorkerListeners.set(type, listener); }
    }});
  }
  const evaluatedSource = handshakeTimeoutMs === null
    ? source
    : source.replace("const HANDSHAKE_TIMEOUT_MS = 900;", `const HANDSHAKE_TIMEOUT_MS = ${Number(handshakeTimeoutMs)};`);
  window.eval(evaluatedSource);

  function deliver(message, { origin = window.location.origin, source: eventSource = parent } = {}){
    window.dispatchEvent(new window.MessageEvent("message", { data: message, origin, source: eventSource }));
  }
  function last(type){
    const entry = [...calls].reverse().find(call => call.message.type === type);
    assert.ok(entry, `Expected ${type} bridge message`);
    return entry.message;
  }
  function hello(state){
    const request = last("hello");
    deliver({
      scope: "arcade-multiplayer",
      bridgeVersion: 1,
      frameId: request.frameId,
      type: "hello-result",
      state
    });
    return request.frameId;
  }
  function answerRpc(message, result = { status: 200, body: { ok: true } }){
    deliver({
      scope: "arcade-multiplayer",
      bridgeVersion: 1,
      frameId: message.frameId,
      type: "rpc-result",
      requestId: message.requestId,
      ok: true,
      result
    });
  }
  return { dom, window, parent, calls, nativeFetchCalls, nativeSockets, serviceWorkerMessages, serviceWorkerListeners, deliver, last, hello, answerRpc };
}

test("game iframe declares and reasserts only its own service-worker transport", () => {
  const env = environment({ serviceWorker: true, nearbyMarker: true });
  assert.equal(env.serviceWorkerMessages.at(-1).mode, "nearby", "shell marker binds the iframe before handshake");
  const frameId = env.hello({ nearby: true, connected: 2, status: "Nearby Arcade" });
  assert.equal(env.serviceWorkerMessages.at(-1).mode, "nearby");
  env.window.dispatchEvent(new env.window.PageTransitionEvent("pagehide"));
  assert.equal(env.serviceWorkerMessages.at(-1).mode, "online", "pagehide releases the closing iframe's service-worker claim");
  env.serviceWorkerListeners.get("controllerchange")();
  assert.equal(env.serviceWorkerMessages.at(-1).mode, "online", "frame reasserts mode after service-worker replacement");
  env.dom.window.close();
});

test("direct game tab never inherits another tab's Nearby mode", () => {
  const env = environment({ framed: false, serviceWorker: true, nearbyMarker: true });
  assert.equal(env.serviceWorkerMessages.at(-1).mode, "online");
  env.dom.window.close();
});

test("direct game links retain the existing Cloudflare transport", async() => {
  const env = environment({ framed: false });
  const response = await env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/chess/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal((await response.json()).source, "cloudflare");
  assert.equal(env.nativeFetchCalls.length, 1);
  assert.equal(env.window.ArcadeMultiplayer.getStatus().effectiveTransport, "cloudflare");
  env.dom.window.close();
});

test("a Nearby-marked iframe queues room traffic until its delayed shell hello", async() => {
  const env = environment({ nearbyMarker: true });
  const helloRequest = env.last("hello");
  assert.equal(env.window.ArcadeMultiplayer.getStatus().effectiveTransport, "nearby");
  const pending = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "chat", username: "River", maxPlayers: 32 })
  });
  await tick(10);
  assert.equal(env.nativeFetchCalls.length, 0, "the shell marker blocks native fetch before hello");
  assert.equal(env.calls.some(call => call.message.type === "rpc"), false, "the request waits for the authenticated bridge");

  env.deliver({
    scope: "arcade-multiplayer", bridgeVersion: 1, frameId: helloRequest.frameId,
    type: "hello-result", state: { nearby: true, connected: 2, status: "Nearby Arcade" }
  });
  await tick();
  const request = env.last("rpc");
  assert.equal(request.operation, "http");
  env.answerRpc(request, { status: 200, body: { ok: true, code: "ABC234" } });
  assert.equal((await pending).status, 200);
  assert.equal(env.nativeFetchCalls.length, 0);
  assert.equal(env.window.ArcadeMultiplayer.getStatus().pinnedTransport, "nearby");
  env.dom.window.close();
});

test("a Nearby-marked iframe fails closed when its shell never answers", async() => {
  const env = environment({ nearbyMarker: true, handshakeTimeoutMs: 5 });
  const response = await env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms/ABC234/state", {
    headers: { authorization: "Bearer nearby-secret" }
  });
  assert.equal(response.status, 503);
  assert.equal(env.nativeFetchCalls.length, 0, "Nearby credentials must never reach the Internet after hello timeout");
  assert.equal(env.calls.some(call => call.message.type === "rpc"), false, "no RPC is sent without an authenticated bridge");
  assert.equal(env.window.ArcadeMultiplayer.getStatus().pinnedTransport, "nearby");

  const socket = new env.window.WebSocket("wss://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms/ABC234/ws?token=nearby-secret");
  await tick(15);
  assert.equal(env.nativeSockets.length, 0, "Nearby socket credentials must not open a native WebSocket");
  assert.equal(socket.readyState, env.window.WebSocket.CLOSED);
  env.dom.window.close();
});

test("authenticated transport state releases the startup marker before a room is pinned", async() => {
  const env = environment({ nearbyMarker: true });
  const frameId = env.hello({ nearby: true, connected: 2, status: "Nearby Arcade" });
  assert.equal(env.window.ArcadeMultiplayer.getStatus().effectiveTransport, "nearby");
  assert.equal(env.window.ArcadeMultiplayer.getStatus().pinnedTransport, null);
  env.deliver({
    scope: "arcade-multiplayer", bridgeVersion: 1, frameId,
    type: "transport-state", state: { nearby: false, connected: 1, status: "Internet" }
  });
  assert.equal(env.window.ArcadeMultiplayer.getStatus().effectiveTransport, "cloudflare");
  const response = await env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms", {
    method: "POST", body: "{}"
  });
  assert.equal(response.status, 200);
  assert.equal(env.nativeFetchCalls.length, 1, "a future room follows authenticated Internet selection");
  assert.equal(env.calls.some(call => call.message.type === "rpc"), false);
  env.dom.window.close();
});

test("an unrelated iframe cannot swallow Home or shell navigation", () => {
  const env = environment();
  assert.equal(env.window.ArcadeMultiplayer.openGame("chess"), false);
  assert.equal(env.window.ArcadeMultiplayer.goHome(), false);
  assert.equal(env.calls.some(call => call.message.type === "open-game" || call.message.type === "home"), false);
  env.dom.window.close();
});

test("an authenticated Nearby shell blocks a new saved Cloudflare resume", async() => {
  const env = environment();
  env.hello({ nearby: true, connected: 3, identity: { memberId: "m1", nickname: "Nearby Name", avatar: "🦖" } });
  assert.throws(
    () => env.window.ArcadeMultiplayer.pinRoomTransport("cloudflare"),
    /Disconnect Nearby Arcade to resume this Internet room\./
  );
  assert.equal(env.window.ArcadeMultiplayer.getStatus().pinnedTransport, null);
  assert.equal(env.nativeFetchCalls.length, 0);
  assert.equal(env.nativeSockets.length, 0);
  env.dom.window.close();
});

test("a Nearby-marked frame blocks a saved Cloudflare resume before shell authentication", () => {
  const env = environment({ nearbyMarker: true });
  assert.throws(
    () => env.window.ArcadeMultiplayer.pinRoomTransport("cloudflare"),
    /Disconnect Nearby Arcade to resume this Internet room\./
  );
  assert.equal(env.window.ArcadeMultiplayer.getStatus().pinnedTransport, null);
  assert.equal(env.nativeFetchCalls.length, 0);
  assert.equal(env.nativeSockets.length, 0);
  env.dom.window.close();
});

test("an already-pinned live Cloudflare room stays pinned when Nearby becomes active", async() => {
  const env = environment();
  assert.equal(env.window.ArcadeMultiplayer.pinRoomTransport("cloudflare"), "cloudflare");
  env.hello({ nearby: true, connected: 3, identity: { memberId: "m1", nickname: "Nearby Name", avatar: "🦖" } });
  assert.equal(env.window.ArcadeMultiplayer.pinRoomTransport("cloudflare"), "cloudflare");
  assert.equal(env.window.ArcadeMultiplayer.getIdentity(), null, "Nearby identity is not applied to an Internet room");
  assert.equal(env.window.ArcadeMultiplayer.preferredUsername("Internet Name"), "Internet Name");
  assert.equal(env.window.ArcadeMultiplayer.invite("chess", "ABC234", "Chess"), false);
  const response = await env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/chess/rooms/ABC234/state", {
    headers: { authorization: "Bearer cloudflare-secret" }
  });
  assert.equal(response.status, 200);
  assert.equal(env.nativeFetchCalls.length, 1);
  assert.equal(env.calls.some(call => call.message.type === "rpc"), false);
  assert.equal(env.window.ArcadeMultiplayer.getStatus().effectiveTransport, "cloudflare");
  env.dom.window.close();
});

test("a saved Nearby room fails closed after Nearby is lost", async() => {
  const env = environment();
  const helloRequest = env.last("hello");
  assert.equal(env.window.ArcadeMultiplayer.pinRoomTransport("nearby"), "nearby");
  const pending = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms/ABC234/state", {
    headers: { authorization: "Bearer nearby-secret" }
  });
  env.deliver({
    scope: "arcade-multiplayer", bridgeVersion: 1, frameId: helloRequest.frameId,
    type: "hello-result", state: { nearby: false, connected: 1, status: "Nearby unavailable" }
  });
  await tick();
  const request = env.last("rpc");
  assert.equal(request.operation, "http");
  env.answerRpc(request, { status: 503, body: { ok: false, error: "Nearby unavailable" } });
  assert.equal((await pending).status, 503);
  assert.equal(env.nativeFetchCalls.length, 0, "the Nearby reconnect token must never reach Cloudflare");
  assert.equal(env.window.ArcadeMultiplayer.getStatus().effectiveTransport, "nearby");
  env.dom.window.close();
});

test("terminal leave responses clear the pin before the next room", async() => {
  const env = environment();
  const frameId = env.hello({ nearby: true, connected: 2 });
  let pending = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms", { method: "POST", body: "{}" });
  await tick();
  env.answerRpc(env.last("rpc"), { status: 200, body: { ok: true, code: "ABC234", token: "x".repeat(43) } });
  await pending;
  pending = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms/ABC234/actions", {
    method: "POST", body: JSON.stringify({ type: "leave" })
  });
  await tick();
  env.answerRpc(env.last("rpc"), { status: 404, body: { ok: false, error: "Room not found" } });
  assert.equal((await pending).status, 404);
  assert.equal(env.window.ArcadeMultiplayer.getStatus().pinnedTransport, null);
  env.deliver({ scope: "arcade-multiplayer", bridgeVersion: 1, frameId, type: "transport-state", state: { nearby: false, connected: 1 } });
  await env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms", { method: "POST", body: "{}" });
  assert.equal(env.nativeFetchCalls.length, 1, "a new room selects the current transport after terminal leave");
  env.dom.window.close();
});

test("Nearby fetch preserves Request bodies and abort signals", async() => {
  const env = environment();
  env.hello({ nearby: true, connected: 2 });
  const controller = new AbortController();
  const input = new Request("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "memory", username: "Ada", maxPlayers: 2 }),
    signal: controller.signal
  });
  const pending = env.window.fetch(input);
  await tick();
  const request = env.last("rpc");
  assert.deepEqual(JSON.parse(request.payload.body), { game: "memory", username: "Ada", maxPlayers: 2 });
  controller.abort();
  await assert.rejects(pending, error => error && error.name === "AbortError");
  assert.equal(env.nativeFetchCalls.length, 0);
  env.dom.window.close();
});

test("a paired shell routes room HTTP without contacting Cloudflare", async() => {
  const env = environment();
  env.hello({ nearby: true, connected: 3, status: "Nearby Arcade", identity: { memberId: "m_logan", browserId: "b1", nickname: "Logan", avatar: "🦖" } });
  const pending = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "chat", username: "Spoofed", maxPlayers: 32 })
  });
  await tick();
  const request = env.last("rpc");
  assert.equal(request.operation, "http");
  assert.equal(request.payload.url, "/api/arcade/rooms");
  env.answerRpc(request, { status: 200, body: { ok: true, code: "ABC234", token: "x".repeat(43) } });
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).code, "ABC234");
  assert.equal(env.nativeFetchCalls.length, 0);
  assert.equal(env.window.ArcadeMultiplayer.preferredUsername("Other"), "Logan");
  env.dom.window.close();
});

test("an active Nearby room remains pinned when the peer link is lost", async() => {
  const env = environment({ nearbyMarker: true });
  const frameId = env.hello({ nearby: true, connected: 2, identity: { memberId: "m1", nickname: "Jon", avatar: "😎" } });
  let pending = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/chess/rooms", { method: "POST", body: "{}" });
  await tick();
  env.answerRpc(env.last("rpc"), { status: 200, body: { ok: true, code: "ABC234", token: "y".repeat(43) } });
  await pending;
  env.deliver({ scope: "arcade-multiplayer", bridgeVersion: 1, frameId, type: "transport-state", state: { nearby: false, connected: 1, status: "Connection lost" } });
  pending = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/chess/rooms/ABC234/actions", {
    method: "POST",
    headers: { authorization: "Bearer token" },
    body: JSON.stringify({ type: "move", expectedVersion: 1, uci: "e2e4" })
  });
  await tick();
  const action = env.last("rpc");
  assert.equal(action.payload.url, "/api/chess/rooms/ABC234/actions");
  env.answerRpc(action, { status: 503, body: { ok: false, error: "Nearby connection lost" } });
  assert.equal((await pending).status, 503);
  assert.equal(env.nativeFetchCalls.length, 0);
  assert.equal(env.window.ArcadeMultiplayer.getStatus().effectiveTransport, "nearby");
  env.dom.window.close();
});

test("a resumed Nearby room pins on state before a connection loss", async() => {
  const env = environment();
  const frameId = env.hello({ nearby: true, connected: 2, identity: { memberId: "m1", nickname: "Jon", avatar: "😎" } });
  let pending = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms/ABC234/state", {
    headers: { authorization: "Bearer resume-token" }
  });
  await tick();
  env.answerRpc(env.last("rpc"), { status: 200, body: { ok: true, room: { code: "ABC234", version: 4 } } });
  assert.equal((await pending).status, 200);
  assert.equal(env.window.ArcadeMultiplayer.getStatus().pinnedTransport, "nearby");

  env.deliver({ scope: "arcade-multiplayer", bridgeVersion: 1, frameId, type: "transport-state", state: { nearby: false, connected: 1, status: "Connection lost" } });
  pending = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/arcade/rooms/ABC234/actions", {
    method: "POST",
    headers: { authorization: "Bearer resume-token" },
    body: JSON.stringify({ type: "sync", expectedVersion: 4, state: { turn: 1 } })
  });
  await tick();
  env.answerRpc(env.last("rpc"), { status: 503, body: { ok: false, error: "Nearby connection lost" } });
  assert.equal((await pending).status, 503);
  assert.equal(env.nativeFetchCalls.length, 0, "a resumed room never migrated to Cloudflare");
  assert.equal(env.window.ArcadeMultiplayer.getStatus().effectiveTransport, "nearby");
  env.dom.window.close();
});

test("Nearby WebSocket traffic uses the shell virtual socket", async() => {
  const env = environment();
  env.hello({ nearby: true, connected: 2, identity: { memberId: "m1", nickname: "Jon", avatar: "😎" } });
  const create = env.window.fetch("https://arcade-chess.jonathanjablon.workers.dev/api/chess/rooms", { method: "POST", body: "{}" });
  await tick();
  env.answerRpc(env.last("rpc"), { status: 200, body: { ok: true, code: "ABC234", token: "z".repeat(43) } });
  await create;
  const socket = new env.window.WebSocket("wss://arcade-chess.jonathanjablon.workers.dev/api/chess/rooms/ABC234/ws?token=abc");
  let opened = false;
  let received = null;
  socket.addEventListener("open", () => { opened = true; });
  socket.addEventListener("message", event => { received = event.data; });
  await tick();
  const openRequest = env.last("rpc");
  assert.equal(openRequest.operation, "ws-open");
  env.answerRpc(openRequest, { ok: true });
  await tick();
  assert.equal(opened, true);
  assert.equal(socket.readyState, 1);
  env.deliver({
    scope: "arcade-multiplayer",
    bridgeVersion: 1,
    frameId: openRequest.frameId,
    type: "ws-message",
    socketId: openRequest.payload.socketId,
    data: JSON.stringify({ type: "state", room: { version: 2 } })
  });
  assert.deepEqual(JSON.parse(received), { type: "state", room: { version: 2 } });
  assert.equal(env.nativeSockets.length, 0);
  env.dom.window.close();
});

test("closing a connecting Nearby socket waits for host open before close", async() => {
  const env = environment();
  env.hello({ nearby: true, connected: 2 });
  const socket = new env.window.WebSocket("wss://arcade-chess.jonathanjablon.workers.dev/api/chess/rooms/ABC234/ws?token=abc");
  let closed = false;
  socket.addEventListener("close", () => { closed = true; });
  await tick();
  const openRequest = [...env.calls].reverse().find(call => call.message.type === "rpc" && call.message.operation === "ws-open").message;
  socket.close(1000, "Done");
  assert.equal(env.calls.some(call => call.message.type === "rpc" && call.message.operation === "ws-close"), false);
  env.answerRpc(openRequest, { ok: true });
  await tick();
  const closeRequest = [...env.calls].reverse().find(call => call.message.type === "rpc" && call.message.operation === "ws-close").message;
  assert.equal(closeRequest.payload.socketId, openRequest.payload.socketId);
  env.answerRpc(closeRequest, { ok: true });
  await tick();
  assert.equal(closed, true);
  assert.equal(socket.readyState, env.window.WebSocket.CLOSED);
  env.dom.window.close();
});

test("a room WebSocket created before hello waits for Nearby transport selection", async() => {
  const env = environment();
  const helloRequest = env.last("hello");
  const socket = new env.window.WebSocket("wss://arcade-chess.jonathanjablon.workers.dev/api/chess/rooms/ABC234/ws?token=secret");
  let opened = false;
  let received = null;
  socket.addEventListener("open", () => { opened = true; });
  socket.addEventListener("message", event => { received = event.data; });
  assert.equal(socket.readyState, env.window.WebSocket.CONNECTING);
  assert.equal(env.nativeSockets.length, 0, "the socket must not contact Cloudflare before the bridge handshake");

  env.deliver({
    scope: "arcade-multiplayer",
    bridgeVersion: 1,
    frameId: helloRequest.frameId,
    type: "hello-result",
    state: { nearby: true, connected: 2, identity: { memberId: "m1", nickname: "Jon", avatar: "😎" } }
  });
  await tick();
  const openRequest = env.last("rpc");
  assert.equal(openRequest.operation, "ws-open");
  assert.equal(env.nativeSockets.length, 0);
  env.answerRpc(openRequest, { ok: true });
  await tick();
  assert.equal(opened, true);
  assert.equal(socket.readyState, env.window.WebSocket.OPEN);

  env.deliver({
    scope: "arcade-multiplayer",
    bridgeVersion: 1,
    frameId: openRequest.frameId,
    type: "ws-message",
    socketId: openRequest.payload.socketId,
    data: JSON.stringify({ type: "state", room: { version: 1 } })
  });
  assert.deepEqual(JSON.parse(received), { type: "state", room: { version: 1 } });
  assert.equal(env.window.ArcadeMultiplayer.getStatus().effectiveTransport, "nearby");
  env.dom.window.close();
});

test("bridge messages require the exact origin and parent source", () => {
  const env = environment();
  const request = env.last("hello");
  const nearby = { scope: "arcade-multiplayer", bridgeVersion: 1, frameId: request.frameId, type: "hello-result", state: { nearby: true, connected: 2 } };
  env.deliver(nearby, { origin: "https://evil.example" });
  assert.equal(env.window.ArcadeMultiplayer.getStatus().nearby, false);
  env.deliver(nearby, { source: {} });
  assert.equal(env.window.ArcadeMultiplayer.getStatus().nearby, false);
  env.deliver(nearby);
  assert.equal(env.window.ArcadeMultiplayer.getStatus().nearby, true);
  env.dom.window.close();
});
