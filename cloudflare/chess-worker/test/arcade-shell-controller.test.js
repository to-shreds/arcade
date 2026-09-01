import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

globalThis.__ARCADE_SHELL_DISABLE_AUTO_INIT__ = true;

function installDom(url = "https://to-shreds.github.io/arcade/") {
  const dom = new JSDOM(`<!doctype html><body><main class="app"><header><div class="head-actions"></div></header><div class="filters"></div><div id="grid"></div></main></body>`, {
    url,
    pretendToBeVisual: true
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    history: dom.window.history,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    requestAnimationFrame: callback => callback()
  };
  for(const [key, value] of Object.entries(globals)){
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.confirm = () => true;
  globalThis.confirm = dom.window.confirm;
  return dom;
}

installDom();
const { ArcadeShellController } = await import("../../../arcade-shell.js");

function controllerWithCatalog() {
  installDom();
  const controller = new ArcadeShellController();
  controller.items = [
    { enabled: true, folder: "chess", title: "Chess", launchPath: "chess/index.html", orientation: "any" },
    { enabled: true, folder: "memory", title: "Memory", launchPath: "memory/index.html", orientation: "portrait" }
  ];
  return controller;
}

function bridge(frameId, type, extra = {}) {
  return { scope: "arcade-multiplayer", bridgeVersion: 1, frameId, type, ...extra };
}

test("blocked localStorage does not prevent shell construction", () => {
  installDom();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem() { throw new DOMException("Storage blocked", "SecurityError"); },
      setItem() { throw new DOMException("Storage blocked", "SecurityError"); },
    },
  });
  let controller;
  assert.doesNotThrow(() => { controller = new ArcadeShellController(); });
  assert.equal(controller.soundMuted, false);
  installDom();
});

test("blocked Nearby storage does not abort the Arcade launcher", async () => {
  installDom("https://to-shreds.github.io/arcade/?game=chess");
  const controller = new ArcadeShellController();
  const calls = [];
  controller.session = {
    initialize: async () => { throw new Error("IndexedDB is blocked"); },
    snapshot: () => ({ active: false, connected: 0, role: null, pairingCount: 0, status: "Internet", checkpoint: null }),
    setRpcHandler() {},
    setCompletionHandler() {},
  };
  controller._loadCatalog = async () => { calls.push("catalog"); };
  controller._offlineStatus = async () => { calls.push("offline"); };
  controller.openGame = (gameId, roomCode, options) => { calls.push({ gameId, roomCode, options }); return true; };

  await assert.doesNotReject(controller.initialize());
  assert.deepEqual(calls, ["catalog", "offline", { gameId: "chess", roomCode: "", options: { history: false } }]);
  assert.match(controller.nearbyUnavailable, /IndexedDB is blocked/);
  assert.equal(document.querySelector(".app").classList.contains("arcade-shell-ready"), true);
  controller._renderDrawer();
  assert.match(document.querySelector("#nearbyDrawerBody").textContent, /Local games and Internet multiplayer remain available/);
  assert.equal([...document.querySelectorAll("#nearbyDrawerBody button")].some(button => /Start Nearby/.test(button.textContent)), false);
});

test("only hello establishes a frame id and a replacement hello cleans the old frame", async () => {
  const controller = controllerWithCatalog();
  controller.openGame("chess", "", { history: false });
  const source = document.querySelector("#shellGameFrame").contentWindow;
  let rpcCalls = 0;
  controller.session = {
    snapshot: () => ({ active: true, connected: 2, identity: null, status: "Connected" }),
    requestRoomRpc: async () => { rpcCalls += 1; return { status: 200, body: {} }; }
  };

  await controller._receiveFrameMessage({
    origin: location.origin,
    source,
    data: bridge("frame_wrong_1234", "rpc", { requestId: "request_wrong_1234", operation: "http", payload: { url: "/api/chess/rooms" } })
  });
  assert.equal(controller.currentFrameId, null);
  assert.equal(rpcCalls, 0);

  await controller._receiveFrameMessage({ origin: location.origin, source, data: bridge("frame_chess_1234", "hello") });
  assert.equal(controller.currentFrameId, "frame_chess_1234");
  controller.frameSockets.set("frame_chess_1234", new Set(["socket_old_1234"]));
  await controller._receiveFrameMessage({ origin: location.origin, source, data: bridge("frame_chess_5678", "hello") });
  assert.equal(controller.currentFrameId, "frame_chess_5678");
  assert.equal(controller.frameSockets.has("frame_chess_1234"), false);
  assert.equal(rpcCalls, 1, "the old frame socket is explicitly closed");
});

