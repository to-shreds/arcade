import { AVATARS, REACTIONS, byteLength, offlineRuntimeReady, safeGameInvitation, sillyName, surpriseGame, validateFrameMessage } from "./multiplayer/arcade-shell-core.mjs";
import { createNearbyStorage } from "./multiplayer/nearby-storage.mjs";
import { NearbyArcadeSession } from "./multiplayer/nearby-session.mjs";
import { NearbyRoomService } from "./multiplayer/nearby-room-service.js";
import * as protocol from "./multiplayer/protocol.mjs";
import * as signaling from "./multiplayer/signaling.mjs";
import * as webrtc from "./multiplayer/webrtc.mjs";
import { QrFrameCollector } from "./multiplayer/signaling.mjs";
import { decodeQrSource, renderQrToCanvas, startAnimatedQrDisplay, startQrCameraScanner } from "./multiplayer/qr.mjs";

const BRIDGE_MAX_BYTES = 112 * 1024;
const FRAME_ALLOW = "autoplay; camera; clipboard-read; clipboard-write; fullscreen; screen-wake-lock";
const MICROPHONE_GAME = "music-maker";
const MULTIPLAYER_GAMES = new Set(["chess", "sorry", "monopoly", "memory", "tic-tac-toe", "dots", "checkers", "chat-room"]);
const $ = (selector, root = document) => root.querySelector(selector);

function safeMessage(error, fallback = "Nearby Arcade could not complete that step."){
  return String(error?.message || fallback).replace(/[<>]/g, "").slice(0, 180) || fallback;
}

