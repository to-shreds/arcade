(function(root){
  "use strict";

  const SCOPE = "arcade-multiplayer";
  const BRIDGE_VERSION = 1;
  const WORKER_ORIGIN = "https://arcade-chess.jonathanjablon.workers.dev";
  const MAX_BODY_BYTES = 384 * 1024;
  const MAX_NEARBY_BODY_BYTES = 96 * 1024;
  const HANDSHAKE_TIMEOUT_MS = 900;
  const TURN_SOUND_KEY = "arcade.turnAlerts.sound.v1";
  const TURN_NOTIFICATIONS_KEY = "arcade.turnAlerts.notifications.v1";
  const TURN_NOTICE_DISMISSED_KEY = "arcade.turnAlerts.noticeDismissed.v1";
  const TURN_ROOM_LIMIT = 24;
  const GAME_LABELS = Object.freeze({
    chess: "Chess",
    sorry: "Sorry!",
    monopoly: "Monopoly",
    memory: "Memory",
    "tic-tac-toe": "Tic Tac Toe",
    dots: "Dots",
    checkers: "Checkers"
  });
  const TURN_ICON_URL = (() => {
    try{
      const scriptUrl = root.document?.currentScript?.src;
      return scriptUrl ? new URL("../arcade.png", scriptUrl).href : "";
    }catch(_error){ return ""; }
  })();
  const nativeFetch = typeof root.fetch === "function" ? root.fetch.bind(root) : null;
  const NativeWebSocket = root.WebSocket;
  const listeners = new Set();
  const pending = new Map();
  const sockets = new Map();
  const textEncoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
  let sequence = 0;
  let pinnedTransport = null;
  let bridgeAvailable = false;
  let turnAudioContext = null;
  let turnNotice = null;
  const observedTurns = new Map();
  const deliveredTurnAlerts = new Map();
  const nearbyFrameRequested = (() => {
    if(root.parent === root) return "online";
    try{ return new URL(root.location.href).searchParams.get("_arcadeTransport") === "nearby" ? "nearby" : "online"; }
    catch(_error){ return "online"; }
  })() === "nearby";
  let declaredNetworkMode = nearbyFrameRequested ? "nearby" : "online";
  let bridgeState = Object.freeze({
    transport: "cloudflare",
    nearby: false,
    connected: 0,
    identity: null,
    status: "Internet"
  });

  function storedValue(key){
    try{ return root.localStorage ? root.localStorage.getItem(key) : null; }
    catch(_error){ return null; }
  }

  function storeValue(key, value){
    try{
      if(!root.localStorage) return false;
      root.localStorage.setItem(key, value);
      return true;
    }catch(_error){ return false; }
  }

  function sessionValue(key){
    try{ return root.sessionStorage ? root.sessionStorage.getItem(key) : null; }
    catch(_error){ return null; }
  }

  function storeSessionValue(key, value){
    try{
      if(!root.sessionStorage) return false;
      root.sessionStorage.setItem(key, value);
      return true;
    }catch(_error){ return false; }
  }

  function notificationPermission(){
    try{ return root.Notification && typeof root.Notification.permission === "string" ? root.Notification.permission : "unsupported"; }
    catch(_error){ return "unsupported"; }
  }

  function windowsPlatform(){
    const navigatorValue = root.navigator || {};
    const platform = String(navigatorValue.userAgentData?.platform || navigatorValue.platform || "");
    const userAgent = String(navigatorValue.userAgent || "");
    return /windows|win32|win64/i.test(platform + " " + userAgent);
  }

  function turnSoundEnabled(){ return storedValue(TURN_SOUND_KEY) !== "0"; }
  function turnNotificationsSelected(){ return storedValue(TURN_NOTIFICATIONS_KEY) === "1"; }

  function turnAlertSettings(){
    const permission = notificationPermission();
    return Object.freeze({
      soundEnabled: turnSoundEnabled(),
      notificationsEnabled: turnNotificationsSelected() && permission === "granted",
      notificationsSelected: turnNotificationsSelected(),
      notificationPermission: permission,
      notificationsSupported: permission !== "unsupported",
      windows: windowsPlatform()
    });
  }

  function emitTurnSettings(){
    const detail = turnAlertSettings();
    try{ root.dispatchEvent(new CustomEvent("arcadeturnalertsettings", { detail })); }catch(_error){}
    return detail;
  }

  function setTurnSoundEnabled(enabled){
    storeValue(TURN_SOUND_KEY, enabled === false ? "0" : "1");
    if(enabled !== false) primeTurnAlerts();
    return emitTurnSettings();
  }

  function setTurnNotificationsEnabled(enabled){
    if(enabled !== true){
      storeValue(TURN_NOTIFICATIONS_KEY, "0");
      return emitTurnSettings();
    }
    return requestTurnNotifications();
  }

  async function requestTurnNotifications(){
    if(!root.Notification || typeof root.Notification.requestPermission !== "function") return emitTurnSettings();
    let permission = notificationPermission();
    try{
      if(permission === "default") permission = await root.Notification.requestPermission();
    }catch(_error){ permission = notificationPermission(); }
    if(permission === "granted") storeValue(TURN_NOTIFICATIONS_KEY, "1");
    else if(permission === "denied") storeValue(TURN_NOTIFICATIONS_KEY, "0");
    if(permission !== "default") removeTurnNotice();
    return emitTurnSettings();
  }

  function audioContext(){
    if(turnAudioContext?.state === "closed") turnAudioContext = null;
    if(turnAudioContext) return turnAudioContext;
    const AudioContextImpl = root.AudioContext || root.webkitAudioContext;
    if(typeof AudioContextImpl !== "function") return null;
    try{ turnAudioContext = new AudioContextImpl(); }
    catch(_error){ turnAudioContext = null; }
    return turnAudioContext;
  }

  function primeTurnAlerts(){
    if(!turnSoundEnabled()) return false;
    const context = audioContext();
    if(!context) return false;
    try{
      if(context.state !== "running" && typeof context.resume === "function") Promise.resolve(context.resume()).catch(() => null);
      return true;
    }catch(_error){ return false; }
  }

  function playTurnChime(){
    if(!turnSoundEnabled()) return false;
    const context = audioContext();
    if(!context) return false;
    const play = () => {
      if(context.state !== "running") return false;
      try{
        const now = Number(context.currentTime) || 0;
        const tones = [{ frequency: 740, start: now, stop: now + 0.085 }, { frequency: 988, start: now + 0.09, stop: now + 0.19 }];
        for(const tone of tones){
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(tone.frequency, tone.start);
          gain.gain.setValueAtTime(0.0001, tone.start);
          gain.gain.exponentialRampToValueAtTime(0.11, tone.start + 0.018);
          gain.gain.exponentialRampToValueAtTime(0.0001, tone.stop);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(tone.start);
          oscillator.stop(tone.stop + 0.01);
        }
        return true;
      }catch(_error){ return false; }
    };
    if(context.state !== "running" && typeof context.resume === "function"){
      try{ Promise.resolve(context.resume()).then(play).catch(() => null); return true; }
      catch(_error){ return false; }
    }
    return play();
  }

  function topContext(){
    try{
      const topWindow = root.top && root.top.document ? root.top : root;
      return { window: topWindow, document: topWindow.document || root.document };
    }catch(_error){ return { window: root, document: root.document }; }
  }

  function arcadeInBackground(){
    const context = topContext();
    try{ return !!context.document?.hidden || (typeof context.document?.hasFocus === "function" && !context.document.hasFocus()); }
    catch(_error){ return !!root.document?.hidden; }
  }

  function showTurnNotification(detail){
    if(!turnNotificationsSelected() || notificationPermission() !== "granted" || !arcadeInBackground()) return false;
    const label = GAME_LABELS[detail.gameId] || "Arcade game";
    try{
      const options = {
        body: `Your ${label} game is waiting.`,
        tag: `arcade-turn-${detail.gameId}-${detail.roomCode}`,
        renotify: true,
        silent: true
      };
      if(TURN_ICON_URL) options.icon = TURN_ICON_URL;
      const notice = new root.Notification(`Your turn · ${label}`, options);
      notice.onclick = () => {
        try{ topContext().window.focus(); }catch(_error){}
        try{ notice.close(); }catch(_error){}
      };
      return true;
    }catch(_error){ return false; }
  }

  function cleanRoomCode(value){
    const code = String(value || "").trim().toUpperCase();
    return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code) ? code : "";
  }

  function cleanGameId(value){
    const id = String(value || "").trim().toLowerCase();
    return Object.hasOwn(GAME_LABELS, id) ? id : "";
  }

  function numericCursor(value, fallback = -1){
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function describeTurn(room, gameHint){
    if(!room || typeof room !== "object" || Array.isArray(room)) return null;
    const roomCode = cleanRoomCode(room.code);
    if(!roomCode) return null;
    const chess = gameHint === "chess" || (room.game && typeof room.game === "object" && !Array.isArray(room.game));
    if(chess){
      const game = room.game;
      const side = room.side === "w" || room.side === "b" ? room.side : "";
      const turn = game && (game.turn === "w" || game.turn === "b") ? game.turn : "";
      const active = room.ready === true && !!side && !!turn && !(game.result && game.result.over === true);
      return {
        key: `chess:${roomCode}`,
        gameId: "chess",
        roomCode,
        version: numericCursor(room.version),
        revision: numericCursor(room.version),
        active,
        mine: active && side === turn,
        selfKey: side,
        turnKey: `${turn}:${Array.isArray(game.moves) ? game.moves.length : "?"}:v${numericCursor(room.version)}`
      };
    }
    const gameId = cleanGameId(gameHint || room.game);
    if(!gameId || gameId === "chat-room") return null;
    const turn = room.turn && typeof room.turn === "object" && !Array.isArray(room.turn) ? room.turn : null;
    const playerId = typeof room.playerId === "string" ? room.playerId : "";
    const seat = room.seat === null || room.seat === undefined ? null : Number(room.seat);
    const turnPlayerId = typeof turn?.playerId === "string" ? turn.playerId : "";
    const turnSeat = turn?.seat === null || turn?.seat === undefined ? null : Number(turn.seat);
    const playerMatch = !!playerId && !!turnPlayerId ? playerId === turnPlayerId : null;
    const seatMatch = Number.isInteger(seat) && Number.isInteger(turnSeat) ? seat === turnSeat : null;
    const identityKnown = playerMatch !== null || seatMatch !== null;
    const identityConsistent = (playerMatch === null || playerMatch) && (seatMatch === null || seatMatch);
    const active = room.status === "active" && !!turn && identityKnown;
    return {
      key: `${gameId}:${roomCode}`,
      gameId,
      roomCode,
      version: numericCursor(room.version),
      revision: numericCursor(room.revision, numericCursor(room.version)),
      active,
      mine: active && identityConsistent,
      selfKey: playerId || (Number.isInteger(seat) ? `seat:${seat}` : ""),
        turnKey: `${numericCursor(turn?.number, 0)}:${turnPlayerId || turnSeat}:v${numericCursor(room.version)}`
    };
  }

  function staleTurn(previous, incoming){
    if(!previous) return false;
    return incoming.version < previous.version || (incoming.version === previous.version && incoming.revision < previous.revision);
  }

  function rememberTurn(detail){
    if(observedTurns.has(detail.key)) observedTurns.delete(detail.key);
    observedTurns.set(detail.key, detail);
    while(observedTurns.size > TURN_ROOM_LIMIT) observedTurns.delete(observedTurns.keys().next().value);
  }

  function removeTurnNotice(){
    if(turnNotice?.isConnected) turnNotice.remove();
    turnNotice = null;
  }

  function maybeOfferTurnNotifications(){
    if(!windowsPlatform() || !["default", "granted"].includes(notificationPermission()) || storedValue(TURN_NOTIFICATIONS_KEY) !== null || sessionValue(TURN_NOTICE_DISMISSED_KEY) === "1") return;
    if(turnNotice?.isConnected || !root.document?.body) return;
    const panel = root.document.createElement("aside");
    panel.id = "arcadeTurnAlertOffer";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Windows turn notifications");
    panel.setAttribute("aria-live", "polite");
    Object.assign(panel.style, {
      position: "fixed", left: "50%", bottom: "max(14px, env(safe-area-inset-bottom))", transform: "translateX(-50%)",
      zIndex: "2147483646", width: "min(430px, calc(100vw - 24px))", padding: "11px 12px", borderRadius: "16px",
      border: "1px solid rgba(255,255,255,.24)", background: "rgba(9,13,30,.97)", color: "white",
      boxShadow: "0 12px 34px rgba(0,0,0,.45)", font: "700 13px/1.35 system-ui, sans-serif", textAlign: "center"
    });
    const text = root.document.createElement("span");
    text.textContent = "Turn sounds are on. Enable Windows notifications when Arcade is in the background?";
    const actions = root.document.createElement("div");
    Object.assign(actions.style, { display: "flex", justifyContent: "center", gap: "8px", marginTop: "9px" });
    const enable = root.document.createElement("button");
    enable.type = "button";
    enable.textContent = "Enable notifications";
    const dismiss = root.document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Not now";
    for(const button of [enable, dismiss]) Object.assign(button.style, { minHeight: "44px", borderRadius: "12px", border: "1px solid rgba(255,255,255,.22)", padding: "7px 11px", background: "rgba(255,255,255,.1)", color: "white", font: "inherit" });
    enable.style.background = "linear-gradient(135deg,#21dcff,#4277ff)";
    enable.style.color = "#071126";
    enable.addEventListener("click", () => { requestTurnNotifications(); });
    dismiss.addEventListener("click", removeTurnNotice);
    actions.append(enable, dismiss);
    panel.append(text, actions);
    root.document.body.append(panel);
    turnNotice = panel;
    storeSessionValue(TURN_NOTICE_DISMISSED_KEY, "1");
  }

  function observeRoom(room, gameHint){
    const detail = describeTurn(room, gameHint);
    if(!detail) return false;
    maybeOfferTurnNotifications();
    const previous = observedTurns.get(detail.key) || null;
    if(staleTurn(previous, detail)) return false;
    const sameIdentity = !previous || !previous.selfKey || !detail.selfKey || previous.selfKey === detail.selfKey;
    const becameMine = !!previous && sameIdentity && detail.active && detail.mine && (!previous.active || !previous.mine);
    rememberTurn(detail);
    if(!becameMine) return false;
    const alert = { gameId: detail.gameId, roomCode: detail.roomCode, turnKey: detail.turnKey };
    const bridged = bridgeAvailable && post({ type: "turn-alert", ...alert });
    deliverTurnAlert(alert, { notification: !bridged });
    return true;
  }

  function deliverTurnAlert(value, options = {}){
    if(!value || typeof value !== "object" || Array.isArray(value)) return false;
    const gameId = cleanGameId(value.gameId);
    const roomCode = cleanRoomCode(value.roomCode);
    const turnKey = String(value.turnKey || "");
    if(!gameId || !roomCode || !/^[A-Za-z0-9:._-]{1,80}$/.test(turnKey)) return false;
    const eventKey = `${gameId}:${roomCode}:${turnKey}`;
    if(deliveredTurnAlerts.has(eventKey)) return false;
    deliveredTurnAlerts.set(eventKey, Date.now());
    while(deliveredTurnAlerts.size > TURN_ROOM_LIMIT * 4) deliveredTurnAlerts.delete(deliveredTurnAlerts.keys().next().value);
    const detail = Object.freeze({ gameId, roomCode, turnKey });
    if(options.sound !== false) playTurnChime();
    if(options.notification !== false) showTurnNotification(detail);
    try{ root.dispatchEvent(new CustomEvent("arcadeturnalert", { detail })); }catch(_error){}
    return true;
  }

  function forgetRoomAlert(gameId, roomCode){
    const id = cleanGameId(gameId);
    const code = cleanRoomCode(roomCode);
    if(id && code){
      observedTurns.delete(`${id}:${code}`);
      const prefix = `${id}:${code}:`;
      for(const key of deliveredTurnAlerts.keys()) if(key.startsWith(prefix)) deliveredTurnAlerts.delete(key);
    }
  }

  function declareServiceWorkerMode(mode){
    declaredNetworkMode = mode === "nearby" ? "nearby" : "online";
    const serviceWorker = root.navigator && root.navigator.serviceWorker;
    if(!serviceWorker) return;
    const send = worker => {
      try{ worker && worker.postMessage({ type: "ARCADE_SET_NETWORK_MODE", mode: declaredNetworkMode }); }catch(_error){}
    };
    if(serviceWorker.controller) send(serviceWorker.controller);
    else serviceWorker.ready && Promise.resolve(serviceWorker.ready).then(registration => send(registration && registration.active)).catch(() => null);
  }

  function randomId(prefix){
    const bytes = new Uint8Array(12);
    if(!root.crypto || typeof root.crypto.getRandomValues !== "function") throw new Error("Secure random values are unavailable in this browser.");
    root.crypto.getRandomValues(bytes);
    return prefix + "_" + Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  }

  const frameId = randomId("frame");

  function byteLength(value){
    const text = typeof value === "string" ? value : JSON.stringify(value == null ? null : value);
    return textEncoder ? textEncoder.encode(text).byteLength : unescape(encodeURIComponent(text)).length;
  }

  function isRoomUrl(value){
    let url;
    try{ url = new URL(typeof value === "string" ? value : value && value.url, root.location.href); }
    catch(_error){ return null; }
    const comparableOrigin = url.protocol === "wss:" ? "https:" + url.origin.slice(4) : url.protocol === "ws:" ? "http:" + url.origin.slice(3) : url.origin;
    if(comparableOrigin !== WORKER_ORIGIN) return null;
    if(!/^\/api\/(?:arcade|chess)\/rooms(?:\/[^/?#]+(?:\/(?:join|state|actions|ws))?)?$/.test(url.pathname)) return null;
    return url;
  }

  function currentTransport(){
    return pinnedTransport || ((!bridgeAvailable && nearbyFrameRequested) || bridgeState.nearby ? "nearby" : "cloudflare");
  }

  function effectiveIdentity(){
    return currentTransport() === "nearby" ? bridgeState.identity : null;
  }

  function statusSnapshot(){
    const effectiveTransport = currentTransport();
    return Object.freeze({
      ...bridgeState,
      identity: effectiveTransport === "nearby" ? bridgeState.identity : null,
      pinnedTransport,
      effectiveTransport,
      effectiveNearby: effectiveTransport === "nearby"
    });
  }

  function emit(){
    const detail = statusSnapshot();
    for(const listener of listeners){
      try{ listener(detail); }catch(_error){}
    }
    try{ root.dispatchEvent(new CustomEvent("arcademultiplayerchange", { detail })); }catch(_error){}
  }

  function setBridgeState(value){
    if(!value || typeof value !== "object") return;
    const identity = value.identity && typeof value.identity === "object" ? Object.freeze({
      memberId: String(value.identity.memberId || ""),
      browserId: String(value.identity.browserId || ""),
      nickname: String(value.identity.nickname || "").slice(0, 24),
      avatar: String(value.identity.avatar || "").slice(0, 8),
      color: String(value.identity.color || "").slice(0, 32),
      host: value.identity.host === true
    }) : null;
    bridgeState = Object.freeze({
      transport: value.nearby === true ? "nearby" : "cloudflare",
      nearby: value.nearby === true,
      connected: Math.max(0, Math.min(8, Number(value.connected) || 0)),
      identity,
      status: String(value.status || (value.nearby ? "Nearby Arcade" : "Internet")).slice(0, 80)
    });
    bridgeAvailable = true;
    declareServiceWorkerMode(currentTransport() === "nearby" ? "nearby" : "online");
    emit();
  }

  function post(message){
    if(root.parent === root) return false;
    try{
      root.parent.postMessage({ ...message, scope: SCOPE, bridgeVersion: BRIDGE_VERSION, frameId }, root.location.origin);
      return true;
    }catch(_error){ return false; }
  }

  function abortError(signal){
    if(signal && signal.reason !== undefined) return signal.reason;
    return new DOMException("The operation was aborted.", "AbortError");
  }

  function settleRpc(requestId, entry, succeeded, value){
    if(!entry || pending.get(requestId) !== entry) return;
    pending.delete(requestId);
    root.clearTimeout(entry.timer);
    if(entry.signal && entry.abortHandler) entry.signal.removeEventListener("abort", entry.abortHandler);
    if(succeeded) entry.resolve(value);
    else entry.reject(value);
  }

  function rpc(operation, payload, timeoutMs, signal){
    if(!bridgeAvailable || root.parent === root) return Promise.reject(Object.assign(new Error("Nearby Arcade shell is unavailable."), { status: 503 }));
    if(byteLength(payload) > MAX_NEARBY_BODY_BYTES) return Promise.reject(Object.assign(new Error("Nearby request is too large."), { status: 413 }));
    if(signal && signal.aborted) return Promise.reject(abortError(signal));
    const requestId = frameId + ":" + (++sequence);
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: 0, signal: signal || null, abortHandler: null };
      entry.timer = root.setTimeout(() => settleRpc(requestId, entry, false, Object.assign(new Error("Nearby Arcade did not respond in time."), { status: 504 })), timeoutMs || 10000);
      if(signal){
        entry.abortHandler = () => settleRpc(requestId, entry, false, abortError(signal));
        signal.addEventListener("abort", entry.abortHandler, { once: true });
      }
      pending.set(requestId, entry);
      if(!post({ type: "rpc", requestId, operation, payload })){
        settleRpc(requestId, entry, false, Object.assign(new Error("Nearby Arcade shell is unavailable."), { status: 503 }));
      }
    });
  }

  function waitForHandshake(signal){
    if(signal && signal.aborted) return Promise.reject(abortError(signal));
    if(bridgeAvailable || root.parent === root) return Promise.resolve(bridgeAvailable);
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = 0;
      const cleanup = () => {
        listeners.delete(check);
        if(timer) root.clearTimeout(timer);
        if(signal) signal.removeEventListener("abort", abort);
      };
      const finish = () => { if(settled) return; settled = true; cleanup(); resolve(bridgeAvailable); };
      const check = () => finish();
      const abort = () => { if(settled) return; settled = true; cleanup(); reject(abortError(signal)); };
      listeners.add(check);
      timer = root.setTimeout(finish, HANDSHAKE_TIMEOUT_MS);
      if(signal) signal.addEventListener("abort", abort, { once: true });
      post({ type: "hello" });
    });
  }

  function headersObject(headers){
    const output = {};
    try{
      const source = new Headers(headers || {});
      source.forEach((value, key) => { output[key.toLowerCase()] = value; });
    }catch(_error){}
    return output;
  }

  function requestSignal(input, init){
    if(init && Object.hasOwn(init, "signal") && init.signal) return init.signal;
    return input && input.signal ? input.signal : null;
  }

  async function requestBody(input, init){
    if(init && Object.hasOwn(init, "body")){
      if(init.body == null) return null;
      if(typeof init.body !== "string") throw Object.assign(new TypeError("Nearby room requests require a text JSON body."), { status: 400 });
      return init.body;
    }
    if(!input || input.body == null) return null;
    if(typeof input.clone !== "function") throw Object.assign(new TypeError("Nearby room Request bodies must be cloneable."), { status: 400 });
    try{ return await input.clone().text(); }
    catch(_error){ throw Object.assign(new TypeError("Nearby room Request body is unavailable."), { status: 400 }); }
  }

  async function requestParts(input, init){
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const headers = headersObject((init && init.headers) || (input && input.headers));
    const body = await requestBody(input, init);
    if(body !== null && byteLength(body) > MAX_BODY_BYTES) throw Object.assign(new Error("Nearby request is too large."), { status: 413 });
    return { method, headers, body, signal: requestSignal(input, init) };
  }

  function bodyActionType(body){
    if(typeof body !== "string" || !body) return "";
    try{ const value = JSON.parse(body); return value && typeof value.type === "string" ? value.type : ""; }
    catch(_error){ return ""; }
  }

  function pinRoomTransport(requestedTransport){
    if(requestedTransport === undefined && pinnedTransport) return pinnedTransport;
    let selected = requestedTransport;
    if(selected !== undefined && selected !== "nearby" && selected !== "cloudflare") throw new TypeError("Room transport must be 'nearby' or 'cloudflare'.");
    if(selected === undefined) selected = currentTransport();
    if(pinnedTransport && pinnedTransport !== selected) throw new DOMException("This room is already pinned to a different authority.", "InvalidStateError");
    // A saved Internet room must not be allowed to turn a shell-launched
    // Nearby frame back into an Internet client.  Keep an already-live
    // Cloudflare room pinned (it may have been opened before Nearby started),
    // but require the user to leave Nearby before beginning a new resume.
    const awaitingNearbyShell = root.parent !== root && nearbyFrameRequested && !bridgeAvailable;
    if(!pinnedTransport && selected === "cloudflare" && (awaitingNearbyShell || (bridgeAvailable && bridgeState.nearby))){
      throw Object.assign(new Error("Disconnect Nearby Arcade to resume this Internet room."), {
        code: "nearby_internet_room_blocked",
        status: 409
      });
    }
    if(!pinnedTransport){
      pinnedTransport = selected;
      declareServiceWorkerMode(selected === "nearby" ? "nearby" : "online");
      emit();
    }
    return pinnedTransport;
  }

  function terminalLeaveResponse(actionType, response){
    return actionType === "leave" && response && (response.ok || [401, 403, 404, 410].includes(Number(response.status)));
  }

  async function arcadeFetch(input, init){
    const url = isRoomUrl(input);
    if(!url || !nativeFetch) return nativeFetch(input, init);
    const options = init || {};
    const signal = requestSignal(input, options);
    await waitForHandshake(signal);
    pinRoomTransport();
    if(currentTransport() !== "nearby"){
      let actionType = "";
      try{ actionType = bodyActionType(await requestBody(input, options)); }catch(_error){}
      const response = await nativeFetch(input, init);
      if(terminalLeaveResponse(actionType, response)) resetRoomTransport();
      return response;
    }
    const parts = await requestParts(input, options);
    if(parts.signal && parts.signal.aborted) throw abortError(parts.signal);
    let result;
    try{
      result = await rpc("http", {
        url: url.pathname + url.search,
        method: parts.method,
        headers: parts.headers,
        body: parts.body
      }, 12000, parts.signal);
    }catch(error){
      if((parts.signal && parts.signal.aborted) || (error && error.name === "AbortError")) throw error;
      const status = Number(error && error.status) || 503;
      return new Response(JSON.stringify({ ok: false, error: error && error.message ? error.message : "Nearby Arcade request failed." }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
      });
    }
    const response = new Response(JSON.stringify(result && result.body !== undefined ? result.body : result), {
      status: Number(result && result.status) || 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
    if(terminalLeaveResponse(bodyActionType(parts.body), response)) resetRoomTransport();
    return response;
  }

  class NearbyWebSocket {
    constructor(url){
      this.url = String(url || "");
      this.protocol = "";
      this.extensions = "";
      this.binaryType = "blob";
      this.bufferedAmount = 0;
      this.readyState = NearbyWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this._listeners = new Map();
      this._socketId = randomId("socket");
      this._hostOpened = false;
      this._closeRequest = null;
      this._closePromise = null;
      sockets.set(this._socketId, this);
      Promise.resolve().then(async() => {
        try{
          const parsed = isRoomUrl(this.url);
          if(!parsed || !/\/ws$/.test(parsed.pathname)) throw Object.assign(new Error("Invalid Nearby room socket."), { status: 400 });
          if(this.readyState !== NearbyWebSocket.CONNECTING){
            const requested = this._closeRequest || { code: 1000, reason: "" };
            this._finishClose(requested.code, requested.reason, true);
            return;
          }
          await rpc("ws-open", { socketId: this._socketId, url: parsed.pathname + parsed.search }, 8000);
          this._hostOpened = true;
          if(this.readyState === NearbyWebSocket.CLOSING){ this._closeHost(); return; }
          if(this.readyState !== NearbyWebSocket.CONNECTING) return;
          this.readyState = NearbyWebSocket.OPEN;
          this._dispatch("open", { type: "open", target: this });
        }catch(error){
          if(this.readyState === NearbyWebSocket.CLOSING){
            const requested = this._closeRequest || { code: 1000, reason: "" };
            this._finishClose(requested.code, requested.reason, false);
            return;
          }
          if(this.readyState !== NearbyWebSocket.CONNECTING) return;
          this._dispatch("error", { type: "error", target: this, error });
          this._finishClose(1006, "Nearby connection unavailable", false);
        }
      });
    }

    addEventListener(type, listener){
      if(typeof listener !== "function") return;
      if(!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(listener);
    }
    removeEventListener(type, listener){ const set = this._listeners.get(type); if(set) set.delete(listener); }
    _dispatch(type, event){
      const handler = this["on" + type];
      if(typeof handler === "function"){ try{ handler.call(this, event); }catch(error){ root.setTimeout(() => { throw error; }); } }
      const set = this._listeners.get(type);
      if(set) for(const listener of [...set]){ try{ listener.call(this, event); }catch(error){ root.setTimeout(() => { throw error; }); } }
    }
    send(data){
      if(this.readyState !== NearbyWebSocket.OPEN) throw new DOMException("WebSocket is not open", "InvalidStateError");
      if(typeof data !== "string" || byteLength(data) > MAX_NEARBY_BODY_BYTES) throw new TypeError("Nearby sockets accept bounded text messages only.");
      rpc("ws-send", { socketId: this._socketId, data }, 10000).catch(error => this._dispatch("error", { type: "error", target: this, error }));
    }
    close(code, reason){
      if(this.readyState === NearbyWebSocket.CLOSED || this.readyState === NearbyWebSocket.CLOSING) return;
      this._closeRequest = { code: code || 1000, reason: String(reason || "") };
      this.readyState = NearbyWebSocket.CLOSING;
      if(this._hostOpened) this._closeHost();
    }
    _closeHost(){
      if(this._closePromise || !this._hostOpened) return;
      const requested = this._closeRequest || { code: 1000, reason: "" };
      this._closePromise = rpc("ws-close", { socketId: this._socketId }, 3000)
        .catch(() => null)
        .finally(() => this._finishClose(requested.code, requested.reason, true));
    }
    _message(data){ if(this.readyState === NearbyWebSocket.OPEN) this._dispatch("message", { type: "message", target: this, data: String(data) }); }
    _finishClose(code, reason, clean){
      if(this.readyState === NearbyWebSocket.CLOSED) return;
      this.readyState = NearbyWebSocket.CLOSED;
      sockets.delete(this._socketId);
      this._dispatch("close", { type: "close", target: this, code: Number(code) || 1000, reason: String(reason || ""), wasClean: clean === true });
    }
  }
  NearbyWebSocket.CONNECTING = 0;
  NearbyWebSocket.OPEN = 1;
  NearbyWebSocket.CLOSING = 2;
  NearbyWebSocket.CLOSED = 3;

  class DeferredRoomWebSocket {
    constructor(url, protocols){
      this.url = String(url || "");
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this._listeners = new Map();
      this._socket = null;
      this._protocols = protocols;
      this._binaryType = "blob";
      this._readyState = DeferredRoomWebSocket.CONNECTING;
      this._closedBeforeOpen = false;
      Promise.resolve().then(async() => {
        try{
          await waitForHandshake();
          if(this._closedBeforeOpen){
            this._finishClose(1000, "", true);
            return;
          }
          pinRoomTransport();
          const socket = currentTransport() === "nearby"
            ? new NearbyWebSocket(this.url)
            : (this._protocols === undefined ? new NativeWebSocket(this.url) : new NativeWebSocket(this.url, this._protocols));
          this._socket = socket;
          try{ socket.binaryType = this._binaryType; }catch(_error){}
          socket.addEventListener("open", event => {
            if(this._socket !== socket || this._readyState !== DeferredRoomWebSocket.CONNECTING) return;
            this._readyState = DeferredRoomWebSocket.OPEN;
            this._dispatch("open", this._forwardedEvent("open", event));
          });
          socket.addEventListener("message", event => {
            if(this._socket !== socket || this._readyState !== DeferredRoomWebSocket.OPEN) return;
            this._dispatch("message", this._forwardedEvent("message", event));
          });
          socket.addEventListener("error", event => {
            if(this._socket !== socket || this._readyState === DeferredRoomWebSocket.CLOSED) return;
            this._dispatch("error", this._forwardedEvent("error", event));
          });
          socket.addEventListener("close", event => {
            if(this._socket !== socket) return;
            this._finishClose(Number(event && event.code) || 1000, String(event && event.reason || ""), !!(event && event.wasClean), event);
          });
        }catch(error){
          if(this._readyState === DeferredRoomWebSocket.CLOSED) return;
          this._dispatch("error", { type: "error", target: this, currentTarget: this, error });
          this._finishClose(1006, "Connection unavailable", false);
        }
      });
    }

    get protocol(){ return this._socket ? String(this._socket.protocol || "") : ""; }
    get extensions(){ return this._socket ? String(this._socket.extensions || "") : ""; }
    get readyState(){ return this._readyState; }
    get bufferedAmount(){ return this._socket ? Number(this._socket.bufferedAmount) || 0 : 0; }
    get binaryType(){ return this._socket ? this._socket.binaryType : this._binaryType; }
    set binaryType(value){
      this._binaryType = value;
      if(this._socket) this._socket.binaryType = value;
    }
    addEventListener(type, listener){
      if(typeof listener !== "function") return;
      if(!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(listener);
    }
    removeEventListener(type, listener){ const set = this._listeners.get(type); if(set) set.delete(listener); }
    dispatchEvent(event){
      if(!event || typeof event.type !== "string") throw new TypeError("Invalid event");
      this._dispatch(event.type, event);
      return event.defaultPrevented !== true;
    }
    _forwardedEvent(type, event){
      const forwarded = { type, target: this, currentTarget: this };
      if(type === "message"){
        forwarded.data = event && event.data;
        forwarded.origin = String(event && event.origin || "");
        forwarded.lastEventId = String(event && event.lastEventId || "");
        forwarded.source = event && event.source || null;
        forwarded.ports = event && event.ports || [];
      }else if(type === "close"){
        forwarded.code = Number(event && event.code) || 1000;
        forwarded.reason = String(event && event.reason || "");
        forwarded.wasClean = !!(event && event.wasClean);
      }else if(type === "error"){
        forwarded.error = event && event.error;
        forwarded.message = String(event && event.message || "");
      }
      return forwarded;
    }
    _dispatch(type, event){
      const handler = this["on" + type];
      if(typeof handler === "function"){ try{ handler.call(this, event); }catch(error){ root.setTimeout(() => { throw error; }); } }
      const set = this._listeners.get(type);
      if(set) for(const listener of [...set]){ try{ listener.call(this, event); }catch(error){ root.setTimeout(() => { throw error; }); } }
    }
    send(data){
      if(this._readyState !== DeferredRoomWebSocket.OPEN || !this._socket) throw new DOMException("WebSocket is not open", "InvalidStateError");
      return this._socket.send(data);
    }
    close(code, reason){
      if(this._readyState === DeferredRoomWebSocket.CLOSED || this._readyState === DeferredRoomWebSocket.CLOSING) return;
      this._readyState = DeferredRoomWebSocket.CLOSING;
      if(!this._socket){ this._closedBeforeOpen = true; return; }
      this._socket.close(code, reason);
    }
    _finishClose(code, reason, clean, sourceEvent){
      if(this._readyState === DeferredRoomWebSocket.CLOSED) return;
      this._readyState = DeferredRoomWebSocket.CLOSED;
      this._socket = null;
      this._dispatch("close", sourceEvent ? this._forwardedEvent("close", sourceEvent) : {
        type: "close", target: this, currentTarget: this,
        code: Number(code) || 1000, reason: String(reason || ""), wasClean: clean === true
      });
    }
  }
  DeferredRoomWebSocket.CONNECTING = 0;
  DeferredRoomWebSocket.OPEN = 1;
  DeferredRoomWebSocket.CLOSING = 2;
  DeferredRoomWebSocket.CLOSED = 3;

  function RoutedWebSocket(url, protocols){
    const parsed = isRoomUrl(url);
    if(parsed && /\/ws$/.test(parsed.pathname)){
      if(root.parent !== root && !bridgeAvailable) return new DeferredRoomWebSocket(url, protocols);
      pinRoomTransport();
      if(currentTransport() === "nearby") return new NearbyWebSocket(url);
    }
    if(typeof NativeWebSocket !== "function") throw new TypeError("WebSocket is unavailable");
    return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
  }
  RoutedWebSocket.CONNECTING = 0;
  RoutedWebSocket.OPEN = 1;
  RoutedWebSocket.CLOSING = 2;
  RoutedWebSocket.CLOSED = 3;
  RoutedWebSocket.prototype = NativeWebSocket && NativeWebSocket.prototype ? NativeWebSocket.prototype : NearbyWebSocket.prototype;

  function receive(event){
    if(event.origin !== root.location.origin || event.source !== root.parent) return;
    const message = event.data;
    if(!message || typeof message !== "object" || message.scope !== SCOPE || message.bridgeVersion !== BRIDGE_VERSION || message.frameId !== frameId) return;
    if(byteLength(message) > 112 * 1024) return;
    if(message.type === "hello-result" || message.type === "transport-state"){
      setBridgeState(message.state || message);
      return;
    }
    if(message.type === "rpc-result"){
      const requestId = String(message.requestId || "");
      const entry = pending.get(requestId);
      if(!entry) return;
      if(message.ok === false){
        const error = Object.assign(new Error(String(message.error || "Nearby Arcade request failed.")), { status: Number(message.status) || 500 });
        settleRpc(requestId, entry, false, error);
      }else settleRpc(requestId, entry, true, message.result);
      return;
    }
    if(message.type === "ws-message"){
      const socket = sockets.get(String(message.socketId || ""));
      if(socket && typeof message.data === "string") socket._message(message.data);
      return;
    }
    if(message.type === "ws-close"){
      const socket = sockets.get(String(message.socketId || ""));
      if(socket) socket._finishClose(Number(message.code) || 1000, String(message.reason || ""), message.clean !== false);
      return;
    }
    if(message.type === "invitation"){
      try{ root.dispatchEvent(new CustomEvent("arcadegameinvitation", { detail: message.invitation || null })); }catch(_error){}
    }
  }

  function goHome(){
    if(bridgeAvailable && post({ type: "home" })) return true;
    root.location.href = "../index.html";
    return false;
  }

  function openGame(gameId, roomCode){
    return bridgeAvailable && post({ type: "open-game", gameId: String(gameId || "").slice(0, 40), roomCode: String(roomCode || "").slice(0, 12) });
  }

  function invite(gameId, roomCode, label){
    if(!bridgeAvailable || currentTransport() !== "nearby") return false;
    return post({ type: "invite", gameId: String(gameId || "").slice(0, 40), roomCode: String(roomCode || "").slice(0, 12), label: String(label || "").slice(0, 80) });
  }

  function gameCompleted(details){
    if(!bridgeAvailable || currentTransport() !== "nearby" || !details || typeof details !== "object") return false;
    return post({ type: "game-completed", details: {
      gameId: String(details.gameId || "").slice(0, 40),
      roomCode: String(details.roomCode || "").slice(0, 12),
      winnerPlayerId: details.winnerPlayerId == null ? null : String(details.winnerPlayerId).slice(0, 80),
      tie: details.tie === true,
      version: Number(details.version) || 0
    }});
  }

  function onStatus(listener){
    if(typeof listener !== "function") return () => {};
    listeners.add(listener);
    try{ listener(statusSnapshot()); }catch(_error){}
    return () => listeners.delete(listener);
  }

  function resetRoomTransport(){
    pinnedTransport = null;
    observedTurns.clear();
    deliveredTurnAlerts.clear();
    declareServiceWorkerMode(currentTransport() === "nearby" ? "nearby" : "online");
    emit();
  }

  root.addEventListener("message", receive);
  root.addEventListener("pointerdown", primeTurnAlerts, { passive: true });
  root.addEventListener("keydown", primeTurnAlerts);
  root.addEventListener("storage", event => {
    if(event && (event.key === TURN_SOUND_KEY || event.key === TURN_NOTIFICATIONS_KEY)) emitTurnSettings();
  });
  root.document?.addEventListener?.("visibilitychange", () => emitTurnSettings());
  if(root.navigator && root.navigator.serviceWorker){
    root.navigator.serviceWorker.addEventListener("controllerchange", () => declareServiceWorkerMode(declaredNetworkMode));
  }
  root.addEventListener("arcadepause", () => declareServiceWorkerMode("online"));
  root.addEventListener("pagehide", () => declareServiceWorkerMode("online"));
  if(nativeFetch) root.fetch = arcadeFetch;
  if(typeof NativeWebSocket === "function") root.WebSocket = RoutedWebSocket;
  root.ArcadeMultiplayer = Object.freeze({
    protocolVersion: BRIDGE_VERSION,
    workerOrigin: WORKER_ORIGIN,
    ready: waitForHandshake,
    getStatus: statusSnapshot,
    getIdentity: effectiveIdentity,
    preferredUsername: fallback => effectiveIdentity() ? effectiveIdentity().nickname : String(fallback || ""),
    onStatus,
    goHome,
    openGame,
    invite,
    gameCompleted,
    observeRoom,
    deliverTurnAlert,
    forgetRoomAlert,
    primeTurnAlerts,
    getTurnAlertSettings: turnAlertSettings,
    setTurnSoundEnabled,
    setTurnNotificationsEnabled,
    requestTurnNotifications,
    pinRoomTransport,
    resetRoomTransport
  });
  declareServiceWorkerMode(declaredNetworkMode);
  post({ type: "hello" });
})(typeof window !== "undefined" ? window : globalThis);