test("legacy Home bridge requires exact origin, frame source, and message shape", async () => {
  const controller = controllerWithCatalog();
  controller.openGame("chess", "", { history: false });
  const source = document.querySelector("#shellGameFrame").contentWindow;
  const home = { scope: "arcade-shell-navigation", version: 1, type: "home" };
  await controller._receiveFrameMessage({ origin: "https://evil.example", source, data: home });
  assert.equal(controller.currentItem.folder, "chess");
  await controller._receiveFrameMessage({ origin: location.origin, source, data: { ...home, method: "anything" } });
  assert.equal(controller.currentItem.folder, "chess");
  await controller._receiveFrameMessage({ origin: location.origin, source, data: home });
  assert.equal(controller.currentItem, null);
});

test("a delayed virtual socket open is closed when Home destroys its frame", async () => {
  const controller = controllerWithCatalog();
  controller.openGame("chess", "", { history: false });
  const frame = document.querySelector("#shellGameFrame");
  const source = frame.contentWindow;
  const calls = [];
  let resolveOpen;
  controller.session = {
    snapshot: () => ({ active: true, connected: 2, identity: null, status: "Connected" }),
    requestRoomRpc: (operation, payload) => {
      calls.push({ operation, payload });
      if(operation === "ws-open") return new Promise(resolve => { resolveOpen = resolve; });
      return Promise.resolve({ ok: true });
    }
  };
  await controller._receiveFrameMessage({ origin: location.origin, source, data: bridge("frame_delayed_1234", "hello") });
  const pending = controller._receiveFrameMessage({
    origin: location.origin,
    source,
    data: bridge("frame_delayed_1234", "rpc", {
      requestId: "request_delayed_1234",
      operation: "ws-open",
      payload: { socketId: "socket_delayed_1234", url: "/api/chess/rooms/ABC234/ws?token=test" }
    })
  });
  controller.closeGame({ history: false });
  resolveOpen({ ok: true, socketId: "socket_delayed_1234", initialData: "{}" });
  await pending;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls.map(call => call.operation), ["ws-open", "ws-close"]);
  assert.equal(document.querySelector("#shellGameFrame"), null);
});