function roomKindFromUrl(value){ return /^\/api\/chess\//.test(String(value || "")) ? "chess" : "arcade"; }

export class ArcadeShellController {
  constructor(){
    this.app = $(".app");
    this.grid = $("#grid");
    this.items = [];
    this.currentItem = null;
    this.currentRoomCode = "";
    this.currentFrameId = null;
    this.launcher = null;
    this.frameClosing = false;
    this.drawerMode = "home";
    this.drawerOpener = null;
    this.pairOpener = null;
    this.settingsOpener = null;
    this.pendingRole = null;
    this.pendingPairing = null;
    this.qrDisplay = null;
    this.qrDisplayController = null;
    this.qrScanner = null;
    this.qrScanController = null;
    this.wakeLock = null;
    this.roomService = null;
    this.roomServiceReady = null;
    this.frameSockets = new Map();
    this.memberPresence = new Map();
    this.checkpointTimer = 0;
    this.checkpointChain = Promise.resolve();
    try{ this.soundMuted = localStorage.getItem("arcade.nearby.sound") === "0"; }
    catch(_error){ this.soundMuted = false; }
    this.offlineState = { ready: false, updating: false, progress: null };
    this.nearbyUnavailable = "";
    this.session = new NearbyArcadeSession({ storage: createNearbyStorage() });
    this.session.configureSignaling({ ...protocol, ...signaling, ...webrtc });
    this.session.setCheckpointProvider(() => this.roomService ? this.roomService.exportCheckpoint() : this.session.checkpoint?.roomService || null);
    this._buildUi();
    this.app?.classList.add("arcade-shell-ready");
    this._wireUi();
    this._wireSession();
    this._wireBridge();
  }

  async initialize(){
    window.ArcadeShell = Object.freeze({
      openGame: (gameId, roomCode) => this.openGame(gameId, roomCode),
      closeGame: () => this.closeGame({ history: true }),
      goHome: () => this.goHome(),
      handleNativeBack: () => this.handleNativeBack(),
      refresh: () => this.refresh(),
      openSettings: () => this.openSettings(),
      getNearbyState: () => this.session.snapshot()
    });
    try{
      await this.session.initialize();
    }catch(error){
      // Nearby persistence is optional to the launcher. Browsers can block or
      // fail IndexedDB (privacy policy, corrupt storage, private mode); keep
      // the catalog, direct games, local modes and Cloudflare multiplayer
      // usable while disabling only Nearby Arcade for this page load.
      this.nearbyUnavailable = safeMessage(error, "Nearby Arcade storage is unavailable in this browser.");
      this.toast(`${this.nearbyUnavailable} Regular Arcade games still work.`);
    }
    await this._loadCatalog();
    await this._offlineStatus();
    this._renderSession(this.session.snapshot());
    const initialGame = new URL(location.href).searchParams.get("game");
    if(initialGame) this.openGame(initialGame, new URL(location.href).searchParams.get("room") || "", { history: false });
    this.app?.classList.add("arcade-shell-ready");
  }

  async _loadCatalog(){
    try{
      const source = location.hostname === "arcade.local" ? "/__catalog.json" : "catalog.json";
      const response = await fetch(source, { cache: "no-store" });
      if(!response.ok) throw new Error("Catalog unavailable");
      const data = await response.json();
      this.items = (data.items || []).filter(item => item?.enabled === true && !item.warning);
    }catch(_error){
      this.items = Array.isArray(window.ArcadeCatalogItems) ? window.ArcadeCatalogItems : [];
    }
  }

  async refresh(){
    const tasks = [this._loadCatalog(), this._offlineStatus()];
    if(!this.session.snapshot().active){
      tasks.push(navigator.serviceWorker?.getRegistration?.().then(registration => registration?.update?.()).catch(() => null));
    }
    await Promise.all(tasks);
    this._renderSession(this.session.snapshot());
    this.toast("Arcade library refreshed.");
    return true;
  }

  _buildUi(){
    const badge = document.createElement("button");
    badge.id = "nearbyBadge";
    badge.className = "shell-badge";
    badge.type = "button";
    badge.setAttribute("aria-label", "Open Nearby Arcade");
    badge.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="wide">Nearby</span><span id="nearbyBadgeCount"></span>';
    $(".head-actions")?.prepend(badge);

    const offline = document.createElement("button");
    offline.id = "offlineBadge";
    offline.className = "shell-badge";
    offline.type = "button";
    offline.setAttribute("aria-label", "Offline availability");
    offline.innerHTML = '<span class="dot" aria-hidden="true"></span><span id="offlineBadgeText" class="wide">Offline</span>';
    $(".head-actions")?.prepend(offline);

    const callout = document.createElement("aside");
    callout.id = "nearbyCallout";
    callout.className = "nearby-callout";
    callout.setAttribute("aria-label", "Nearby Arcade connection");
    callout.innerHTML = '<div class="mascot" id="nearbyCalloutMascot">📡</div><div><h2 id="nearbyCalloutTitle">NEARBY ARCADE</h2><p id="nearbyCalloutText">Play together without Internet</p></div><button id="nearbyCalloutBtn" type="button">Connect Devices</button>';
    $(".filters")?.before(callout);

    const gameLayer = document.createElement("section");
    gameLayer.id = "shellGameLayer";
    gameLayer.className = "shell-game-layer";
    gameLayer.hidden = true;
    gameLayer.setAttribute("aria-label", "Arcade game");
    gameLayer.innerHTML = '<div class="shell-game-loading" id="shellGameLoading">Opening game…</div>';
    document.body.append(gameLayer);

    const drawer = document.createElement("div");
    drawer.id = "nearbyDrawer";
    drawer.className = "shell-overlay nearby-drawer";
    drawer.hidden = true;
    drawer.innerHTML = '<section class="nearby-panel" role="dialog" aria-modal="true" aria-labelledby="nearbyDrawerTitle"><button class="shell-close" id="nearbyClose" type="button" aria-label="Close Nearby Arcade">✕</button><div id="nearbyDrawerBody"></div></section>';
    document.body.append(drawer);

    const pair = document.createElement("div");
    pair.id = "pairOverlay";
    pair.className = "shell-overlay";
    pair.hidden = true;
    pair.innerHTML = '<section class="nearby-panel compact pair-panel" role="dialog" aria-modal="true" aria-labelledby="pairTitle"><button class="shell-close" id="pairClose" type="button" aria-label="Cancel pairing">✕</button><h2 id="pairTitle">Connect Devices</h2><p class="nearby-lead" id="pairLead"></p><div id="pairBody"></div><div class="pair-actions" id="pairActions"></div><div class="pair-help">Make sure both devices are on the same Wi-Fi or phone hotspot. Internet isn\'t needed.</div><details style="margin-top:8px;text-align:left"><summary>Pairing details</summary><p class="nearby-lead" id="pairDiagnostics">WebRTC uses local network candidates only. No STUN or TURN server is contacted.</p></details></section>';
    document.body.append(pair);

    const settings = document.createElement("div");
    settings.id = "arcadeSettingsOverlay";
    settings.className = "shell-overlay";
    settings.hidden = true;
    settings.innerHTML = '<section class="nearby-panel compact" role="dialog" aria-modal="true" aria-labelledby="arcadeSettingsTitle"><button class="shell-close" id="arcadeSettingsClose" type="button" aria-label="Close Arcade settings">✕</button><h2 id="arcadeSettingsTitle">Arcade Settings</h2><p class="arcade-settings-copy">Multiplayer games ding when your turn begins. Desktop notifications can also let you know when Arcade is in the background.</p><div class="arcade-settings-list"><div class="arcade-setting"><div><strong>Turn sound</strong><small id="turnSoundHelp">Plays on phones, tablets, the APK, and computers.</small></div><button id="turnSoundSetting" type="button" aria-describedby="turnSoundHelp"></button></div><div class="arcade-setting"><div><strong id="turnNotificationLabel">Desktop notifications</strong><small id="turnNotificationHelp">Shows a notification only while Arcade is hidden or unfocused.</small></div><button id="turnNotificationSetting" type="button" aria-describedby="turnNotificationHelp"></button></div></div><div class="arcade-settings-actions"><button id="arcadeManageLibrary" type="button" hidden>Manage Games</button><button id="arcadeSettingsDone" class="shell-primary" type="button">Done</button></div></section>';
    document.body.append(settings);

    const toastStack = document.createElement("div");
    toastStack.id = "shellToastStack";
    toastStack.className = "shell-toast-stack";
    toastStack.setAttribute("aria-live", "polite");
    document.body.append(toastStack);
  }

  _wireUi(){
    $("#nearbyBadge")?.addEventListener("click", () => this.openDrawer());
    $("#nearbyCalloutBtn")?.addEventListener("click", () => this.openDrawer());
    $("#nearbyCallout")?.addEventListener("click", event => { if(!event.target.closest("button")) this.openDrawer(); });
    $("#offlineBadge")?.addEventListener("click", () => this._prepareOffline());
    $("#nearbyClose")?.addEventListener("click", () => this.closeDrawer());
    $("#nearbyDrawer")?.addEventListener("click", event => { if(event.target.id === "nearbyDrawer") this.closeDrawer(); });
    $("#pairClose")?.addEventListener("click", () => this.closePairing());
    $("#arcadeSettingsClose")?.addEventListener("click", () => this.closeSettings());
    $("#arcadeSettingsDone")?.addEventListener("click", () => this.closeSettings());
    $("#arcadeSettingsOverlay")?.addEventListener("click", event => { if(event.target.id === "arcadeSettingsOverlay") this.closeSettings(); });
    $("#turnSoundSetting")?.addEventListener("click", () => {
      const alerts = window.ArcadeMultiplayer;
      const settings = alerts?.getTurnAlertSettings?.();
      alerts?.setTurnSoundEnabled?.(settings?.soundEnabled === false);
      this._renderSettings();
    });
    $("#turnNotificationSetting")?.addEventListener("click", async () => {
      const alerts = window.ArcadeMultiplayer;
      const settings = alerts?.getTurnAlertSettings?.();
      if(!alerts || !settings?.notificationsSupported || settings.notificationPermission === "denied") return;
      if(settings.notificationsEnabled) alerts.setTurnNotificationsEnabled(false);
      else await alerts.requestTurnNotifications();
      this._renderSettings();
    });
    $("#arcadeManageLibrary")?.addEventListener("click", () => window.ArcadeNative?.openManager?.());
    window.addEventListener("popstate", () => this._reconcileHistory());
    window.addEventListener("keydown", event => {
      if(event.key === "Tab" && this._trapModalFocus(event)) return;
      if(event.key !== "Escape") return;
      if(!$("#arcadeSettingsOverlay").hidden) this.closeSettings();
      else if(!$("#pairOverlay").hidden) this.closePairing();
      else if(!$("#nearbyDrawer").hidden) this.closeDrawer();
    });
    document.addEventListener("visibilitychange", () => {
      if(!document.hidden && this.session.snapshot().role === "host") this._acquireWakeLock();
      if(!$("#arcadeSettingsOverlay")?.hidden) this._renderSettings();
    });
    window.addEventListener("arcadeturnalertsettings", () => this._renderSettings());
    window.addEventListener("beforeunload", event => {
      if(!this.session.snapshot().active) return;
      event.preventDefault();
      event.returnValue = "Leaving this page will disconnect Nearby Arcade.";
    });
    navigator.serviceWorker?.addEventListener("message", event => {
      if(event.data?.type === "ARCADE_OFFLINE_PROGRESS" || event.data?.type === "ARCADE_OFFLINE_STATUS"){
        this.offlineState = { ...this.offlineState, ...event.data };
        this._renderOffline();
      }
    });
    navigator.serviceWorker?.addEventListener("controllerchange", () => {
      const nearby = this.session.snapshot().active;
      this._setNetworkMode(nearby ? "nearby" : "online");
      if(!nearby){
        this._swRequest("ARCADE_PREPARE_OFFLINE", {}, 10000).then(() => this._pollOfflineStatus(0)).catch(() => null);
      }
    });
  }

  _wireSession(){
    this.session.on("state", state => {
      this._renderSession(state);
      this._sendTransportState();
      this._setNetworkMode(state.active ? "nearby" : "online");
      if(state.role === "host"){
        this._ensureRoomService(state);
        this._acquireWakeLock();
      }else this._releaseWakeLock();
    });
    this.session.on("player-joined", async member => {
      if(this.roomService){
        await this._syncRoomMembers().catch(() => null);
        await this.roomService.closeMemberSockets(member.memberId, "Player reconnected").catch(() => null);
      }
      this.toast(`${member.avatar} ${member.nickname} joined!`);
      this._playJoinFeedback();
      this.pendingPairing = null;
      this.closePairing({ cancel: false });
    });
    this.session.on("connected", () => { this.toast("Connected to Nearby Arcade!"); this.pendingPairing = null; this.closePairing({ cancel: false }); });
    this.session.on("reaction", value => this._showReaction(value));
    this.session.on("invitation", value => this._showInvitation(value));
    this.session.on("star", value => this.toast(`${value.member.avatar} ${value.member.nickname} earned an Arcade Star! ★`));
    this.session.on("socket-message", value => this._pushSocketMessage(value));
    this.session.on("socket-close", value => this._pushSocketClose(value));
    this.session.on("error", value => this.toast(value.message || "Nearby Arcade had a problem."));
    this.session.on("recovery-required", value => this.toast(value.message || "Reconnect to Nearby Arcade."));
    this.session.on("removed", value => this.toast(value.reason));
    this.session.on("ended", value => this.toast(value.reason || "Nearby Arcade ended."));
  }

  _wireBridge(){ window.addEventListener("message", event => this._receiveFrameMessage(event)); }

  async _receiveFrameMessage(event){
    const frame = $("#shellGameFrame");
    const navigation = event?.data;
    if(event?.origin === location.origin && event?.source === frame?.contentWindow && navigation?.scope === "arcade-shell-navigation" && navigation?.version === 1 && navigation?.type === "home" && Object.keys(navigation).every(key => ["scope", "version", "type"].includes(key))){
      this.closeGame({ history: true });
      return;
    }
    const message = validateFrameMessage(event, { origin: location.origin, source: frame?.contentWindow, maxBytes: BRIDGE_MAX_BYTES });
    if(!message) return;
    if(message.type === "hello"){
      if(this.currentFrameId && this.currentFrameId !== message.frameId) this._closeFrameSockets(this.currentFrameId);
      this.currentFrameId = message.frameId;
      this._pushFrame({ type: "hello-result", state: this._bridgeState() });
      return;
    }
    if(!this.currentFrameId || this.currentFrameId !== message.frameId) return;
    if(message.type === "home"){ this.closeGame({ history: true }); return; }
    if(message.type === "open-game"){ this.openGame(message.gameId, message.roomCode); return; }
    if(message.type === "invite"){
      const invitation = safeGameInvitation(message, this.items);
      if(invitation && this.session.snapshot().active) this.session.announceInvitation(invitation);
      return;
    }
    if(message.type === "game-completed"){
      if(this.session.snapshot().active) this.session.reportGameCompleted(message.details);
      return;
    }
    if(message.type === "turn-alert"){
      if(message.gameId === this.currentItem?.folder) window.ArcadeMultiplayer?.deliverTurnAlert?.(message, { sound: false });
      return;
    }
    if(message.type !== "rpc") return;
    const requestFrameId = message.frameId;
    const requestSource = event.source;
    try{
      if(!this.session.snapshot().active) throw Object.assign(new Error("Nearby Arcade is not connected."), { status: 503 });
      const result = await this.session.requestRoomRpc(message.operation, message.payload);
      const socketId = String(message.payload?.socketId || result?.socketId || "");
      const frameStillCurrent = this.currentFrameId === requestFrameId && $("#shellGameFrame")?.contentWindow === requestSource;
      if(!frameStillCurrent){
        if(message.operation === "ws-open" && socketId) this.session.requestRoomRpc("ws-close", { socketId }).catch(() => null);
        return;
      }
      this._pushFrame({ type: "rpc-result", requestId: message.requestId, ok: true, result });
      if(message.operation === "ws-open" && socketId){
        if(!this.frameSockets.has(message.frameId)) this.frameSockets.set(message.frameId, new Set());
        this.frameSockets.get(message.frameId).add(socketId);
      }else if(message.operation === "ws-close" && socketId){
        this.frameSockets.get(message.frameId)?.delete(socketId);
      }
      if(message.operation === "ws-open" && result?.initialData){
        setTimeout(() => this._pushFrame({ type: "ws-message", socketId: message.payload?.socketId, data: result.initialData }), 0);
      }
    }catch(error){
      if(this.currentFrameId === requestFrameId && $("#shellGameFrame")?.contentWindow === requestSource){
        this._pushFrame({ type: "rpc-result", requestId: message.requestId, ok: false, status: Number(error?.status) || 500, error: safeMessage(error) });
      }
    }
  }

  _bridgeState(){
    const state = this.session.snapshot();
    return {
      nearby: state.active,
      connected: state.connected,
      identity: state.identity ? { ...state.identity, browserId: "" } : null,
      status: state.active ? `${state.status}${state.connected ? ` · ${state.connected} connected` : ""}` : "Internet"
    };
  }

  _safeBridgeState(value){
    if(!value || typeof value !== "object" || Array.isArray(value)) return null;
    const identity = value.identity && typeof value.identity === "object" && !Array.isArray(value.identity) ? {
      memberId: String(value.identity.memberId || "").slice(0, 100),
      browserId: "",
      nickname: String(value.identity.nickname || "").replace(/[<>]/g, "").slice(0, 24),
      avatar: String(value.identity.avatar || "").replace(/[<>]/g, "").slice(0, 8),
      color: /^#[0-9a-f]{6}$/i.test(String(value.identity.color || "")) ? String(value.identity.color) : "#21dcff",
      host: value.identity.host === true
    } : null;
    return {
      nearby: value.nearby === true,
      connected: Math.max(0, Math.min(8, Math.floor(Number(value.connected) || 0))),
      identity,
      status: String(value.status || (value.nearby ? "Nearby Arcade" : "Internet")).replace(/[<>]/g, "").slice(0, 80)
    };
  }

  _shapeFrameMessage(message){
    if(!message || typeof message !== "object" || Array.isArray(message)) return null;
    const type = String(message.type || "");
    if(type === "hello-result" || type === "transport-state"){
      const state = this._safeBridgeState(message.state);
      return state ? { type, state } : null;
    }
    if(type === "rpc-result"){
      const requestId = String(message.requestId || "");
      if(!/^[A-Za-z0-9:_-]{8,180}$/.test(requestId) || typeof message.ok !== "boolean") return null;
      return message.ok
        ? { type, requestId, ok: true, result: message.result }
        : { type, requestId, ok: false, status: Math.max(400, Math.min(599, Math.floor(Number(message.status) || 500))), error: safeMessage({ message: message.error }) };
    }
    if(type === "ws-message"){
      const socketId = String(message.socketId || "");
      if(!/^[A-Za-z0-9_-]{8,120}$/.test(socketId) || typeof message.data !== "string") return null;
      return { type, socketId, data: message.data };
    }
    if(type === "ws-close"){
      const socketId = String(message.socketId || "");
      const code = Math.floor(Number(message.code) || 1000);
      if(!/^[A-Za-z0-9_-]{8,120}$/.test(socketId) || code < 1000 || code > 4999) return null;
      return { type, socketId, code, reason: String(message.reason || "").replace(/[<>]/g, "").slice(0, 120), clean: message.clean !== false };
    }
    if(type === "invitation"){
      const invitation = safeGameInvitation(message.invitation, this.items);
      return invitation ? { type, invitation } : null;
    }
    return null;
  }

  _pushSocketMessage(value){
    if(!value || typeof value !== "object" || Array.isArray(value)) return false;
    return this._pushFrame({ socketId: value.socketId, data: value.data, type: "ws-message" });
  }

  _pushSocketClose(value){
    if(!value || typeof value !== "object" || Array.isArray(value)) return false;
    return this._pushFrame({ socketId: value.socketId, code: value.code, reason: value.reason, clean: value.clean, type: "ws-close" });
  }

  _pushFrame(message){
    const frame = $("#shellGameFrame");
    if(!frame?.contentWindow || !this.currentFrameId) return false;
    const shaped = this._shapeFrameMessage(message);
    if(!shaped) return false;
    // Fixed envelope fields are written last so neither a peer-controlled room
    // payload nor a future caller can turn a socket event into a privileged
    // transport/handshake/RPC message.
    const envelope = { ...shaped, scope: "arcade-multiplayer", bridgeVersion: 1, frameId: this.currentFrameId };
    if(byteLength(envelope) > BRIDGE_MAX_BYTES) return false;
    try{
      frame.contentWindow.postMessage(envelope, location.origin);
      return true;
    }catch(_error){ return false; }
  }

  _sendTransportState(){ this._pushFrame({ type: "transport-state", state: this._bridgeState() }); }

  async _ensureRoomService(state){
    if(state.role !== "host" || this.roomServiceReady) return this.roomServiceReady;
    this.roomServiceReady = (async() => {
      const service = new NearbyRoomService({ onEvent: event => this._roomEvent(event) });
      const saved = this.session.checkpoint?.roomService;
      if(saved){
        try{ await service.importCheckpoint(saved); }catch(error){ this.toast("Saved Nearby games could not be restored. The player session is still ready."); }
      }
      for(const member of state.members){
        await service.registerMember({ ...member, connected: member.presence === "connected" });
        await service.setMemberPresence(member.memberId, member.presence === "connected");
      }
      this.roomService = service;
      this.session.setRpcHandler(request => this._roomRpc(request));
      this.session.setCompletionHandler(request => this._verifyReportedCompletion(request));
      await this.session.checkpointNow();
      return service;
    })().catch(error => {
      this.roomServiceReady = null;
      this.toast(safeMessage(error, "Nearby game rooms could not start."));
      throw error;
    });
    return this.roomServiceReady;
  }

  async _syncRoomMembers(){
    if(!this.roomService || this.session.snapshot().role !== "host") return;
    for(const member of this.session.snapshot().members){
      try{
        await this.roomService.registerMember({ ...member, connected: member.presence === "connected" });
        await this.roomService.setMemberPresence(member.memberId, member.presence === "connected");
        const previous = this.memberPresence.get(member.memberId);
        if(member.presence !== "connected" && previous === "connected" && typeof this.roomService.closeMemberSockets === "function"){
          await this.roomService.closeMemberSockets(member.memberId, "Nearby connection lost");
        }
        this.memberPresence.set(member.memberId, member.presence);
      }catch(error){ this.toast(safeMessage(error)); }
    }
  }

  async _roomRpc({ member, operation, payload }){
    await this._ensureRoomService(this.session.snapshot());
    await this._syncRoomMembers();
    let result;
    if(operation === "http") result = await this.roomService.handleHttp(member.memberId, payload);
    else if(operation === "ws-open") result = await this.roomService.openSocket(member.memberId, payload);
    else if(operation === "ws-send") result = await this.roomService.sendSocket(member.memberId, payload);
    else if(operation === "ws-close") result = await this.roomService.closeSocket(member.memberId, payload);
    else throw Object.assign(new Error("Nearby room operation is not supported."), { status: 400 });
    this._queueCheckpoint();
    return result;
  }

  _roomEvent(event){
    if(!event || typeof event !== "object") return;
    if(event.type === "socket-message") this.session.sendSocketMessage(event.targetMemberId, event.socketId, event.data);
    else if(event.type === "socket-close") this.session.closeSocket(event.targetMemberId, event.socketId, event);
    else if(event.type === "completion" && event.completion?.verifiedRules === true) this.session.acceptCanonicalCompletion(event.completion);
    if(event.type === "completion" || event.type === "socket-close") this._queueCheckpoint();
  }

  _queueCheckpoint(){
    if(this.checkpointTimer) clearTimeout(this.checkpointTimer);
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = 0;
      this.checkpointChain = this.checkpointChain.then(() => this.session.checkpointNow()).catch(() => null);
    }, 180);
  }

  async _verifyReportedCompletion({ details }){
    if(!this.roomService || !details?.roomCode) return null;
    const kind = details.gameId === "chess" ? "chess" : "arcade";
    const completion = await this.roomService.completionFor(kind, details.roomCode).catch(() => null);
    if(!completion || completion.verifiedRules !== true || Number(completion.version) !== Number(details.version)) return null;
    return completion;
  }

  _item(value){
    const id = typeof value === "string" ? value : value?.folder;
    return this.items.find(item => item?.enabled === true && item.folder === id) || null;
  }

  openGame(value, roomCode = "", options = {}){
    const item = this._item(value);
    if(!item){ this.toast("That game is not available in this Arcade."); return false; }
    const requestedCode = String(roomCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if(this.currentItem?.folder === item.folder && $("#shellGameFrame") && (requestedCode.length < 4 || requestedCode === this.currentRoomCode)) return true;
    const replacingGame = !!this.currentItem;
    if(this.currentItem) this.closeGame({ history: false });
    this.launcher = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.currentItem = item;
    this.currentRoomCode = requestedCode.length >= 4 ? requestedCode : "";
    this.currentFrameId = null;
    this.frameClosing = false;
    const layer = $("#shellGameLayer");
    const loading = $("#shellGameLoading");
    layer.querySelector("#shellGameFrame")?.remove();
    loading.hidden = false;
    const frame = document.createElement("iframe");
    frame.id = "shellGameFrame";
    frame.className = "shell-game-frame";
    frame.title = item.title || "Arcade game";
    frame.allow = item.folder === MICROPHONE_GAME ? `${FRAME_ALLOW}; microphone` : FRAME_ALLOW;
    frame.allowFullscreen = true;
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms allow-modals allow-downloads allow-popups allow-presentation allow-orientation-lock");
    frame.referrerPolicy = "same-origin";
    const launchUrl = new URL(item.launchPath, location.href);
    const code = requestedCode;
    if(code.length >= 4) launchUrl.searchParams.set("room", code);
    if(this.session.snapshot().active) launchUrl.searchParams.set("_arcadeTransport", "nearby");
    frame.src = launchUrl.href;
    frame.addEventListener("load", () => {
      try{
        const loaded = new URL(frame.contentWindow.location.href);
        const root = new URL(".", location.href);
        const rootIndex = new URL("index.html", root);
        if(loaded.origin === location.origin && (loaded.pathname === root.pathname || loaded.pathname === rootIndex.pathname)){
          this.closeGame({ history: true });
          return;
        }
      }catch(_error){}
      loading.hidden = true;
      try{ frame.contentWindow?.focus(); }catch(_error){}
    });
    frame.addEventListener("error", () => {
      this.toast("That game could not open. Try again.");
      this.closeGame({ history: true });
    });
    layer.append(frame);
    layer.hidden = false;
    this._updateBackgroundInert();
    document.documentElement.classList.add("shell-game-open");
    document.body.classList.add("shell-game-open");
    try{ window.ArcadeNative?.setGameOrientation?.(item.orientation || "any"); }catch(_error){}
    if(options.history !== false){
      const url = new URL(location.href);
      url.searchParams.set("game", item.folder);
      if(code.length >= 4) url.searchParams.set("room", code); else url.searchParams.delete("room");
      const state = { arcadeShell: true, arcadeGame: item.folder, roomCode: this.currentRoomCode || null };
      if(replacingGame || history.state?.arcadeGame) history.replaceState(state, "", url);
      else history.pushState(state, "", url);
    }
    return true;
  }

  closeGame({ history: useHistory = true } = {}){
    if(!this.currentItem || this.frameClosing) return false;
    this.frameClosing = true;
    const frame = $("#shellGameFrame");
    if(this.currentFrameId) this._closeFrameSockets(this.currentFrameId);
    try{ frame?.contentWindow?.postMessage({ scope: "arcade-shell", version: 1, type: "pause" }, location.origin); }catch(_error){}
    try{ frame?.contentWindow?.dispatchEvent(new Event("pagehide")); }catch(_error){}
    frame?.remove();
    $("#shellGameLayer").hidden = true;
    $("#shellGameLoading").hidden = false;
    this.currentItem = null;
    this.currentRoomCode = "";
    this.currentFrameId = null;
    this.frameClosing = false;
    this._updateBackgroundInert();
    document.documentElement.classList.remove("shell-game-open");
    document.body.classList.remove("shell-game-open");
    try{ window.ArcadeNative?.setGameOrientation?.("any"); }catch(_error){}
    if(useHistory){
      if(history.state?.arcadeGame) history.back();
      else{
        const url = new URL(location.href);
        url.searchParams.delete("game");
        url.searchParams.delete("room");
        history.replaceState(null, "", url);
      }
    }
    const restore = this.launcher;
    this.launcher = null;
    requestAnimationFrame(() => restore?.focus?.());
    return true;
  }

  _reconcileHistory(){
    const url = new URL(location.href);
    const desiredGame = url.searchParams.get("game") || "";
    const desiredRoom = String(url.searchParams.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if(!desiredGame){
      if(this.currentItem) this.closeGame({ history: false });
    }else if(this.currentItem?.folder !== desiredGame || this.currentRoomCode !== (desiredRoom.length >= 4 ? desiredRoom : "")){
      if(this.currentItem) this.closeGame({ history: false });
      this.openGame(desiredGame, desiredRoom, { history: false });
    }
    const desiredModal = history.state?.arcadeModal || "";
    if(!desiredModal){
      if(!$("#arcadeSettingsOverlay").hidden) this.closeSettings({ history: false });
      if(!$("#pairOverlay").hidden) this.closePairing({ history: false });
      if(!$("#nearbyDrawer").hidden) this.closeDrawer({ history: false });
      return;
    }
    if(desiredModal === "settings"){
      if(!$("#pairOverlay").hidden) this.closePairing({ history: false, restoreFocus: false });
      if(!$("#nearbyDrawer").hidden) this.closeDrawer({ history: false, restoreFocus: false });
      if($("#arcadeSettingsOverlay").hidden) this.openSettings({ history: false });
      return;
    }
    if(desiredModal === "drawer"){
      if(!$("#arcadeSettingsOverlay").hidden) this.closeSettings({ history: false, restoreFocus: false });
      if(!$("#pairOverlay").hidden) this.closePairing({ history: false, restoreFocus: false });
      if($("#nearbyDrawer").hidden) this.openDrawer({ history: false });
      return;
    }
    if(desiredModal === "pair"){
      if(!$("#arcadeSettingsOverlay").hidden) this.closeSettings({ history: false, restoreFocus: false });
      if(!$("#pairOverlay").hidden) return;
      if(this.pendingPairing && $("#pairBody")?.childElementCount){
        this._showModal("pair", { history: false });
      }else{
        const state = { ...(history.state || {}), arcadeModal: "drawer" };
        history.replaceState(state, "", location.href);
        this.openDrawer({ history: false });
      }
    }
  }

  _closeFrameSockets(frameId){
    const id = String(frameId || "");
    const sockets = this.frameSockets.get(id);
    if(!sockets) return;
    this.frameSockets.delete(id);
    for(const socketId of sockets) this.session.requestRoomRpc("ws-close", { socketId }).catch(() => null);
  }

  goHome(){
    if(!$("#arcadeSettingsOverlay").hidden){ this.closeSettings(); return true; }
    if(!$("#pairOverlay").hidden){ this.closePairing(); return true; }
    if(!$("#nearbyDrawer").hidden){ this.closeDrawer(); return true; }
    if(this.currentItem){ this.closeGame({ history: true }); return true; }
    return true;
  }

  handleNativeBack(){
    if(!$("#arcadeSettingsOverlay").hidden){ this.closeSettings(); return true; }
    if(!$("#pairOverlay").hidden){ this.closePairing(); return true; }
    if(!$("#nearbyDrawer").hidden){ this.closeDrawer(); return true; }
    if(this.currentItem){ this.closeGame({ history: true }); return true; }
    return false;
  }

  openDrawer({ history: useHistory = true } = {}){
    const overlay = $("#nearbyDrawer");
    if(overlay.hidden && !this.drawerOpener) this.drawerOpener = this._usableOpener(document.activeElement);
    this._showModal("drawer", { history: useHistory });
    this.drawerMode = this.session.snapshot().active ? "session" : "home";
    this._renderDrawer();
    requestAnimationFrame(() => $("#nearbyClose")?.focus());
  }

  closeDrawer({ history: useHistory = true, restoreFocus = true } = {}){
    const overlay = $("#nearbyDrawer");
    if(overlay) overlay.hidden = true;
    this.pendingRole = null;
    this._closeModalHistory("drawer", useHistory);
    this._updateBackgroundInert();
    if(restoreFocus){
      const opener = this.drawerOpener;
      this.drawerOpener = null;
      requestAnimationFrame(() => opener?.focus?.());
    }
  }

  openSettings({ history: useHistory = true } = {}){
    if($("#arcadeSettingsOverlay")?.hidden && !this.settingsOpener) this.settingsOpener = this._usableOpener(document.activeElement);
    this._showModal("settings", { history: useHistory });
    this._renderSettings();
    requestAnimationFrame(() => $("#arcadeSettingsClose")?.focus());
  }

  closeSettings({ history: useHistory = true, restoreFocus = true } = {}){
    const overlay = $("#arcadeSettingsOverlay");
    if(overlay) overlay.hidden = true;
    this._closeModalHistory("settings", useHistory);
    this._updateBackgroundInert();
    if(restoreFocus){
      const opener = this.settingsOpener;
      this.settingsOpener = null;
      requestAnimationFrame(() => opener?.focus?.());
    }
  }

  _renderSettings(){
    const alerts = window.ArcadeMultiplayer;
    const settings = alerts?.getTurnAlertSettings?.() || { soundEnabled: true, notificationsEnabled: false, notificationsSupported: false, notificationPermission: "unsupported", windows: false };
    const sound = $("#turnSoundSetting");
    if(sound){
      sound.textContent = settings.soundEnabled ? "Sound On" : "Muted";
      sound.classList.toggle("on", settings.soundEnabled === true);
      sound.setAttribute("aria-pressed", String(settings.soundEnabled === true));
      sound.setAttribute("aria-label", `Turn sound, ${settings.soundEnabled ? "on" : "muted"}`);
    }
    const notify = $("#turnNotificationSetting");
    const help = $("#turnNotificationHelp");
    const label = $("#turnNotificationLabel");
    if(label) label.textContent = settings.windows ? "Windows notifications" : "Desktop notifications";
    if(notify){
      notify.classList.toggle("on", settings.notificationsEnabled === true);
      notify.classList.toggle("blocked", settings.notificationPermission === "denied");
      notify.setAttribute("aria-pressed", String(settings.notificationsEnabled === true));
      if(!settings.notificationsSupported){ notify.textContent = "Unavailable"; notify.disabled = true; }
      else if(settings.notificationPermission === "denied"){ notify.textContent = "Blocked"; notify.disabled = true; }
      else{ notify.textContent = settings.notificationsEnabled ? "Notify On" : "Enable"; notify.disabled = false; }
      const notificationName = settings.windows ? "Windows turn notifications" : "Desktop turn notifications";
      notify.setAttribute("aria-label", `${notificationName}, ${notify.textContent.toLowerCase()}`);
    }
    if(help){
      help.textContent = settings.notificationPermission === "denied"
        ? "Notifications are blocked in this browser's site settings."
        : "Shows a notification only while Arcade is hidden or unfocused.";
    }
    const manage = $("#arcadeManageLibrary");
    if(manage) manage.hidden = !(window.ArcadeNative && typeof window.ArcadeNative.openManager === "function");
  }

  _usableOpener(value){
    return value instanceof HTMLElement && value.isConnected && !value.closest?.("[hidden]") ? value : null;
  }

  _showModal(type, { history: useHistory = true } = {}){
    const overlay = type === "pair" ? $("#pairOverlay") : type === "settings" ? $("#arcadeSettingsOverlay") : $("#nearbyDrawer");
    if(!overlay) return;
    if(type === "pair" && overlay.hidden && !this.pairOpener) this.pairOpener = this.drawerOpener || this._usableOpener(document.activeElement);
    overlay.hidden = false;
    if(useHistory !== false){
      const next = { ...(history.state || {}), arcadeModal: type };
      if(history.state?.arcadeModal || useHistory === "replace") history.replaceState(next, "", location.href);
      else history.pushState(next, "", location.href);
    }
    this._updateBackgroundInert();
  }

  _closeModalHistory(type, useHistory){
    if(!useHistory || history.state?.arcadeModal !== type) return;
    if(useHistory === "replace"){
      const next = { ...(history.state || {}) };
      delete next.arcadeModal;
      history.replaceState(next, "", location.href);
    }else history.back();
  }

  _updateBackgroundInert(){
    const modalOpen = !$("#nearbyDrawer")?.hidden || !$("#pairOverlay")?.hidden || !$("#arcadeSettingsOverlay")?.hidden;
    const gameOpen = !!this.currentItem;
    if(this.app){
      this.app.inert = modalOpen || gameOpen;
      if(modalOpen || gameOpen) this.app.setAttribute("aria-hidden", "true");
      else this.app.removeAttribute("aria-hidden");
    }
    const gameLayer = $("#shellGameLayer");
    if(gameLayer){
      gameLayer.inert = modalOpen;
      if(modalOpen) gameLayer.setAttribute("aria-hidden", "true");
      else gameLayer.removeAttribute("aria-hidden");
    }
  }

  _trapModalFocus(event){
    const overlay = !$("#arcadeSettingsOverlay")?.hidden ? $("#arcadeSettingsOverlay") : !$("#pairOverlay")?.hidden ? $("#pairOverlay") : !$("#nearbyDrawer")?.hidden ? $("#nearbyDrawer") : null;
    if(!overlay) return false;
    const focusable = [...overlay.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary,[tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.closest("[hidden]") && node.getAttribute("aria-hidden") !== "true");
    if(!focusable.length){ event.preventDefault(); return true; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if(event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))){
      event.preventDefault();
      last.focus();
    }else if(!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))){
      event.preventDefault();
      first.focus();
    }
    return true;
  }

  _renderSession(state){
    const active = state.active;
    if(state.role === "host" && state.pairingCount === 0) this.pendingPairing = null;
    const badge = $("#nearbyBadge");
    badge?.classList.toggle("connected", active && state.connected > 0);
    badge?.setAttribute("aria-label", active ? `Nearby Arcade, ${state.connected} connected` : this.nearbyUnavailable ? "Nearby Arcade unavailable" : "Connect Nearby Arcade devices");
    $("#nearbyBadgeCount").textContent = active ? `· ${state.connected}` : "";
    const callout = $("#nearbyCallout");
    callout?.classList.toggle("active", active);
    $("#nearbyCalloutMascot").textContent = active ? state.mascot : "📡";
    $("#nearbyCalloutTitle").textContent = active ? state.sessionName : "NEARBY ARCADE";
    $("#nearbyCalloutText").textContent = active ? `${state.connected} connected · ${state.status}` : this.nearbyUnavailable ? "Unavailable in this browser session" : "Play together without Internet";
    $("#nearbyCalloutBtn").textContent = active ? "View Players" : this.nearbyUnavailable ? "View Details" : "Connect Devices";
    if(!$("#nearbyDrawer")?.hidden) this._renderDrawer();
    if(state.role === "host") this._syncRoomMembers();
    if(!active){
      this.roomService = null;
      this.roomServiceReady = null;
      this.session.setRpcHandler(null);
      this.session.setCompletionHandler(null);
    }
  }

  _renderDrawer(){
    const body = $("#nearbyDrawerBody");
    if(!body) return;
    body.replaceChildren();
    const state = this.session.snapshot();
    if(state.active){ this._renderActiveDrawer(body, state); return; }
    if(this.drawerMode === "profile" && this.pendingRole){ this._renderIdentitySetup(body, this.pendingRole); return; }

    const hero = document.createElement("div");
    hero.className = "nearby-hero";
    hero.innerHTML = '<div class="big-mascot">📡</div><div><h2 id="nearbyDrawerTitle">Nearby Arcade</h2><p>Connect once, then play any multiplayer game.</p></div>';
    body.append(hero);
    const intro = document.createElement("p");
    intro.className = "nearby-lead";
    intro.textContent = this.nearbyUnavailable
      ? `${this.nearbyUnavailable} Local games and Internet multiplayer remain available.`
      : "Put the devices on the same Wi-Fi or phone hotspot. Internet is not needed after the Arcade is ready offline.";
    body.append(intro);

    if(this.nearbyUnavailable){
      body.append(this._offlineRow());
      return;
    }

    const choices = document.createElement("div");
    choices.className = "shell-choice-grid";
    choices.append(
      this._choiceButton("Start Nearby Arcade", "This device hosts the family Arcade.", () => this._chooseRole("host")),
      this._choiceButton("Join Nearby Arcade", "Scan the host's invitation.", () => this._chooseRole("guest"))
    );
    body.append(choices);
    if(state.checkpoint?.role === "host"){
      const resume = document.createElement("button");
      resume.type = "button";
      resume.className = "shell-gold";
      resume.style.cssText = "width:100%;margin-top:10px";
      resume.textContent = `Resume ${state.checkpoint.mascot || "🎮"} ${state.checkpoint.sessionName || "Nearby Arcade"}`;
      resume.addEventListener("click", () => this._resumeHost());
      body.append(resume);
    }
    body.append(this._offlineRow());
  }

  _choiceButton(title, description, action){
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shell-choice";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent = description;
    button.append(strong, small);
    button.addEventListener("click", action);
    return button;
  }

  _chooseRole(role){
    if(this.nearbyUnavailable){
      this.toast(`${this.nearbyUnavailable} Regular Arcade games still work.`);
      return;
    }
    if(!this._offlineRuntimeReady()){
      this.toast("Prepare Arcade for offline play before connecting Nearby devices.");
      this._prepareOffline();
      return;
    }
    this.pendingRole = role;
    this.drawerMode = "profile";
    this._renderDrawer();
    requestAnimationFrame(() => $("#nearbyNickname")?.focus());
  }

  _renderIdentitySetup(body, role){
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "‹ Back";
    back.addEventListener("click", () => { this.drawerMode = "home"; this.pendingRole = null; this._renderDrawer(); });
    const title = document.createElement("h2");
    title.id = "nearbyDrawerTitle";
    title.textContent = role === "host" ? "Start Nearby Arcade" : "Join Nearby Arcade";
    const lead = document.createElement("p");
    lead.className = "nearby-lead";
    lead.textContent = "Choose your nickname and avatar now. They lock after you join this session.";
    body.append(back, title, lead);

    const draft = this.session.draftProfile();
    const card = document.createElement("div");
    card.className = "identity-card";
    const field = document.createElement("div");
    field.className = "identity-field";
    const label = document.createElement("label");
    label.htmlFor = "nearbyNickname";
    label.textContent = "Nickname";
    const input = document.createElement("input");
    input.id = "nearbyNickname";
    input.type = "text";
    input.maxLength = 24;
    input.autocomplete = "nickname";
    input.autocapitalize = "words";
    input.enterKeyHint = "done";
    input.value = draft.nickname || sillyName();
    field.append(label, input);
    card.append(field);
    const avatars = document.createElement("div");
    avatars.className = "avatar-grid";
    avatars.setAttribute("aria-label", "Choose an avatar");
    let selectedAvatar = draft.avatar || AVATARS[0];
    const setSelected = value => {
      selectedAvatar = value;
      avatars.querySelectorAll("button").forEach(button => button.classList.toggle("selected", button.dataset.avatar === value));
    };
    for(const avatar of AVATARS){
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.avatar = avatar;
      button.textContent = avatar;
      button.setAttribute("aria-label", `Choose ${avatar} avatar`);
      button.addEventListener("click", () => setSelected(avatar));
      avatars.append(button);
    }
    card.append(avatars);
    setSelected(selectedAvatar);
    const actions = document.createElement("div");
    actions.className = "identity-actions";
    const silly = document.createElement("button");
    silly.type = "button";
    silly.textContent = "🎲 Silly Name";
    silly.addEventListener("click", () => { input.value = sillyName(); input.focus(); input.select(); });
    const proceed = document.createElement("button");
    proceed.type = "button";
    proceed.className = "shell-primary";
    proceed.textContent = role === "host" ? "Start" : "Scan Invitation";
    proceed.addEventListener("click", async () => {
      proceed.disabled = true;
      try{
        const profile = await this.session.saveProfile({ nickname: input.value, avatar: selectedAvatar, color: draft.color });
        await navigator.storage?.persist?.().catch(() => false);
        if(role === "host"){
          await this.session.startHost(profile);
          this.drawerMode = "session";
          this.toast("Nearby Arcade is ready. Add another player when you are ready.");
        }else{
          this.closeDrawer({ history: false, restoreFocus: false });
          await this._scanHostInvitation(profile);
        }
      }catch(error){ this.toast(safeMessage(error)); }
      finally{ proceed.disabled = false; }
    });
    actions.append(silly, proceed);
    card.append(actions);
    body.append(card);
  }

  async _resumeHost(){
    try{
      if(!this._offlineRuntimeReady()){
        this.toast("Prepare Arcade for offline play before reconnecting Nearby devices.");
        await this._prepareOffline();
        return;
      }
      const checkpoint = this.session.snapshot().checkpoint;
      const draft = this.session.draftProfile();
      await navigator.storage?.persist?.().catch(() => false);
      await this.session.startHost({ ...draft, nickname: checkpoint?.identity?.nickname || draft.nickname, avatar: checkpoint?.identity?.avatar || draft.avatar }, { resume: true });
      this.drawerMode = "session";
      this.toast("Nearby Arcade restored. Other devices can reconnect with a fresh pairing scan.");
    }catch(error){ this.toast(safeMessage(error)); }
  }

  _renderActiveDrawer(body, state){
    const hero = document.createElement("div");
    hero.className = "nearby-hero";
    const mascot = document.createElement("div");
    mascot.className = "big-mascot";
    mascot.textContent = state.mascot;
    const copy = document.createElement("div");
    const title = document.createElement("h2");
    title.id = "nearbyDrawerTitle";
    title.textContent = state.sessionName;
    const subtitle = document.createElement("p");
    subtitle.textContent = `${state.connected} connected · ${state.role === "host" ? "This device hosts" : state.status}`;
    copy.append(title, subtitle);
    hero.append(mascot, copy);
    body.append(hero);

    if(state.identity){
      const locked = document.createElement("div");
      locked.className = "locked-identity";
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = state.identity.avatar;
      const text = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = state.identity.nickname;
      const note = document.createElement("span");
      note.textContent = "Identity locked for this session";
      text.append(strong, note);
      const icon = document.createElement("div");
      icon.className = "lock-icon";
      icon.textContent = "🔒";
      locked.append(avatar, text, icon);
      body.append(locked);
    }

    const section = document.createElement("section");
    section.className = "nearby-section";
    const head = document.createElement("div");
    head.className = "nearby-section-head";
    const heading = document.createElement("h3");
    heading.textContent = "Players";
    const status = document.createElement("span");
    status.textContent = state.joiningLocked ? "Joining locked" : "Ready for players";
    head.append(heading, status);
    const list = document.createElement("div");
    list.className = "player-list";
    for(const member of state.members){
      const row = document.createElement("div");
      row.className = "nearby-player";
      row.style.setProperty("--player-color", member.color);
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = member.avatar;
      const identity = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = `${member.nickname}${member.host ? " · Host" : ""}`;
      const presence = document.createElement("small");
      const dot = document.createElement("span");
      dot.className = `presence-dot ${member.presence}`;
      presence.append(dot, document.createTextNode(member.presence === "connected" ? "Connected" : member.presence === "reconnecting" ? "Reconnecting..." : "Connection lost"));
      identity.append(name, presence);
      const score = document.createElement("div");
      score.className = "stars";
      score.textContent = member.stars ? `★ ${member.stars}` : "☆ 0";
      row.append(avatar, identity, score);
      if(state.role === "host" && !member.host){
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-player";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${member.nickname}`);
        remove.addEventListener("click", () => this._removePlayer(member));
        row.append(remove);
      }
      list.append(row);
    }
    section.append(head, list);
    body.append(section);

    const reactions = document.createElement("section");
    reactions.className = "nearby-section";
    const reactionHead = document.createElement("div");
    reactionHead.className = "nearby-section-head";
    const reactionTitle = document.createElement("h3");
    reactionTitle.textContent = "Quick reactions";
    const mute = document.createElement("button");
    mute.type = "button";
    mute.textContent = this.soundMuted ? "🔇 Muted" : "🔊 Sound";
    mute.setAttribute("aria-pressed", String(this.soundMuted));
    mute.addEventListener("click", () => {
      this.soundMuted = !this.soundMuted;
      try{ localStorage.setItem("arcade.nearby.sound", this.soundMuted ? "0" : "1"); }catch(_error){}
      this._renderDrawer();
    });
    reactionHead.append(reactionTitle, mute);
    const grid = document.createElement("div");
    grid.className = "reaction-grid";
    for(const reaction of REACTIONS){
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = reaction;
      button.setAttribute("aria-label", `Send ${reaction} reaction`);
      button.addEventListener("click", () => { if(!this.session.sendReaction(reaction)) this.toast("Easy there! Reactions need a quick break."); });
      grid.append(button);
    }
    reactions.append(reactionHead, grid);
    body.append(reactions);

    const actions = document.createElement("div");
    actions.className = "nearby-actions";
    if(state.role === "host"){
      const addPlayer = this._actionButton(state.pairingCount ? "Connecting Player..." : "Add Player", "shell-primary", () => this._hostAddPlayer());
      addPlayer.disabled = state.pairingCount > 0;
      actions.append(
        addPlayer,
        this._actionButton(state.joiningLocked ? "Unlock Joining" : "Lock Joining", "", () => this._toggleJoining()),
        this._actionButton("Surprise Me", "shell-gold", () => this._surpriseMe()),
        this._actionButton("Reset Stars", "", () => this._resetStars()),
        this._actionButton("End Session", "shell-danger", () => this._endSession())
      );
    }else{
      actions.append(
        this._actionButton("Surprise Me", "shell-gold", () => this._surpriseMe()),
        this._actionButton("Leave Nearby", "shell-danger", () => this._leaveSession())
      );
    }
    body.append(actions);
    const note = document.createElement("p");
    note.className = "session-note";
    note.textContent = "Nearby stays on these devices. Open any existing Multiplayer choice and Arcade will use this connection automatically.";
    body.append(note, this._offlineRow());
  }

  _actionButton(label, className, action){
    const button = document.createElement("button");
    button.type = "button";
    if(className) button.className = className;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  async _removePlayer(member){
    if(!confirm(`Remove ${member.nickname}? Their name remains reserved for this session.`)) return;
    try{
      if(this.session.snapshot().role === "host") await this._ensureRoomService(this.session.snapshot());
      if(typeof this.roomService?.removeMemberFromRooms === "function") await this.roomService.removeMemberFromRooms(member.memberId, "Removed from Nearby Arcade");
      else await this.roomService?.closeMemberSockets?.(member.memberId, "Removed from Nearby Arcade");
      await this.session.removePlayer(member.memberId);
      this.memberPresence.delete(member.memberId);
      this._queueCheckpoint();
    }
    catch(error){ this.toast(safeMessage(error)); }
  }

  async _toggleJoining(){
    try{ await this.session.setJoiningLocked(!this.session.snapshot().joiningLocked); }
    catch(error){ this.toast(safeMessage(error)); }
  }

  async _resetStars(){
    if(!confirm("Reset every player's Arcade Stars for this session?")) return;
    try{ await this.session.resetStars(); }
    catch(error){ this.toast(safeMessage(error)); }
  }

  async _endSession(){
    if(!confirm("End Nearby Arcade for everyone?")) return;
    try{ await this.session.end(); this.closeDrawer(); }
    catch(error){ this.toast(safeMessage(error)); }
  }

  async _leaveSession(){
    if(!confirm("Leave Nearby Arcade? You will need to scan again to reconnect.")) return;
    await this.session.leave({ preserveCheckpoint: true });
    this.closeDrawer();
  }

  _surpriseMe(){
    const state = this.session.snapshot();
    const item = surpriseGame(this.items, Math.max(2, state.connected));
    if(!item){ this.toast("No multiplayer game fits this group yet."); return; }
    this.closeDrawer({ history: "replace" });
    this.toast(`Surprise! ${item.title}`);
    this.openGame(item.folder);
  }

  async _hostAddPlayer(){
    try{
      this.closeDrawer({ history: false, restoreFocus: false });
      const invitation = await this.session.createHostInvitation();
      this.pendingPairing = invitation;
      await this._showQr({
        title: "Scan this invitation",
        lead: "On the other device, tap Join Nearby Arcade and scan this code.",
        frames: invitation.frames,
        wire: invitation.wire,
        nextLabel: "Scan Their Response",
        onNext: () => this._scanGuestResponse(invitation.pairingId)
      });
    }catch(error){ this.toast(safeMessage(error)); this.openDrawer(); }
  }

  async _scanHostInvitation(profile){
    await this._showScanner({
      title: "Scan the host's code",
      lead: "Point this device at the invitation shown by the host.",
      onWire: async (wire, signal) => {
        const response = await this.session.joinFromInvitation(profile, wire, { signal });
        this.pendingPairing = response;
        await this._showQr({
          title: "Now show this response",
          lead: "The host should tap Scan Their Response and scan this code.",
          frames: response.frames,
          wire: response.wire,
          nextLabel: "Waiting for Host",
          onNext: null
        });
      }
    });
  }

  async _scanGuestResponse(pairingId){
    await this._showScanner({
      title: "Scan their response",
      lead: "Point this device at the code shown on the joining device.",
      onWire: async (wire, signal) => {
        await this.session.acceptGuestResponse(wire, pairingId, { signal });
        this.closePairing({ cancel: false, history: false, restoreFocus: false });
        this.openDrawer();
        this.toast("Response accepted. Connecting...");
      }
    });
  }

  async _showQr({ title, lead, frames, wire, nextLabel, onNext }){
    this.closePairing({ cancel: false, history: false, restoreFocus: false });
    this._showModal("pair");
    const displayController = new AbortController();
    this.qrDisplayController = displayController;
    $("#pairTitle").textContent = title;
    $("#pairLead").textContent = lead;
    const body = $("#pairBody");
    const actions = $("#pairActions");
    body.replaceChildren();
    actions.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "pair-canvas-wrap";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "Animated Nearby Arcade pairing code");
    canvas.tabIndex = 0;
    wrap.append(canvas);
    const progress = document.createElement("div");
    progress.className = "pair-progress";
    progress.textContent = frames.length > 1 ? `${frames.length} code frames rotate automatically` : "Keep this code visible";
    const fallback = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Pairing text fallback";
    const fallbackText = document.createElement("textarea");
    fallbackText.className = "pair-paste";
    fallbackText.readOnly = true;
    fallbackText.value = wire;
    fallbackText.setAttribute("aria-label", "Pairing text to copy or share");
    fallbackText.addEventListener("focus", () => fallbackText.select());
    fallback.addEventListener("toggle", () => { if(fallback.open) requestAnimationFrame(() => fallbackText.focus()); });
    fallback.append(summary, fallbackText);
    body.append(wrap, progress, fallback);
    let display;
    try{
      display = await startAnimatedQrDisplay({ frames: [...frames], canvas, frameMs: 650, size: 340, errorCorrection: "M", signal: displayController.signal });
    }catch(error){
      if(displayController.signal.aborted || this.qrDisplayController !== displayController) return false;
      this.qrDisplayController = null;
      throw error;
    }
    // Bundled vendor loading and the first canvas render are asynchronous. A
    // close/reopen during that await must not let the obsolete call replace the
    // new display or append stale Copy/Next actions into the shared modal.
    if(displayController.signal.aborted || this.qrDisplayController !== displayController){
      try{ display.stop?.(); }catch(_error){}
      return false;
    }
    this.qrDisplay = display;
    actions.append(this._actionButton("Copy Pairing Data", "", () => this._copyPairing(wire)));
    if(typeof navigator.share === "function") actions.append(this._actionButton("Share", "", () => navigator.share({ title: "Nearby Arcade", text: wire }).catch(() => null)));
    if(onNext) actions.append(this._actionButton(nextLabel, "shell-primary", onNext));
    else{
      const waiting = document.createElement("button");
      waiting.type = "button";
      waiting.disabled = true;
      waiting.textContent = nextLabel;
      actions.append(waiting);
    }
    requestAnimationFrame(() => canvas.focus());
  }

  async _showScanner({ title, lead, onWire }){
    this.closePairing({ cancel: false, history: false, restoreFocus: false });
    this._showModal("pair");
    $("#pairTitle").textContent = title;
    $("#pairLead").textContent = lead;
    const body = $("#pairBody");
    const actions = $("#pairActions");
    body.replaceChildren();
    actions.replaceChildren();
    const video = document.createElement("video");
    video.className = "pair-video";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-label", "Camera preview for scanning pairing code");
    video.tabIndex = 0;
    const progress = document.createElement("div");
    progress.className = "pair-progress";
    progress.textContent = "Starting camera...";
    const paste = document.createElement("textarea");
    paste.className = "pair-paste";
    paste.placeholder = "Or paste pairing data here";
    paste.setAttribute("aria-label", "Paste Nearby Arcade pairing data");
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    file.className = "shell-sr";
    body.append(video, progress, paste, file);
    const collector = new QrFrameCollector();
    // This controller owns the whole scanner generation, including camera,
    // screenshot decoding, pasted data, and the asynchronous WebRTC setup that
    // follows a valid code. Closing the modal invalidates every late result.
    const controller = new AbortController();
    this.qrScanController = controller;
    const active = () => !controller.signal.aborted && this.qrScanController === controller;
    let finished = false;
    const consume = async raw => {
      if(!active() || finished || typeof raw !== "string") return;
      try{
        let wire = null;
        if(raw.startsWith("AN1.")) wire = raw;
        else{
          const result = collector.add(raw);
          progress.textContent = result.complete ? "Code complete" : `Scanning ${result.received} of ${result.total} frames...`;
          wire = result.payload;
        }
        if(!wire || !active()) return;
        finished = true;
        progress.textContent = "Checking code...";
        await onWire(wire, controller.signal);
        if(active()) this._stopScanner();
      }catch(error){
        if(!active()) return;
        finished = false;
        collector.reset();
        progress.textContent = safeMessage(error, "That code was not recognized. Try again.");
      }
    };
    const pasteButton = this._actionButton("Use Pasted Data", "shell-primary", () => consume(paste.value.trim()));
    const imageButton = this._actionButton("Scan Screenshot", "", () => file.click());
    file.addEventListener("change", async () => {
      const selected = file.files?.[0];
      if(!selected || !active()) return;
      try{
        const raw = await decodeQrSource(selected);
        if(!active()) return;
        if(!raw) throw new Error("No QR code was found in that image.");
        await consume(raw);
      }catch(error){ if(active()) progress.textContent = safeMessage(error); }
      file.value = "";
    });
    // Keep non-camera fallbacks usable even while a permission prompt or
    // video.play() call is pending.
    actions.append(imageButton, pasteButton);
    // Own the abort controller before asking for camera permission. The
    // permission prompt (and video.play()) can outlive the pairing modal; a
    // controller kept only in this async stack would let a late camera stream
    // survive after the user had already closed the scanner.
    let cameraReady = false;
    try{
      const scanner = await startQrCameraScanner({
        video,
        signal: controller.signal,
        onResult: consume,
        onError: error => { if(error?.name !== "AbortError") progress.textContent = "Keep the whole code inside the camera view."; }
      });
      // A close/reopen can occur while getUserMedia or video.play is pending.
      // Never publish a scanner returned for an obsolete modal generation.
      if(controller.signal.aborted || this.qrScanController !== controller){
        try{ scanner.stop?.(); }catch(_error){}
        if(scanner.stream) for(const track of scanner.stream.getTracks?.() || []) track.stop();
        return;
      }
      this.qrScanner = scanner;
      cameraReady = true;
      progress.textContent = "Point the camera at the code";
    }catch(error){
      if(controller.signal.aborted || this.qrScanController !== controller) return;
      progress.textContent = "Camera unavailable. Use a screenshot or paste the pairing data.";
      $("#pairDiagnostics").textContent = safeMessage(error);
      requestAnimationFrame(() => paste.focus());
    }
    if(cameraReady) requestAnimationFrame(() => video.focus());
  }

  _stopScanner(){
    const controller = this.qrScanController;
    const scanner = this.qrScanner;
    // Clear ownership first so any late await continuation recognizes that it
    // is stale even if abort dispatch or a platform camera call is delayed.
    this.qrScanController = null;
    this.qrScanner = null;
    try{ controller?.abort?.(); }catch(_error){}
    try{ scanner?.abort?.(); }catch(_error){}
    try{ scanner?.stop?.(); }catch(_error){}
    if(scanner?.stream) for(const track of scanner.stream.getTracks?.() || []) track.stop();
  }

  closePairing({ cancel = true, history: useHistory = true, restoreFocus = true } = {}){
    if(cancel && this.pendingPairing){
      const pairingId = this.pendingPairing.pairingId;
      if(this.session.snapshot().role === "host") this.session.cancelPairing(pairingId);
      else if(this.session.snapshot().role === "guest" && !this.session.snapshot().identity) this.session.leave({ preserveCheckpoint: true, quiet: true });
      this.pendingPairing = null;
    }
    try{ this.qrDisplay?.stop?.(); }catch(_error){}
    this.qrDisplay = null;
    try{ this.qrDisplayController?.abort?.(); }catch(_error){}
    this.qrDisplayController = null;
    this._stopScanner();
    $("#pairOverlay").hidden = true;
    $("#pairBody")?.replaceChildren();
    $("#pairActions")?.replaceChildren();
    this._closeModalHistory("pair", useHistory);
    this._updateBackgroundInert();
    if(restoreFocus){
      const opener = this.pairOpener;
      this.pairOpener = null;
      requestAnimationFrame(() => opener?.focus?.());
    }
  }

  async _copyPairing(value){
    try{
      await navigator.clipboard.writeText(value);
      this.toast("Pairing data copied.");
    }catch(_error){ this.toast("Copy was blocked. Use the QR code or select the fallback pairing text."); }
  }

  _showReaction(value){
    const member = this.session.snapshot().members.find(candidate => candidate.memberId === value?.memberId);
    if(!member || !REACTIONS.includes(value?.reaction)) return;
    const toast = document.createElement("div");
    toast.className = "shell-toast reaction";
    toast.textContent = `${value.reaction}  ${member.avatar} ${member.nickname}`;
    $("#shellToastStack")?.append(toast);
    setTimeout(() => toast.remove(), 2400);
    if(!this.soundMuted){
      try{ navigator.vibrate?.(35); }catch(_error){}
      this._playTone(520, 0.045);
    }
  }

  _showInvitation(value){
    const invitation = safeGameInvitation(value, this.items);
    const state = this.session.snapshot();
    if(!invitation || invitation.senderId === state.identity?.memberId) return;
    const toast = document.createElement("div");
    toast.className = "shell-toast";
    const text = document.createElement("div");
    text.textContent = `${invitation.senderName || "A Nearby player"} wants to play ${invitation.label}.`;
    const actions = document.createElement("div");
    actions.className = "toast-actions";
    actions.append(
      this._actionButton("Join Game", "shell-primary", () => { toast.remove(); this.closeDrawer({ history: "replace" }); this.openGame(invitation.gameId, invitation.roomCode); }),
      this._actionButton("Not Now", "", () => toast.remove())
    );
    toast.append(text, actions);
    $("#shellToastStack")?.append(toast);
    setTimeout(() => toast.remove(), 30000);
    if(!this.soundMuted) this._playTone(660, 0.07);
  }

  _playTone(frequency, duration){
    try{
      const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
      if(!AudioContextImpl) return;
      const context = new AudioContextImpl();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.045, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
      oscillator.addEventListener("ended", () => context.close(), { once: true });
    }catch(_error){}
  }

  _playJoinFeedback(){ if(!this.soundMuted) this._playTone(740, 0.09); }

  toast(message, duration = 4200){
    const text = String(message || "").replace(/[<>]/g, "").slice(0, 220);
    if(!text) return;
    const node = document.createElement("div");
    node.className = "shell-toast";
    node.textContent = text;
    $("#shellToastStack")?.append(node);
    setTimeout(() => node.remove(), duration);
  }

  _offlineRow(){
    const row = document.createElement("div");
    row.className = "offline-row";
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = this.offlineState.ready ? "Offline Ready ✓" : this.offlineState.updating ? "Preparing offline..." : "Make Available Offline";
    const small = document.createElement("small");
    small.textContent = this._offlineDescription();
    copy.append(strong, small);
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = this.offlineState.updating || this.offlineState.ready;
    button.textContent = this.offlineState.ready ? "Ready" : this.offlineState.updating ? "Working" : "Prepare";
    button.addEventListener("click", () => this._prepareOffline());
    row.append(copy, button);
    return row;
  }

  _offlineDescription(){
    const progress = this.offlineState.progress;
    const total = progress?.totalFiles ?? progress?.total;
    const completed = progress?.completedFiles ?? progress?.completed;
    if(total) return `${completed || 0} of ${total} files`;
    if(this.offlineState.ready) return `${this.offlineState.fileCount || "All"} Arcade files cached`;
    return "Prepare once online, then play later without Internet";
  }

  _offlineRuntimeReady(){
    let nativeArchiveReady = false;
    try{ nativeArchiveReady = window.ArcadeNative?.hasOfflineArchive?.() === true; }catch(_error){}
    return offlineRuntimeReady({ offlineReady: this.offlineState.ready, hostname: location.hostname, nativeArchiveReady });
  }

  _renderOffline(){
    const badge = $("#offlineBadge");
    badge?.classList.toggle("offline-ready", this.offlineState.ready === true);
    $("#offlineBadgeText").textContent = this.offlineState.ready ? "Offline Ready" : this.offlineState.updating ? "Caching..." : "Offline";
    if(!$("#nearbyDrawer")?.hidden) this._renderDrawer();
  }

  async _serviceWorker(){
    if(!("serviceWorker" in navigator)) return null;
    if(navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
    const ready = navigator.serviceWorker.ready.then(value => value?.active || null).catch(() => null);
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), 500));
    return Promise.race([ready, timeout]);
  }

  async _swRequest(type, data = {}, timeoutMs = 6000){
    const worker = await this._serviceWorker();
    if(!worker) throw new Error("Offline preparation needs the installed Arcade website over HTTPS.");
    const requestId = `request_${protocol.randomUrlSafeId(12)}`;
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(new Error("Arcade offline service did not respond.")), timeoutMs);
      channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data || {}); };
      worker.postMessage({ type, requestId, ...data }, [channel.port2]);
    });
  }

  async _offlineStatus(){
    try{
      const status = await this._swRequest("ARCADE_OFFLINE_STATUS");
      this.offlineState = { ...this.offlineState, ...status, updating: status.updating === true };
    }catch(_error){}
    if(!this.offlineState.ready && this._offlineRuntimeReady()){
      this.offlineState = { ...this.offlineState, ready: true, updating: false, nativeArchive: true };
    }
    this._renderOffline();
  }

  async _prepareOffline(){
    if(this.offlineState.updating) return;
    try{
      await navigator.storage?.persist?.().catch(() => false);
      this.offlineState = { ...this.offlineState, updating: true, progress: { phase: "checking", completed: 0, total: 0 } };
      this._renderOffline();
      await this._swRequest("ARCADE_PREPARE_OFFLINE", {}, 10000);
      this._pollOfflineStatus(0);
    }catch(error){
      this.offlineState.updating = false;
      this._renderOffline();
      this.toast(safeMessage(error, "Arcade could not prepare offline files."));
    }
  }

  _pollOfflineStatus(attempt){
    setTimeout(async () => {
      await this._offlineStatus();
      if(this.offlineState.ready){ this.offlineState.updating = false; this._renderOffline(); this.toast("Arcade is Offline Ready ✓"); return; }
      if(this.offlineState.updating && attempt < 120) this._pollOfflineStatus(attempt + 1);
      else if(attempt >= 120){ this.offlineState.updating = false; this._renderOffline(); this.toast("Offline preparation did not finish. Your previous working copy is still safe."); }
    }, attempt ? 1000 : 350);
  }

  async _setNetworkMode(mode){
    try{ window.ArcadeNative?.setNearbyNetworkPaused?.(mode === "nearby"); }catch(_error){}
    try{ await this._swRequest("ARCADE_SET_NETWORK_MODE", { mode }, 2500); }catch(_error){}
  }

  async _acquireWakeLock(){
    if(this.wakeLock || document.hidden || this.session.snapshot().role !== "host" || !navigator.wakeLock?.request) return;
    try{
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => { this.wakeLock = null; });
    }catch(_error){}
  }

  _releaseWakeLock(){
    try{ this.wakeLock?.release?.(); }catch(_error){}
    this.wakeLock = null;
  }
}

if(typeof document !== "undefined" && globalThis.__ARCADE_SHELL_DISABLE_AUTO_INIT__ !== true){
  const shell = new ArcadeShellController();
  shell.initialize();
}
