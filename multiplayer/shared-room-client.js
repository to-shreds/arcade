(function(root, factory){
  const api = factory(root);
  if(typeof module === "object" && module.exports) module.exports = api;
  else root.ArcadeSharedRoomClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(root){
  "use strict";
  // Network deadlines and reconnects continue while the game simulation is frozen.
  const clientLater = root.setTimeout.bind(root);
  const clientCancel = root.clearTimeout.bind(root);
  const clientEvery = root.setInterval.bind(root);

  const DEFAULT_BASE = "https://arcade-chess.jonathanjablon.workers.dev";
  const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

  function cleanCode(value){
    const code = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return CODE_PATTERN.test(code) ? code : "";
  }

  function cleanUsername(value){
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 20);
  }

  function cleanTransport(value, allowLegacy){
    if((value === undefined || value === null || value === "") && allowLegacy) return "cloudflare";
    return value === "nearby" || value === "cloudflare" ? value : "";
  }

  function storedSession(storage, key){
    try{
      const value = JSON.parse(storage.getItem(key) || "null");
      if(!value || !cleanCode(value.code) || typeof value.token !== "string" || value.token.length < 16) return null;
      const transport = cleanTransport(value.transport, true);
      if(!transport) return null;
      return {
        code: cleanCode(value.code),
        token: value.token,
        playerId: String(value.playerId || ""),
        seat: Number(value.seat) || 0,
        username: cleanUsername(value.username),
        transport
      };
    }catch(_error){ return null; }
  }

  function createRoomClient(options){
    const settings = options || {};
    const base = String(settings.base || DEFAULT_BASE).replace(/\/$/, "");
    const game = String(settings.game || "").trim();
    const sessionKey = String(settings.sessionKey || ("arcade_room_" + game + "_v1"));
    const storage = settings.storage || root.localStorage;
    const fetchImpl = settings.fetch || root.fetch.bind(root);
    const WebSocketImpl = settings.WebSocket || root.WebSocket;
    const onRoom = typeof settings.onRoom === "function" ? settings.onRoom : function(){};
    const onStatus = typeof settings.onStatus === "function" ? settings.onStatus : function(){};
    const onSession = typeof settings.onSession === "function" ? settings.onSession : function(){};
    const multiplayer = settings.multiplayer || root.ArcadeMultiplayer || null;
    let session = null;
    let room = null;
    let socket = null;
    let stopped = true;
    let retryTimer = 0;
    let pollTimer = 0;
    let retryCount = 0;
    let requestBusy = false;
    let pendingAction = null;
    let sessionEpoch = 0;

    function finishAction(error){
      if(!pendingAction) return;
      const pending=pendingAction;pendingAction=null;clientCancel(pending.timer);
      if(error)pending.reject(error);else pending.resolve(room);
    }

    function emitStatus(kind, text){ onStatus({ kind, text: String(text || "") }); }

    function persist(){
      try{
        if(session) storage.setItem(sessionKey, JSON.stringify(session));
        else storage.removeItem(sessionKey);
      }catch(_error){}
      onSession(session ? Object.assign({}, session) : null);
    }

    function saved(){ return storedSession(storage, sessionKey); }

    function currentRoomTransport(){
      const status = multiplayer && typeof multiplayer.getStatus === "function" ? multiplayer.getStatus() : null;
      return cleanTransport(status && (status.pinnedTransport || status.effectiveTransport || (status.nearby ? "nearby" : "cloudflare")), false) || "cloudflare";
    }

    function pinSavedRoomTransport(transport){
      const selected = cleanTransport(transport, false);
      if(!selected) throw new TypeError("Saved room transport is invalid.");
      if(multiplayer && typeof multiplayer.pinRoomTransport === "function") return multiplayer.pinRoomTransport(selected);
      if(selected === "nearby") throw new Error("Nearby Arcade is unavailable. This saved room will not be sent to the Internet.");
      return selected;
    }

    function resetRoomTransport(){ if(multiplayer && typeof multiplayer.resetRoomTransport === "function") multiplayer.resetRoomTransport(); }

    function recoverExistingConnection(){
      if(!session){ resetRoomTransport(); return; }
      if(!stopped && socket?.readyState === 1) emitStatus("connected", "Connected to room " + session.code + ".");
      else if(!stopped) scheduleReconnect();
    }

    async function request(path, init, timeoutMs){
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? clientLater(function(){ controller.abort(); }, timeoutMs || 8000) : 0;
      try{
        const response = await fetchImpl(base + path, Object.assign({}, init || {}, controller ? { signal: controller.signal } : {}));
        let body = null;
        try{ body = await response.json(); }catch(_error){}
        if(!response.ok || !body || body.ok === false){
          const error = new Error(body && body.error ? body.error : ("Request failed (" + response.status + ")"));
          error.status = response.status;
          throw error;
        }
        return body;
      }catch(error){
        if(error && error.name === "AbortError"){
          const timeout = new Error("The room server did not respond in time.");
          timeout.status = 408;
          throw timeout;
        }
        throw error;
      }finally{ if(timer) clientCancel(timer); }
    }

    function absorb(nextRoom){
      if(!nextRoom || typeof nextRoom !== "object") return;
      if(room){
        const incomingVersion = Number(nextRoom.version) || 0;
        const currentVersion = Number(room.version) || 0;
        const incomingRevision = Number(nextRoom.revision == null ? nextRoom.version : nextRoom.revision) || 0;
        const currentRevision = Number(room.revision == null ? room.version : room.revision) || 0;
        if(incomingVersion < currentVersion || (incomingVersion === currentVersion && incomingRevision < currentRevision)) return;
      }
      room = nextRoom;
      if(session){
        session.playerId = String(nextRoom.playerId || session.playerId || "");
        const member = Array.isArray(nextRoom.members) ? nextRoom.members.find(function(item){ return item.playerId === session.playerId; }) : null;
        session.seat = Number(nextRoom.seat || (member && member.seat) || session.seat) || 0;
        persist();
      }
      retryCount = 0;
      onRoom(nextRoom, session ? Object.assign({}, session) : null);
    }

    function closeSocket(){
      finishAction(Object.assign(new Error("The room connection changed. Refresh before trying again."), { status: 409 }));
      if(retryTimer){ clientCancel(retryTimer); retryTimer = 0; }
      if(pollTimer){ clientCancel(pollTimer); pollTimer = 0; }
      if(socket){
        const old = socket;
        socket = null;
        try{ old.onopen = old.onclose = old.onerror = old.onmessage = null; old.close(1000, "Leaving room"); }catch(_error){}
      }
    }

    function schedulePoll(delay){
      if(stopped || !session) return;
      if(pollTimer) clientCancel(pollTimer);
      pollTimer = clientLater(async function(){
        pollTimer = 0;
        try{ await refresh(); }
        catch(_error){}
        if(!socket || socket.readyState !== 1) schedulePoll(3000);
      }, delay == null ? 0 : delay);
    }

    function scheduleReconnect(){
      if(stopped || !session || retryTimer) return;
      if(session.transport !== "nearby" && root.navigator?.onLine === false){emitStatus("offline", "Shared play paused. This device is offline.");return;}
      retryCount++;
      const delay = Math.min(8000, 500 * Math.pow(2, Math.min(4, retryCount - 1)));
      emitStatus("reconnecting", "Connection interrupted. Reconnecting…");
      schedulePoll(0);
      retryTimer = clientLater(function(){ retryTimer = 0; connectSocket(); }, delay);
    }

    function connectSocket(){
      if(stopped || !session) return;
      if(session.transport !== "nearby" && root.navigator?.onLine === false){emitStatus("offline", "Shared play paused. This device is offline.");return;}
      if(!WebSocketImpl){ schedulePoll(0); return; }
      closeSocket();
      const wsBase = base.replace(/^http/i, "ws");
      let opened = false;
      try{
        socket = new WebSocketImpl(wsBase + "/api/arcade/rooms/" + encodeURIComponent(session.code) + "/ws?token=" + encodeURIComponent(session.token));
      }catch(_error){ scheduleReconnect(); return; }
      const activeSocket = socket;
      const timeout = clientLater(function(){
        if(activeSocket === socket && !opened){ try{ activeSocket.close(); }catch(_error){} }
      }, 7000);
      activeSocket.onopen = function(){
        opened = true;
        clientCancel(timeout);
        retryCount = 0;
        emitStatus("connected", "Connected to room " + session.code + ".");
      };
      activeSocket.onmessage = function(event){
        if(socket !== activeSocket || stopped)return;
        try{
          const message = JSON.parse(event.data);
          if(message.type === "state" && message.room) absorb(message.room);
          else if(message.type === "ack" && pendingAction && Number(message.version) >= pendingAction.version) finishAction();
          else if(message.type === "error"){
            const error=Object.assign(new Error(message.error || "Room action failed."),{status:Number(message.status)||400});
            finishAction(error);emitStatus("error",error.message);
          }
        }catch(_error){}
      };
      activeSocket.onerror = function(){};
      activeSocket.onclose = function(){
        if(socket !== activeSocket || stopped){clientCancel(timeout);return;}
        finishAction(Object.assign(new Error("Shared play paused. The room connection was interrupted."),{status:503}));
        clientCancel(timeout);
        if(socket === activeSocket) socket = null;
        scheduleReconnect();
      };
    }

    function acceptJoin(body, username, restoredTransport, requestedEpoch){
      if(requestedEpoch !== sessionEpoch)throw Object.assign(new Error("This room request was cancelled or replaced."),{status:409});
      if(settings.activity && (body.room?.game !== game || body.room?.state?.activity !== settings.activity))throw Object.assign(new Error("This room belongs to another activity."),{status:409});
      const transport = cleanTransport(restoredTransport, false) || currentRoomTransport();
      const nextSession = {
        code: cleanCode(body.code || (body.room && body.room.code)),
        token: String(body.token || ""),
        playerId: String(body.playerId || ""),
        seat: Number(body.seat) || 0,
        username: cleanUsername(username),
        transport
      };
      if(!nextSession.code || nextSession.token.length < 16) throw new Error("The room server returned an invalid session.");
      session = nextSession;
      room = null;
      sessionEpoch++;
      stopped = false;
      persist();
      if(body.room) absorb(body.room);
      connectSocket();
      return body;
    }

    async function create(params){
      if(requestBusy) throw new Error("A room request is already in progress.");
      requestBusy = true;
      const username = cleanUsername(params && params.username);
      if(!username) { requestBusy = false; throw new Error("Enter a username first."); }
      emitStatus("connecting", "Creating room…");
      const requestedEpoch=sessionEpoch;
      try{
        const payload = { game, username, maxPlayers: Math.max(2, Math.min(8, Number(params && params.maxPlayers) || 2)) };
        if(params && params.state !== undefined) payload.state = params.state;
        return acceptJoin(await request("/api/arcade/rooms", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
        }), username, undefined, requestedEpoch);
      }catch(error){
        recoverExistingConnection();
        throw error;
      }finally{ requestBusy = false; }
    }

    async function join(params){
      if(requestBusy) throw new Error("A room request is already in progress.");
      requestBusy = true;
      const username = cleanUsername(params && params.username);
      const code = cleanCode(params && params.code);
      if(!username) { requestBusy = false; throw new Error("Enter a username first."); }
      if(!code) { requestBusy = false; throw new Error("Enter the six-character room code."); }
      emitStatus("connecting", "Joining room " + code + "…");
      const requestedEpoch=sessionEpoch;
      try{
        return acceptJoin(await request("/api/arcade/rooms/" + encodeURIComponent(code) + "/join", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, ...(settings.activity?{activity:settings.activity}:{}) })
        }), username, undefined, requestedEpoch);
      }catch(error){
        recoverExistingConnection();
        throw error;
      }finally{ requestBusy = false; }
    }

    async function resume(){
      if(requestBusy) throw new Error("A room request is already in progress.");
      const prior = saved();
      if(!prior) throw new Error("No saved room is available.");
      requestBusy = true;
      emitStatus("connecting", "Rejoining room " + prior.code + "…");
      const requestedEpoch=sessionEpoch;
      try{
        pinSavedRoomTransport(prior.transport);
        return acceptJoin(await request("/api/arcade/rooms/" + encodeURIComponent(prior.code) + "/join", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: prior.username || "Player", reconnectToken: prior.token, ...(settings.activity?{activity:settings.activity}:{}) })
        }), prior.username || "Player", prior.transport, requestedEpoch);
      }catch(error){
        if(requestedEpoch===sessionEpoch && error && (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 410)) forget();
        else recoverExistingConnection();
        throw error;
      }finally{ requestBusy = false; }
    }

    async function refresh(){
      if(!session) throw new Error("Join a room first.");
      const requestedSession=session;
      const body = await request("/api/arcade/rooms/" + encodeURIComponent(requestedSession.code) + "/state", {
        headers: { Authorization: "Bearer " + requestedSession.token }
      });
      if(body.room && session===requestedSession && !stopped) absorb(body.room);
      return body.room;
    }

    async function action(value){
      if(!session || !room) throw new Error("Join a room first.");
      const requestedSession=session;
      const payload = Object.assign({}, value || {});
      if(payload.type !== "chat" && payload.expectedVersion == null) payload.expectedVersion = Number(room.version);
      try{
        if(socket && socket.readyState === 1){
          if(pendingAction)throw Object.assign(new Error("Wait for the previous shared move to finish."),{status:409});
          return await new Promise(function(resolve,reject){
            const timer=clientLater(function(){finishAction(Object.assign(new Error("Shared move was not confirmed. Refresh before trying again."),{status:408}));},8000);
            pendingAction={resolve,reject,timer,version:Number(payload.expectedVersion)+1};
            try{socket.send(JSON.stringify(payload));}catch(error){finishAction(error);}
          });
        }
        const body = await request("/api/arcade/rooms/" + encodeURIComponent(session.code) + "/actions", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: "Bearer " + session.token },
          body: JSON.stringify(payload)
        });
        if(body.room && session===requestedSession && !stopped) absorb(body.room);
        return body.room;
      }catch(error){
        if(error && error.status === 409){ try{ await refresh(); }catch(_refreshError){} }
        throw error;
      }
    }

    async function leave(){
      if(!session){ forget(); return null; }
      const requestedSession=session;
      try{
        const body = await request("/api/arcade/rooms/" + encodeURIComponent(session.code) + "/actions", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: "Bearer " + session.token },
          body: JSON.stringify({ type: "leave" })
        });
        if(session===requestedSession)forget();
        return body.room || null;
      }catch(error){
        if(error && (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 410)){ if(session===requestedSession)forget(); return null; }
        throw error;
      }
    }

    function forget(){
      sessionEpoch++;
      stopped = true;
      closeSocket();
      session = null;
      room = null;
      persist();
      resetRoomTransport();
      emitStatus("offline", "Online room closed on this device.");
    }

    function disconnect(){ stopped = true; closeSocket(); }

    root.addEventListener?.("offline",function(){
      if(stopped || !session || session.transport === "nearby")return;
      closeSocket();emitStatus("offline", "Shared play paused. This device is offline.");
    });
    root.addEventListener?.("online",function(){
      if(stopped || !session || session.transport === "nearby")return;
      emitStatus("reconnecting", "Connection restored. Reconnecting…");connectSocket();
    });

    // Some browsers/transports can remain in CLOSING without delivering a close
    // event. The game must pause and reconnect even when that handshake stalls.
    clientEvery(function(){
      if(!stopped && session && socket && (socket.readyState===2 || socket.readyState===3)){
        closeSocket();scheduleReconnect();
      }
    },1000);

    return {
      create, join, resume, refresh, action, leave, forget, disconnect, saved,
      getConnectionState:()=>({stopped,readyState:socket?.readyState??3,retrying:!!retryTimer,polling:!!pollTimer}),
      cleanCode, cleanUsername,
      get room(){ return room; },
      get session(){ return session ? Object.assign({}, session) : null; }
    };
  }

  return { createRoomClient, cleanCode, cleanUsername, storedSession, DEFAULT_BASE };
});