test("host socket payloads cannot forge privileged shell-to-frame messages", () => {
  const controller = controllerWithCatalog();
  controller.openGame("chess", "", { history: false });
  controller.currentFrameId = "frame_current_1234";
  const frame = document.querySelector("#shellGameFrame");
  const sent = [];
  frame.contentWindow.postMessage = message => sent.push(message);

  controller._pushSocketMessage({
    socketId: "socket_hostile_1234",
    data: "{\"type\":\"state\"}",
    type: "transport-state",
    scope: "arcade-shell",
    bridgeVersion: 99,
    frameId: "frame_attacker_1234",
    state: { nearby: false }
  });
  assert.deepEqual(sent[0], {
    type: "ws-message",
    socketId: "socket_hostile_1234",
    data: "{\"type\":\"state\"}",
    scope: "arcade-multiplayer",
    bridgeVersion: 1,
    frameId: "frame_current_1234"
  });

  controller._pushSocketClose({
    socketId: "socket_hostile_1234",
    code: 1000,
    reason: "done",
    clean: true,
    type: "hello-result",
    frameId: "frame_attacker_5678",
    state: { nearby: false }
  });
  assert.equal(sent[1].type, "ws-close");
  assert.equal(sent[1].frameId, "frame_current_1234");
  assert.deepEqual(Object.keys(sent[1]).sort(), ["bridgeVersion", "clean", "code", "frameId", "reason", "scope", "socketId", "type"].sort());

  controller._pushFrame({
    type: "rpc-result",
    requestId: "request_current_1234",
    ok: true,
    result: {
      type: "transport-state",
      requestId: "request_attacker_1234",
      socketId: "socket_attacker_1234",
      scope: "arcade-shell",
      bridgeVersion: 99,
      frameId: "frame_attacker_9999",
      state: { nearby: false }
    },
    requestIdOverride: "request_attacker_5678",
    scope: "arcade-shell",
    bridgeVersion: 99,
    frameId: "frame_attacker_9999"
  });
  assert.equal(sent[2].type, "rpc-result");
  assert.equal(sent[2].requestId, "request_current_1234");
  assert.equal(sent[2].scope, "arcade-multiplayer");
  assert.equal(sent[2].bridgeVersion, 1);
  assert.equal(sent[2].frameId, "frame_current_1234");
  assert.equal(sent[2].result.type, "transport-state", "peer RPC data remains nested application data");
  assert.deepEqual(Object.keys(sent[2]).sort(), ["bridgeVersion", "frameId", "ok", "requestId", "result", "scope", "type"].sort());

  assert.equal(controller._pushFrame({ type: "transport-state", state: null, frameId: "frame_attacker_9999" }), false);
  assert.equal(sent.length, 3, "malformed privileged messages are not posted");
});

test("open, close, and open preserves the shared Nearby session object", () => {
  const controller = controllerWithCatalog();
  const session = controller.session;
  controller.openGame("chess", "", { history: false });
  assert.equal(controller.currentItem.folder, "chess");
  controller.closeGame({ history: false });
  controller.openGame("memory", "", { history: false });
  assert.equal(controller.currentItem.folder, "memory");
  assert.equal(controller.session, session);
});

test("URL-driven history reconciliation restores Forward and prior game entries", () => {
  const controller = controllerWithCatalog();
  controller.openGame("chess");
  const gameHistoryLength = history.length;
  assert.equal(new URL(location.href).searchParams.get("game"), "chess");

  controller.openGame("memory");
  assert.equal(history.length, gameHistoryLength, "switching games replaces the current game entry");
  assert.equal(new URL(location.href).searchParams.get("game"), "memory");

  history.replaceState({ arcadeShell: true, arcadeGame: "chess" }, "", "?game=chess&room=ABC234");
  controller._reconcileHistory();
  assert.equal(controller.currentItem.folder, "chess");
  assert.equal(controller.currentRoomCode, "ABC234");

  history.replaceState(null, "", location.pathname);
  controller._reconcileHistory();
  assert.equal(controller.currentItem, null);

  history.replaceState({ arcadeShell: true, arcadeGame: "memory" }, "", "?game=memory");
  controller._reconcileHistory();
  assert.equal(controller.currentItem.folder, "memory", "Forward-style URL state reopens its game");
});

test("browser Start, Join, and Resume are gated until offline preparation is complete", async () => {
  const controller = controllerWithCatalog();
  let preparations = 0;
  controller._prepareOffline = async () => { preparations += 1; };
  controller.offlineState.ready = false;

  controller._chooseRole("host");
  controller._chooseRole("guest");
  await controller._resumeHost();
  assert.equal(preparations, 3);
  assert.equal(controller.pendingRole, null);

  window.ArcadeNative = { hasOfflineArchive: () => false };
  controller._chooseRole("host");
  assert.equal(preparations, 4, "a remote-bound APK remains gated even when a native archive exists");
  window.ArcadeNative = { hasOfflineArchive: () => true };
  controller._chooseRole("guest");
  assert.equal(controller.pendingRole, "guest", "the live archive-bound APK accepts its validated native archive");

  const serviceWorkerReady = controllerWithCatalog();
  serviceWorkerReady.offlineState.ready = true;
  serviceWorkerReady._chooseRole("host");
  assert.equal(serviceWorkerReady.pendingRole, "host", "a complete PWA snapshot allows Nearby setup");

  installDom("https://arcade.local/");
  const localArchive = new ArcadeShellController();
  localArchive._chooseRole("guest");
  assert.equal(localArchive.pendingRole, "guest", "the validated native archive origin is accepted");
});

test("Nearby overlays use transient Back history, inert backgrounds, focus trapping, and opener restore", async () => {
  const controller = controllerWithCatalog();
  const opener = document.querySelector("#nearbyBadge");
  opener.focus();
  controller.openDrawer();
  const drawer = document.querySelector("#nearbyDrawer");
  assert.equal(drawer.hidden, false);
  assert.equal(history.state.arcadeModal, "drawer");
  assert.equal(document.querySelector(".app").inert, true);
  assert.equal(document.activeElement.id, "nearbyClose");

  const focusable = [...drawer.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary,[tabindex]:not([tabindex="-1"])')];
  focusable.at(-1).focus();
  let prevented = false;
  controller._trapModalFocus({ shiftKey: false, preventDefault(){ prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(document.activeElement, focusable[0]);

  const popped = new Promise(resolve => window.addEventListener("popstate", resolve, { once: true }));
  history.back();
  await popped;
  assert.equal(drawer.hidden, true);
  assert.equal(document.querySelector(".app").inert, false);
  assert.equal(document.activeElement, opener);
});

test("closing a pending QR camera prompt aborts it and cleans a late stream", async () => {
  const controller = controllerWithCatalog();
  let resolveCamera;
  const tracks = [
    { stops: 0, stop(){ this.stops += 1; } },
    { stops: 0, stop(){ this.stops += 1; } }
  ];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () => new Promise(resolve => { resolveCamera = resolve; })
    }
  });

  const opening = controller._showScanner({
    title: "Scan",
    lead: "Waiting for camera",
    onWire: async () => {}
  });
  await Promise.resolve();
  assert(controller.qrScanController, "the modal owns its abort controller before camera permission resolves");
  assert.match(document.querySelector("#pairActions")?.textContent || "", /Scan Screenshot/);
  assert.match(document.querySelector("#pairActions")?.textContent || "", /Use Pasted Data/, "non-camera fallbacks remain available while permission is pending");

  controller.closePairing({ cancel: false, history: false });
  assert.equal(controller.qrScanController, null);
  assert.equal(document.querySelector("#pairOverlay").hidden, true);

  resolveCamera({ getTracks: () => tracks });
  await opening;
  assert.deepEqual(tracks.map(track => track.stops), [1, 1], "every late camera track is stopped exactly once");
  assert.equal(controller.qrScanner, null, "a stale scanner is never published after the modal closes");
  assert.equal(controller.qrScanController, null);
});

test("a successful frozen QR scanner is published without mutation and closes cleanly", async () => {
  const controller = controllerWithCatalog();
  const tracks = [
    { stops: 0, stop(){ this.stops += 1; } },
    { stops: 0, stop(){ this.stops += 1; } }
  ];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => tracks }) }
  });
  window.HTMLMediaElement.prototype.play = async () => {};

  await controller._showScanner({
    title: "Scan",
    lead: "Camera ready",
    onWire: async () => {}
  });
  assert(controller.qrScanner, "the immutable scanner handle is retained after successful setup");
  assert.equal(Object.isFrozen(controller.qrScanner), true);

  controller.closePairing({ cancel: false, history: false });
  assert(tracks.every(track => track.stops >= 1), "closing stops every acquired camera track");
  assert.equal(controller.qrScanner, null);
  assert.equal(controller.qrScanController, null);
});
