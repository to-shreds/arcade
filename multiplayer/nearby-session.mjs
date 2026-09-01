import {
  MAX_NEARBY_PLAYERS,
  MAX_NEARBY_IDENTITIES,
  NearbyIdentityRegistry,
  ReactionRateLimiter,
  cleanAvatar,
  cleanColor,
  cleanNickname,
  randomId,
  sessionLabel,
  validReaction
} from "./arcade-shell-core.mjs";
import { MESSAGE_LIMITS, NEARBY_PROTOCOL_VERSION, assertSafeId, makeNearbyEnvelope, utf8ByteLength, validateNearbyMessage } from "./protocol.mjs";

const DATA_CHANNEL_LABEL = "arcade-nearby-v1";
const HEARTBEAT_MS = 9000;
const LOST_AFTER_MS = 15000;
const RPC_TIMEOUT_MS = 12000;
const MAX_DATA_CHANNEL_BUFFERED_BYTES = 512 * 1024;
const SESSION_CHECKPOINT_SCHEMA = 1;
const NEARBY_QR_FRAME_CHARS = 600;
const INBOUND_TRAFFIC_WINDOW_MS = 10_000;
const MAX_INBOUND_MESSAGES_PER_WINDOW = 160;
const MAX_INBOUND_BYTES_PER_WINDOW = 2 * 1024 * 1024;
const MAX_INVALID_MESSAGES_PER_WINDOW = 6;
const GUEST_TO_HOST_MESSAGE_TYPES = Object.freeze([
  "ping", "pong", "join-request", "member-leave", "room-rpc",
  "reaction-request", "invitation-request", "game-completed-request"
]);
const HOST_TO_GUEST_MESSAGE_TYPES = Object.freeze([
  "ping", "pong", "welcome", "join-rejected", "session-state",
  "session-ended", "removed", "reaction", "invitation", "room-rpc-result",
  "room-ws-message", "room-ws-close"
]);

function frozenClone(value){
  if(value == null) return value;
  return Object.freeze(structuredClone(value));
}

function connectionStatus(value){
  if(value === "connected" || value === "completed") return "connected";
  if(value === "checking" || value === "new" || value === "connecting" || value === "disconnected") return "reconnecting";
  return "lost";
}

function safeError(error, fallback = "Nearby Arcade could not complete that request."){
  const message = error && typeof error.message === "string" ? error.message : fallback;
  return message.replace(/[<>]/g, "").slice(0, 180) || fallback;
}

function throwIfAborted(signal){
  if(!signal?.aborted) return;
  if(signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Pairing was cancelled.", "AbortError");
}

async function reconnectProof(secret, cryptoObject){
  if(!cryptoObject?.subtle || typeof cryptoObject.subtle.digest !== "function"){
    throw Object.assign(new Error("This browser cannot protect a Nearby Arcade reconnect identity."), { code: "web_crypto_required" });
  }
  const bytes = new TextEncoder().encode(String(secret || ""));
  const digest = new Uint8Array(await cryptoObject.subtle.digest("SHA-256", bytes));
  return Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
}

function validateSessionCheckpoint(value, browserIdentity = null){
  if(value == null) return null;
  if(!value || typeof value !== "object" || Array.isArray(value) || value.schema !== SESSION_CHECKPOINT_SCHEMA){
    throw Object.assign(new Error("Saved Nearby Arcade data is not compatible. Reconnect the devices."), { code: "checkpoint_invalid" });
  }
  if(value.protocolVersion !== NEARBY_PROTOCOL_VERSION){
    throw Object.assign(new Error("Saved Nearby Arcade uses a different version. Update both devices and reconnect."), { code: "checkpoint_version" });
  }
  if(!["host", "guest"].includes(value.role)) throw Object.assign(new Error("Saved Nearby Arcade role is invalid."), { code: "checkpoint_invalid" });
  try{ assertSafeId(value.sessionId, "sessionId"); }
  catch(_error){ throw Object.assign(new Error("Saved Nearby Arcade identity is invalid. Reconnect the devices."), { code: "checkpoint_invalid" }); }
  if(typeof value.sessionName !== "string" || value.sessionName.length < 1 || value.sessionName.length > 40 || typeof value.mascot !== "string" || value.mascot.length > 8){
    throw Object.assign(new Error("Saved Nearby Arcade details are invalid. Reconnect the devices."), { code: "checkpoint_invalid" });
  }
  const savedMemberLimit = value.role === "host" ? MAX_NEARBY_IDENTITIES : MAX_NEARBY_PLAYERS;
  if(!Array.isArray(value.members) || value.members.length > savedMemberLimit || (value.identity != null && (typeof value.identity !== "object" || Array.isArray(value.identity)))){
    throw Object.assign(new Error("Saved Nearby Arcade members are invalid. Reconnect the devices."), { code: "checkpoint_invalid" });
  }
  if(value.role === "host" && !value.identity){
    throw Object.assign(new Error("Saved Nearby Arcade host identity is invalid. Reconnect the devices."), { code: "checkpoint_invalid" });
  }
  const memberIds = new Set();
  const browserIds = new Set();
  const nicknames = new Set();
  let currentMembers = 0;
  let currentHosts = 0;
  let localIdentityMember = null;
  for(const member of value.members){
    if(!member || typeof member !== "object" || Array.isArray(member)){
      throw Object.assign(new Error("Saved Nearby Arcade members are invalid. Reconnect the devices."), { code: "checkpoint_invalid" });
    }
    try{ assertSafeId(member.memberId, "memberId", { min: 12, max: 100 }); }
    catch(_error){ throw Object.assign(new Error("Saved Nearby Arcade member identity is invalid. Reconnect the devices."), { code: "checkpoint_invalid" }); }
    if(memberIds.has(member.memberId)) throw Object.assign(new Error("Saved Nearby Arcade contains duplicate members. Reconnect the devices."), { code: "checkpoint_invalid" });
    memberIds.add(member.memberId);
    let nickname;
    try{ nickname = cleanNickname(member.nickname).normalize("NFKC").toLocaleLowerCase("en-US"); }
    catch(_error){ throw Object.assign(new Error("Saved Nearby Arcade member name is invalid. Reconnect the devices."), { code: "checkpoint_invalid" }); }
    if(nicknames.has(nickname)) throw Object.assign(new Error("Saved Nearby Arcade contains duplicate names. Reconnect the devices."), { code: "checkpoint_invalid" });
    nicknames.add(nickname);
    if(value.role === "host"){
      const browserId = String(member.browserId || "");
      if(!/^[A-Za-z0-9_-]{20,100}$/.test(browserId) || !/^[a-f0-9]{64}$/.test(String(member.reconnectProof || "")) || browserIds.has(browserId) || typeof member.host !== "boolean" || typeof member.removed !== "boolean"){
        throw Object.assign(new Error("Saved Nearby Arcade reconnect identity is invalid. Reconnect the devices."), { code: "checkpoint_invalid" });
      }
      browserIds.add(browserId);
      if(member.memberId === value.identity?.memberId) localIdentityMember = member;
      if(member.removed !== true){
        currentMembers += 1;
        if(member.host) currentHosts += 1;
      }
    }
  }
  if(value.role === "host" && currentMembers > MAX_NEARBY_PLAYERS){
    throw Object.assign(new Error("Saved Nearby Arcade has too many current players. Reconnect the devices."), { code: "checkpoint_invalid" });
  }
  if(value.identity){
    try{ assertSafeId(value.identity.memberId, "identity.memberId", { min: 12, max: 100 }); }
    catch(_error){ throw Object.assign(new Error("Saved Nearby Arcade local identity is invalid. Reconnect the devices."), { code: "checkpoint_invalid" }); }
    if(!memberIds.has(value.identity.memberId)) throw Object.assign(new Error("Saved Nearby Arcade local identity is missing. Reconnect the devices."), { code: "checkpoint_invalid" });
  }
  if(value.role === "host" && (
    currentHosts !== 1 || !localIdentityMember || localIdentityMember.host !== true || localIdentityMember.removed === true ||
    !browserIdentity || localIdentityMember.browserId !== browserIdentity.browserId
  )){
    throw Object.assign(new Error("Saved Nearby Arcade host identity does not belong to this browser. Reconnect the devices."), { code: "checkpoint_invalid" });
  }
  return value;
}

function invalidCanonicalState(message = "The Nearby host sent invalid session data. Reconnect to Nearby Arcade."){
  return Object.assign(new Error(message), { code: "canonical_state_invalid" });
}

function validateCanonicalSessionState(value, sessionId, identityMemberId = null){
  if(!value || typeof value !== "object" || Array.isArray(value) || value.sessionId !== sessionId || !Array.isArray(value.members) || value.members.length < 1 || value.members.length > MAX_NEARBY_PLAYERS){
    throw invalidCanonicalState();
  }
  const sessionName = String(value.sessionName || "");
  if(sessionName.length < 1 || sessionName.length > 40 || /[\u0000-\u001f\u007f<>]/u.test(sessionName) || sessionName.normalize("NFKC").trim() !== sessionName){
    throw invalidCanonicalState("The Nearby Arcade name is invalid. Reconnect to Nearby Arcade.");
  }
  const mascot = String(value.mascot || "");
  if(mascot.length < 1 || mascot.length > 8 || /[\u0000-\u001f\u007f<>]/u.test(mascot) || mascot.trim() !== mascot){
    throw invalidCanonicalState("The Nearby Arcade mascot is invalid. Reconnect to Nearby Arcade.");
  }
  const memberIds = new Set();
  const nicknames = new Set();
  let hostCount = 0;
  const members = value.members.map(member => {
    if(!member || typeof member !== "object" || Array.isArray(member)) throw invalidCanonicalState();
    try{ assertSafeId(member.memberId, "memberId", { min: 12, max: 100 }); }
    catch(_error){ throw invalidCanonicalState(); }
    if(memberIds.has(member.memberId)) throw invalidCanonicalState("The Nearby host sent duplicate players. Reconnect to Nearby Arcade.");
    memberIds.add(member.memberId);
    let nickname;
    try{ nickname = cleanNickname(member.nickname); }
    catch(_error){ throw invalidCanonicalState("The Nearby host sent an invalid player name. Reconnect to Nearby Arcade."); }
    if(nickname !== member.nickname) throw invalidCanonicalState("The Nearby host sent an invalid player name. Reconnect to Nearby Arcade.");
    const normalizedNickname = nickname.normalize("NFKC").toLocaleLowerCase("en-US");
    if(nicknames.has(normalizedNickname)) throw invalidCanonicalState("The Nearby host sent duplicate player names. Reconnect to Nearby Arcade.");
    nicknames.add(normalizedNickname);
    const avatar = String(member.avatar || "");
    if(cleanAvatar(avatar) !== avatar) throw invalidCanonicalState("The Nearby host sent an invalid player avatar. Reconnect to Nearby Arcade.");
    const color = String(member.color || "");
    if(!/^#[0-9a-f]{6}$/i.test(color)) throw invalidCanonicalState("The Nearby host sent an invalid player color. Reconnect to Nearby Arcade.");
    if(typeof member.host !== "boolean" || !["connected", "reconnecting", "disconnected"].includes(member.presence) || !Number.isInteger(member.stars) || member.stars < 0 || member.stars > 999 || !Number.isFinite(member.joinedAt) || member.joinedAt < 0 || member.removed === true){
      throw invalidCanonicalState();
    }
    if(member.host) hostCount += 1;
    return {
      memberId: member.memberId,
      nickname,
      avatar,
      color,
      host: member.host,
      presence: member.presence,
      stars: member.stars,
      joinedAt: member.joinedAt,
      removed: false
    };
  });
  if(hostCount !== 1) throw invalidCanonicalState("The Nearby Arcade host identity is invalid. Reconnect to Nearby Arcade.");
  if(identityMemberId && !memberIds.has(identityMemberId)) throw invalidCanonicalState("Your locked Nearby identity is missing. Reconnect to Nearby Arcade.");
  return { sessionName, mascot, joiningLocked: value.joiningLocked === true, members };
}

export class NearbyArcadeSession {
  constructor({
    storage,
    cryptoObject = globalThis.crypto,
    rtcFactory = config => new RTCPeerConnection(config),
    now = () => Date.now(),
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis)
  } = {}){
    if(!storage) throw new Error("NearbyArcadeSession requires persistent storage.");
    this.storage = storage;
    this.cryptoObject = cryptoObject;
    this.rtcFactory = rtcFactory;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.listeners = new Map();
    this.signaling = null;
    this.browserIdentity = null;
    this.profileDraft = null;
    this.checkpoint = null;
    this.role = null;
    this.sessionId = null;
    this.sessionName = "";
    this.mascot = "🎮";
    this.joiningLocked = false;
    this.registry = null;
    this.identity = null;
    this.members = [];
    this.status = "Internet";
    this.pendingPairings = new Map();
    this.pairingSetupControllers = new Set();
    this.runtimeGeneration = 0;
    this.peers = new Map();
    this.hostPeer = null;
    this.pendingRequests = new Map();
    this.seenMessages = new Set();
    this.reactionLimiter = new ReactionRateLimiter({ now });
    this.invitationLimiter = new ReactionRateLimiter({ intervalMs: 2500, burst: 4, windowMs: 20000, now });
    this.rpcLimiter = new ReactionRateLimiter({ intervalMs: 12, burst: 160, windowMs: 10000, now });
    this.completionLimiter = new ReactionRateLimiter({ intervalMs: 500, burst: 3, windowMs: 10000, now });
    this.rpcHandler = null;
    this.completionHandler = null;
    this.checkpointProvider = null;
    this.completionKeys = new Set();
    this.checkpointChain = Promise.resolve();
    this.heartbeatTimer = 0;
    this.destroyed = false;
  }

  async initialize(){
    this.browserIdentity = await this.storage.browserIdentity();
    this.profileDraft = await this.storage.loadProfile().catch(() => null);
    const loadedCheckpoint = await this.storage.loadCheckpoint().catch(() => null);
    try{ this.checkpoint = validateSessionCheckpoint(loadedCheckpoint, this.browserIdentity); }
    catch(error){
      this.checkpoint = null;
      await this.storage.clearCheckpoint().catch(() => null);
      this._emit("recovery-required", { message: safeError(error, "Reconnect to Nearby Arcade."), code: error.code || "checkpoint_invalid" });
    }
    this.completionKeys = new Set((Array.isArray(this.checkpoint?.completionKeys) ? this.checkpoint.completionKeys : [])
      .filter(value => typeof value === "string" && value.length <= 180)
      .slice(-256));
    this._emitState();
    return this.snapshot();
  }

  configureSignaling(modules){
    const required = ["createPairingCredentials", "createSignal", "serializeSignal", "deserializeSignal", "createQrFrames", "createLocalOffer", "createLocalAnswer"];
    if(!modules || required.some(name => typeof modules[name] !== "function")) throw new Error("Nearby signaling components are incomplete.");
    this.signaling = modules;
  }

  on(type, listener){
    if(typeof listener !== "function") return () => {};
    if(!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  _emit(type, detail){
    const listeners = this.listeners.get(type);
    if(!listeners) return;
    for(const listener of [...listeners]){
      try{ listener(detail); }catch(error){ this.setTimeoutFn?.(() => { throw error; }, 0); }
    }
  }

  _emitState(){ this._emit("state", this.snapshot()); }

  snapshot(){
    const members = this.role === "host" && this.registry ? this.registry.list() : this.members;
    const connected = members.filter(member => member.presence === "connected").length;
    return frozenClone({
      active: !!this.role,
      role: this.role,
      nearby: !!this.role,
      sessionId: this.sessionId,
      sessionName: this.sessionName,
      mascot: this.mascot,
      joiningLocked: this.joiningLocked,
      identity: this.identity,
      members,
      connected,
      pairingCount: this.role === "host" ? this.pendingPairings.size : this.hostPeer && !this.identity ? 1 : 0,
      status: this.status,
      checkpoint: this.checkpoint ? {
        role: this.checkpoint.role,
        sessionId: this.checkpoint.sessionId,
        sessionName: this.checkpoint.sessionName,
        mascot: this.checkpoint.mascot,
        identity: this.checkpoint.identity
      } : null
    });
  }

  draftProfile(){
    const fallback = this.profileDraft || {};
    return frozenClone({
      browserId: this.browserIdentity?.browserId || "",
      nickname: fallback.nickname || "",
      avatar: cleanAvatar(fallback.avatar),
      color: cleanColor(fallback.color)
    });
  }

  async saveProfile(profile){
    const value = {
      nickname: cleanNickname(profile?.nickname),
      avatar: cleanAvatar(profile?.avatar),
      color: cleanColor(profile?.color)
    };
    this.profileDraft = value;
    await this.storage.saveProfile(value);
    return this.draftProfile();
  }

  _profile(profile){
    return {
      browserId: this.browserIdentity.browserId,
      reconnectSecret: this.browserIdentity.reconnectSecret,
      nickname: cleanNickname(profile?.nickname ?? this.profileDraft?.nickname),
      avatar: cleanAvatar(profile?.avatar ?? this.profileDraft?.avatar),
      color: cleanColor(profile?.color ?? this.profileDraft?.color)
    };
  }

  async startHost(profile, { resume = false } = {}){
    this._requireReady();
    await this.leave({ preserveCheckpoint: true, quiet: true });
    const clean = this._profile(profile);
    if(!resume) this.completionKeys.clear();
    await this.saveProfile(clean);
    let label = sessionLabel();
    let members = [];
    let sessionId = randomId("session", this.cryptoObject);
    let joiningLocked = false;
    if(resume && this.checkpoint?.role === "host" && this.checkpoint.sessionId){
      sessionId = this.checkpoint.sessionId;
      label = { name: this.checkpoint.sessionName || label.name, mascot: this.checkpoint.mascot || label.mascot };
      // A WebRTC peer is never live merely because it was connected when the
      // checkpoint was written.  On a fresh runtime generation there are no
      // remote peer connections yet, so restore every guest as disconnected
      // until it proves its reserved identity over a newly paired channel.
      // The local host is made connected below by registry.join().
      members = Array.isArray(this.checkpoint.members)
        ? this.checkpoint.members.map(member => ({ ...member, presence: "disconnected" }))
        : [];
      joiningLocked = this.checkpoint.joiningLocked === true;
    }
    this.role = "host";
    this.sessionId = sessionId;
    this.sessionName = label.name;
    this.mascot = label.mascot;
    this.joiningLocked = joiningLocked;
    this.registry = new NearbyIdentityRegistry({ members, cryptoObject: this.cryptoObject, now: this.now });
    const joined = this.registry.join({ ...clean, reconnectProof: await reconnectProof(clean.reconnectSecret, this.cryptoObject) }, { host: true }).member;
    this.identity = joined;
    this.members = this.registry.list();
    this.status = "Hosting Nearby Arcade";
    await this._checkpoint();
    this._startHeartbeat();
    this._emitState();
    return this.snapshot();
  }

  async createHostInvitation({ ttlMs = 5 * 60 * 1000, signal: externalSignal } = {}){
    this._requireHost();
    this._requireSignaling();
    this._expirePairings();
    if(this.peers.size >= MAX_NEARBY_PLAYERS - 1) throw Object.assign(new Error("Finish or cancel an open player invitation first."), { code: "pairing_limit" });
    const operation = this._beginPairingOperation(externalSignal);
    const generation = this.runtimeGeneration;
    const sessionId = this.sessionId;
    const credentials = this.signaling.createPairingCredentials({ guestOrdinal: this.registry.list().length, now: this.now(), ttlMs });
    const peerConnection = this.rtcFactory({ iceServers: [] });
    let record = null;
    let created;
    try{
      created = await this.signaling.createLocalOffer({
        peerConnection,
        dataChannelLabel: DATA_CHANNEL_LABEL,
        dataChannelOptions: { ordered: true },
        rtcConfig: { iceServers: [] },
        signal: operation.signal
      });
      throwIfAborted(operation.signal);
      if(this.runtimeGeneration !== generation || this.role !== "host" || this.sessionId !== sessionId) throw new DOMException("Pairing was cancelled.", "AbortError");
      const peerKey = randomId("peer", this.cryptoObject);
      record = {
        peerKey,
        pairingId: credentials.pairingId,
        pairingToken: credentials.pairingToken,
        expiresAt: credentials.expiresAt,
        pc: created.peerConnection || peerConnection,
        channel: created.dataChannel,
        memberId: null,
        status: "pairing",
        lostTimer: 0,
        expiryTimer: 0,
        lastSeen: this.now()
      };
      this.pendingPairings.set(credentials.pairingId, record);
      this.peers.set(peerKey, record);
      record.expiryTimer = this.setTimeoutFn?.(() => {
        if(this.pendingPairings.get(record.pairingId) !== record) return;
        this._closeRecord(record);
        this._emit("error", { message: "That player invitation expired. Create a new one to try again." });
        this._emitState();
      }, Math.max(0, credentials.expiresAt - this.now()));
      this._wirePeer(record, "host");
      this._emitState();
      const invitationSignal = this.signaling.createSignal({
        kind: "offer",
        sessionId,
        pairingId: credentials.pairingId,
        pairingToken: credentials.pairingToken,
        description: created.description,
        createdAt: credentials.createdAt,
        expiresAt: credentials.expiresAt,
        peerId: peerKey
      });
      const wire = await this.signaling.serializeSignal(invitationSignal, { compression: "identity" });
      throwIfAborted(operation.signal);
      if(this.runtimeGeneration !== generation || this.role !== "host" || this.sessionId !== sessionId || this.pendingPairings.get(credentials.pairingId) !== record){
        throw new DOMException("Pairing was cancelled.", "AbortError");
      }
      return frozenClone({ pairingId: credentials.pairingId, wire, frames: this.signaling.createQrFrames(wire, { maxFrameChars: NEARBY_QR_FRAME_CHARS }) });
    }catch(error){
      if(record) this._closeRecord(record);
      else try{ peerConnection.close(); }catch(_error){}
      throw error;
    }finally{
      operation.finish();
    }
  }

  async acceptGuestResponse(wire, pairingId, { signal } = {}){
    this._requireHost();
    this._requireSignaling();
    throwIfAborted(signal);
    const record = this.pendingPairings.get(String(pairingId || ""));
    if(!record) throw Object.assign(new Error("That player invitation is no longer active."), { code: "pairing_missing" });
    const responseSignal = await this.signaling.deserializeSignal(wire, {
      expectedKind: "answer",
      expectedSessionId: this.sessionId,
      expectedPairingId: record.pairingId,
      expectedPairingToken: record.pairingToken,
      now: this.now()
    });
    throwIfAborted(signal);
    await record.pc.setRemoteDescription(responseSignal.description);
    throwIfAborted(signal);
    record.status = "connecting";
    this._emitState();
    return true;
  }

  cancelPairing(pairingId){
    if(this.role !== "host") return false;
    const record = this.pendingPairings.get(String(pairingId || ""));
    if(!record || record.memberId) return false;
    this._closeRecord(record);
    this._emitState();
    return true;
  }

  async joinFromInvitation(profile, wire, { signal } = {}){
    this._requireReady();
    this._requireSignaling();
    throwIfAborted(signal);
    await this.leave({ preserveCheckpoint: true, quiet: true });
    throwIfAborted(signal);
    const operation = this._beginPairingOperation(signal);
    const setupSignal = operation.signal;
    let peerConnection = null;
    let record = null;
    try{
      const clean = this._profile(profile);
      this.completionKeys.clear();
      await this.saveProfile(clean);
      throwIfAborted(setupSignal);
      const offer = await this.signaling.deserializeSignal(wire, { expectedKind: "offer", now: this.now() });
      throwIfAborted(setupSignal);
      peerConnection = this.rtcFactory({ iceServers: [] });
      let dataChannelResolve;
      const dataChannelPromise = new Promise(resolve => { dataChannelResolve = resolve; });
      peerConnection.ondatachannel = event => dataChannelResolve(event.channel);
      const created = await this.signaling.createLocalAnswer({
        remoteDescription: offer.description,
        peerConnection,
        rtcConfig: { iceServers: [] },
        signal: setupSignal
      });
      throwIfAborted(setupSignal);
      this.role = "guest";
      this.sessionId = offer.sessionId;
      this.sessionName = "Nearby Arcade";
      this.mascot = "🎮";
      this.identity = null;
      this.members = [];
      this.status = "Waiting for the host to scan your response";
      record = {
        peerKey: String(offer.peerId || randomId("host", this.cryptoObject)),
        pairingId: offer.pairingId,
        pairingToken: offer.pairingToken,
        pc: created.peerConnection || peerConnection,
        channel: null,
        memberId: null,
        profile: clean,
        status: "pairing",
        lostTimer: 0,
        expiryTimer: 0,
        lastSeen: this.now()
      };
      this.hostPeer = record;
      record.expiryTimer = this.setTimeoutFn?.(() => {
        if(this.hostPeer !== record || record.status === "connected") return;
        this._closeRecord(record);
        this.status = "Pairing expired. Scan a new invitation from the host.";
        this._emit("error", { message: this.status });
        this._emitState();
      }, Math.max(0, offer.expiresAt - this.now()));
      this._wirePeer(record, "guest");
      dataChannelPromise.then(channel => {
        if(this.hostPeer !== record){ try{ channel?.close?.(); }catch(_error){} return; }
        record.channel = channel;
        this._wireChannel(record, "guest");
      });
      const responseSignal = this.signaling.createSignal({
        kind: "answer",
        sessionId: offer.sessionId,
        pairingId: offer.pairingId,
        pairingToken: offer.pairingToken,
        description: created.description,
        createdAt: offer.createdAt,
        expiresAt: offer.expiresAt,
        peerId: record.peerKey
      });
      const responseWire = await this.signaling.serializeSignal(responseSignal, { compression: "identity" });
      throwIfAborted(setupSignal);
      await this._checkpoint();
      throwIfAborted(setupSignal);
      this._startHeartbeat();
      this._emitState();
      return frozenClone({ pairingId: offer.pairingId, wire: responseWire, frames: this.signaling.createQrFrames(responseWire, { maxFrameChars: NEARBY_QR_FRAME_CHARS }) });
    }catch(error){
      if(record && this.hostPeer === record) await this.leave({ preserveCheckpoint: true, quiet: true });
      else try{ peerConnection?.close(); }catch(_error){}
      throw error;
    }finally{
      operation.finish();
    }
  }

  _wirePeer(record, side){
    const update = () => this._peerConnectionChanged(record, side);
    record.pc.onconnectionstatechange = update;
    record.pc.oniceconnectionstatechange = update;
    if(record.channel) this._wireChannel(record, side);
  }

  _wireChannel(record, side){
    const channel = record.channel;
    if(!channel || channel.__arcadeWired) return;
    channel.__arcadeWired = true;
    channel.onopen = () => {
      record.status = "connected";
      record.lastSeen = this.now();
      if(side === "guest"){
        this.status = "Joining Nearby Arcade";
        this._sendRecord(record, "join-request", { profile: record.profile, pairingId: record.pairingId, pairingToken: record.pairingToken });
      }
      this._emitState();
    };
    channel.onmessage = event => this._receiveRecord(record, event.data, side);
    channel.onerror = () => this._markPeerLost(record, side, "Connection interrupted");
    channel.onclose = () => this._markPeerLost(record, side, "Connection lost");
    if(channel.readyState === "open") channel.onopen();
  }

  _peerConnectionChanged(record, side){
    const state = connectionStatus(record.pc.connectionState || record.pc.iceConnectionState);
    if(state === "connected"){
      if(record.lostTimer){ this.clearTimeoutFn(record.lostTimer); record.lostTimer = 0; }
      record.status = "connected";
      if(side === "host" && record.memberId) this.registry.setPresence(record.memberId, "connected");
      if(side === "guest" && this.identity) this.status = "Connected";
      this._broadcastSessionState();
      this._emitState();
      return;
    }
    if(state === "reconnecting"){
      record.status = "reconnecting";
      if(side === "host" && record.memberId) this.registry.setPresence(record.memberId, "reconnecting");
      if(side === "guest") this.status = "Reconnecting…";
      this._broadcastSessionState();
      this._emitState();
      if(!record.lostTimer) record.lostTimer = this.setTimeoutFn(() => this._markPeerLost(record, side, "Connection lost"), LOST_AFTER_MS);
      return;
    }
    this._markPeerLost(record, side, "Connection lost");
  }

  _markPeerLost(record, side, status){
    if(record.closing || record.closed || record.status === "lost") return;
    if(record.lostTimer){ this.clearTimeoutFn(record.lostTimer); record.lostTimer = 0; }
    record.status = "lost";
    if(side === "host" && record.memberId){
      this.registry.setPresence(record.memberId, "disconnected");
      this._checkpoint();
      this._broadcastSessionState();
    }else if(side === "guest") this.status = `${status}. Reconnect to Nearby Arcade.`;
    this._emitState();
    this._closeRecord(record);
  }

  _sendRecord(record, type, payload){
    if(!record?.channel || record.channel.readyState !== "open") throw Object.assign(new Error("That nearby player is not connected."), { code: "peer_not_connected" });
    if(Number(record.channel.bufferedAmount) > MAX_DATA_CHANNEL_BUFFERED_BYTES){
      const side = record === this.hostPeer ? "guest" : "host";
      this._markPeerLost(record, side, "Connection overloaded");
      throw Object.assign(new Error("Nearby connection is sending data too quickly."), { code: "peer_backpressure" });
    }
    const message = makeNearbyEnvelope(type, { sessionId: this.sessionId, payload }, {
      messageId: randomId("msg", this.cryptoObject),
      sentAt: this.now()
    });
    const serialized = JSON.stringify(message);
    if(utf8ByteLength(serialized) > MESSAGE_LIMITS.maxBytes) throw Object.assign(new Error("Nearby message is too large."), { code: "message_too_large" });
    record.channel.send(serialized);
    return message.messageId;
  }

  _acceptInboundTraffic(record, side, bytes){
    const time = this.now();
    let traffic = record.inboundTraffic;
    if(!traffic || !Number.isFinite(traffic.startedAt) || time < traffic.startedAt || time - traffic.startedAt >= INBOUND_TRAFFIC_WINDOW_MS){
      traffic = { startedAt: time, messages: 0, bytes: 0, invalid: 0 };
      record.inboundTraffic = traffic;
    }
    traffic.messages += 1;
    traffic.bytes += Number.isFinite(bytes) && bytes >= 0 ? bytes : MESSAGE_LIMITS.maxBytes + 1;
    if(traffic.messages > MAX_INBOUND_MESSAGES_PER_WINDOW || traffic.bytes > MAX_INBOUND_BYTES_PER_WINDOW){
      this._markPeerLost(record, side, "Connection sent too much data");
      return false;
    }
    return true;
  }

  _noteInvalidInbound(record, side){
    const traffic = record.inboundTraffic;
    if(!traffic) return;
    traffic.invalid += 1;
    if(traffic.invalid >= MAX_INVALID_MESSAGES_PER_WINDOW){
      this._markPeerLost(record, side, "Connection sent invalid data");
    }
  }

  _receiveRecord(record, raw, side){
    const rawBytes = typeof raw === "string"
      ? utf8ByteLength(raw)
      : Number.isFinite(raw?.byteLength) ? Number(raw.byteLength) : MESSAGE_LIMITS.maxBytes + 1;
    if(rawBytes > MESSAGE_LIMITS.maxBytes){
      this._markPeerLost(record, side, "Connection sent too much data");
      return;
    }
    if(!this._acceptInboundTraffic(record, side, rawBytes)) return;
    if(typeof raw !== "string"){
      this._noteInvalidInbound(record, side);
      return;
    }
    let message;
    try{
      const parsed = JSON.parse(raw);
      const allowedTypes = side === "host" ? GUEST_TO_HOST_MESSAGE_TYPES : side === "guest" ? HOST_TO_GUEST_MESSAGE_TYPES : [];
      const checked = validateNearbyMessage(parsed, { allowedTypes });
      if(!checked.body || checked.body.sessionId !== this.sessionId) return;
      message = { ...checked, payload: checked.body.payload };
    }catch(_error){
      this._noteInvalidInbound(record, side);
      return;
    }
    if(this.seenMessages.has(message.messageId)) return;
    this.seenMessages.add(message.messageId);
    if(this.seenMessages.size > 1000) this.seenMessages.delete(this.seenMessages.values().next().value);
    record.lastSeen = this.now();
    if(message.type === "ping"){
      try{ this._sendRecord(record, "pong", { at: this.now() }); }catch(_error){}
      return;
    }
    if(message.type === "pong") return;
    if(side === "host") this._receiveFromGuest(record, message);
    else this._receiveFromHost(record, message);
  }

  _receiveFromGuest(record, message){
    if(message.type === "join-request"){
      if(record.memberId || record.joinInFlight || this.pendingPairings.get(record.pairingId) !== record){
        this._markPeerLost(record, "host", "Invalid repeated join request");
        return;
      }
      record.joinInFlight = true;
      this._acceptJoinRequest(record, message.payload);
      return;
    }
    if(!record.memberId) return;
    const member = this.registry.get(record.memberId);
    if(!member || member.removed) return;
    if(message.type === "member-leave"){
      this.registry.setPresence(member.memberId, "disconnected");
      this._checkpoint();
      this._broadcastSessionState();
      // Leaving is an explicit end to this transport binding, not merely a
      // presence hint.  Close the authenticated channel so a peer cannot keep
      // submitting room actions after announcing that it left.
      this._closeRecord(record);
      return;
    }
    if(message.type === "room-rpc"){
      if(!this.rpcLimiter.accept(member.memberId)){
        const requestId = String(message.payload?.requestId || "");
        if(requestId) try{ this._sendRecord(record, "room-rpc-result", { requestId, ok: false, status: 429, error: "Nearby actions are arriving too quickly." }); }catch(_error){}
        return;
      }
      this._handleRemoteRpc(record, member, message.payload);
      return;
    }
    if(message.type === "reaction-request") this._acceptReaction(member, message.payload?.reaction);
    else if(message.type === "invitation-request" && this.invitationLimiter.accept(member.memberId)) this._acceptInvitation(member, message.payload);
    else if(message.type === "game-completed-request" && this.completionLimiter.accept(member.memberId)) this._acceptGameCompleted(member, message.payload);
  }

  async _acceptJoinRequest(record, payload){
    try{
      if(record.memberId || this.pendingPairings.get(record.pairingId) !== record) throw Object.assign(new Error("That player invitation was already used."), { code: "pairing_used" });
      if(!payload || payload.pairingId !== record.pairingId || payload.pairingToken !== record.pairingToken || this.now() > record.expiresAt){
        throw Object.assign(new Error("This player invitation expired. Ask the host to add you again."), { code: "pairing_expired" });
      }
      const supplied = payload.profile || {};
      const knownIdentity = this.registry.getByBrowser(supplied.browserId);
      if(this.joiningLocked && !knownIdentity) throw Object.assign(new Error("The host has locked new joining. Reserved players may still reconnect."), { code: "joining_locked" });
      const result = this.registry.join({
        browserId: supplied.browserId,
        nickname: supplied.nickname,
        avatar: supplied.avatar,
        color: supplied.color,
        reconnectProof: await reconnectProof(supplied.reconnectSecret, this.cryptoObject)
      });
      const previous = this._peerForMember(result.member.memberId);
      if(previous && previous !== record) this._closeRecord(previous);
      record.memberId = result.member.memberId;
      record.status = "connected";
      const acceptedPairingId = record.pairingId;
      this.pendingPairings.delete(acceptedPairingId);
      if(record.expiryTimer){ this.clearTimeoutFn(record.expiryTimer); record.expiryTimer = 0; }
      this._sendRecord(record, "welcome", {
        identity: result.member,
        nameLocked: true,
        session: this._canonicalSessionState()
      });
      record.pairingId = null;
      record.pairingToken = null;
      record.expiresAt = 0;
      await this._checkpoint();
      this._broadcastSessionState();
      this._emit("player-joined", result.member);
    }catch(error){
      try{ this._sendRecord(record, "join-rejected", { error: safeError(error), code: error.code || "join_rejected" }); }catch(_error){}
      if(record.memberId) this.registry.setPresence(record.memberId, "disconnected");
      this._closeRecord(record);
      this._checkpoint();
      this._broadcastSessionState();
    }
  }

  _receiveFromHost(record, message){
    if(message.type === "welcome"){
      const payload = message.payload || {};
      let identityMemberId;
      try{
        identityMemberId = assertSafeId(payload.identity?.memberId, "identity.memberId", { min: 12, max: 100 });
        this._acceptCanonicalState(payload.session, { identityMemberId });
      }catch(error){
        this._rejectHostState(record, error);
        return;
      }
      if(record.expiryTimer){ this.clearTimeoutFn(record.expiryTimer); record.expiryTimer = 0; }
      this.status = "Connected";
      record.memberId = identityMemberId;
      this._checkpoint();
      this._emit("connected", this.snapshot());
      this._emitState();
      return;
    }
    if(message.type === "join-rejected"){
      this.status = safeError({ message: message.payload?.error }, "The host could not add this player.");
      this._emit("error", { message: this.status, code: message.payload?.code || "join_rejected" });
      this._emitState();
      return;
    }
    if(message.type === "session-state"){
      try{ this._acceptCanonicalState(message.payload, { identityMemberId: this.identity?.memberId || null }); }
      catch(error){ this._rejectHostState(record, error); }
    }
    else if(message.type === "session-ended") this._remoteEnded(message.payload?.reason);
    else if(message.type === "removed") this._remoteRemoved();
    else if(message.type === "reaction") this._emit("reaction", frozenClone(message.payload));
    else if(message.type === "invitation") this._emit("invitation", frozenClone(message.payload));
    else if(message.type === "room-rpc-result") this._resolveRemoteRequest(message.payload);
    else if(message.type === "room-ws-message") this._emit("socket-message", frozenClone(message.payload));
    else if(message.type === "room-ws-close") this._emit("socket-close", frozenClone(message.payload));
  }

  _rejectHostState(record, error){
    this._emit("error", { message: safeError(error, "The Nearby host sent invalid session data. Reconnect to Nearby Arcade."), code: "canonical_state_invalid" });
    this._markPeerLost(record, "guest", "Connection data was invalid");
  }

  _acceptCanonicalState(value, { identityMemberId = this.identity?.memberId || null } = {}){
    const state = validateCanonicalSessionState(value, this.sessionId, identityMemberId);
    this.sessionName = state.sessionName;
    this.mascot = state.mascot;
    this.joiningLocked = state.joiningLocked;
    this.members = state.members;
    if(identityMemberId) this.identity = this.members.find(member => member.memberId === identityMemberId);
    this._checkpoint();
    this._emitState();
    return true;
  }

  _canonicalSessionState(){
    return {
      sessionId: this.sessionId,
      sessionName: this.sessionName,
      mascot: this.mascot,
      joiningLocked: this.joiningLocked,
      members: this.registry.list()
    };
  }

  _broadcastSessionState(){
    if(this.role !== "host" || !this.registry) return;
    const state = this._canonicalSessionState();
    for(const record of this.peers.values()){
      if(record.memberId && record.channel?.readyState === "open"){
        try{ this._sendRecord(record, "session-state", state); }catch(_error){}
      }
    }
    this.members = state.members;
    this._emitState();
  }

  async requestRoomRpc(operation, payload){
    if(!this.role) throw Object.assign(new Error("Nearby Arcade is not connected."), { status: 503 });
    if(!["http", "ws-open", "ws-send", "ws-close"].includes(operation)) throw Object.assign(new Error("Nearby room operation is not supported."), { status: 400 });
    if(this.role === "host") return this._invokeRpcHandler(this.identity, operation, payload);
    return this._requestHost("room-rpc", { operation, payload });
  }

  setRpcHandler(handler){ this.rpcHandler = typeof handler === "function" ? handler : null; }
  setCompletionHandler(handler){ this.completionHandler = typeof handler === "function" ? handler : null; }
  setCheckpointProvider(provider){ this.checkpointProvider = typeof provider === "function" ? provider : null; }
  checkpointNow(){ return this._checkpoint(); }
  async acceptCanonicalCompletion(completion){
    this._requireHost();
    if(!completion || completion.canonical !== true || completion.verifiedRules !== true) return false;
    const suppliedId = typeof completion.completionId === "string" && completion.completionId.length > 0 && completion.completionId.length <= 256 ? completion.completionId : "";
    const key = `${String(completion.gameId || "")}:${String(completion.roomCode || "")}:${suppliedId || (Number(completion.version) || 0)}`;
    if(this.completionKeys.has(key)) return false;
    this.completionKeys.add(key);
    if(this.completionKeys.size > 256) this.completionKeys.delete(this.completionKeys.values().next().value);
    if(completion.tie === true || !completion.winnerMemberId) return true;
    const winner = this.registry.addStar(completion.winnerMemberId, 1);
    if(!winner) return false;
    await this._checkpoint();
    this._broadcastSessionState();
    this._emit("star", frozenClone({ member: winner, gameId: String(completion.gameId || ""), at: this.now() }));
    return true;
  }

  async _invokeRpcHandler(member, operation, payload){
    if(!this.rpcHandler) throw Object.assign(new Error("Nearby game rooms are not ready yet."), { status: 503 });
    return this.rpcHandler({ member: frozenClone(member), operation, payload: frozenClone(payload) });
  }

  async _handleRemoteRpc(record, member, payload){
    const requestId = String(payload?.requestId || "");
    if(!/^[A-Za-z0-9_-]{20,120}$/.test(requestId)) return;
    let response;
    try{
      const result = await this._invokeRpcHandler(member, payload.operation, payload.payload);
      response = { requestId, ok: true, result };
    }catch(error){
      response = { requestId, ok: false, status: Number(error?.status) || 500, error: safeError(error) };
    }
    try{ this._sendRecord(record, "room-rpc-result", response); }
    catch(_error){
      if(!record.closed && !record.closing) this._markPeerLost(record, "host", "Connection could not receive the room response");
    }
  }

  _requestHost(type, payload, timeoutMs = RPC_TIMEOUT_MS){
    const record = this.hostPeer;
    if(!record?.channel || record.channel.readyState !== "open") return Promise.reject(Object.assign(new Error("Nearby host is not connected."), { status: 503 }));
    const requestId = randomId("request", this.cryptoObject);
    return new Promise((resolve, reject) => {
      const timer = this.setTimeoutFn(() => {
        this.pendingRequests.delete(requestId);
        reject(Object.assign(new Error("Nearby host did not respond in time."), { status: 504 }));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      try{ this._sendRecord(record, type, { ...payload, requestId }); }
      catch(error){
        this.clearTimeoutFn(timer);
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  _resolveRemoteRequest(payload){
    const request = this.pendingRequests.get(String(payload?.requestId || ""));
    if(!request) return;
    this.pendingRequests.delete(payload.requestId);
    this.clearTimeoutFn(request.timer);
    if(payload.ok === false) request.reject(Object.assign(new Error(String(payload.error || "Nearby request failed.")), { status: Number(payload.status) || 500 }));
    else request.resolve(payload.result);
  }

  sendSocketMessage(memberId, socketId, data){
    const payload = { socketId: String(socketId || "").slice(0, 120), data: String(data || "") };
    if(memberId === this.identity?.memberId){ this._emit("socket-message", frozenClone(payload)); return true; }
    const peer = this._peerForMember(memberId);
    if(!peer) return false;
    try{ this._sendRecord(peer, "room-ws-message", payload); return true; }catch(_error){ return false; }
  }

  closeSocket(memberId, socketId, { code = 1000, reason = "", clean = true } = {}){
    const payload = { socketId: String(socketId || "").slice(0, 120), code: Number(code) || 1000, reason: String(reason || "").slice(0, 120), clean: clean !== false };
    if(memberId === this.identity?.memberId){ this._emit("socket-close", frozenClone(payload)); return true; }
    const peer = this._peerForMember(memberId);
    if(!peer) return false;
    try{ this._sendRecord(peer, "room-ws-close", payload); return true; }catch(_error){ return false; }
  }

  _peerForMember(memberId){ return [...this.peers.values()].find(peer => peer.memberId === memberId) || null; }

  sendReaction(reaction){
    if(!validReaction(reaction) || !this.identity) return false;
    if(this.role === "host") return this._acceptReaction(this.identity, reaction);
    try{ this._sendRecord(this.hostPeer, "reaction-request", { reaction }); return true; }catch(_error){ return false; }
  }

  _acceptReaction(member, reaction){
    if(!validReaction(reaction) || !this.reactionLimiter.accept(member.memberId)) return false;
    const value = { memberId: member.memberId, nickname: member.nickname, avatar: member.avatar, reaction, at: this.now() };
    this._broadcast("reaction", value);
    this._emit("reaction", frozenClone(value));
    return true;
  }

  announceInvitation(invitation){
    if(!this.identity || !invitation) return false;
    if(this.role === "host") return this._acceptInvitation(this.identity, invitation);
    try{ this._sendRecord(this.hostPeer, "invitation-request", invitation); return true; }catch(_error){ return false; }
  }

  _acceptInvitation(member, invitation){
    const value = {
      invitationId: randomId("invite", this.cryptoObject),
      gameId: String(invitation?.gameId || "").slice(0, 40),
      roomCode: String(invitation?.roomCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
      label: String(invitation?.label || "game").replace(/[<>]/g, "").slice(0, 80),
      senderId: member.memberId,
      senderName: member.nickname,
      createdAt: this.now()
    };
    if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.gameId) || value.roomCode.length < 4) return false;
    this._broadcast("invitation", value, member.memberId);
    this._emit("invitation", frozenClone(value));
    return true;
  }

  reportGameCompleted(details){
    if(!this.identity || !details) return false;
    if(this.role === "host"){ this._acceptGameCompleted(this.identity, details); return true; }
    try{ this._sendRecord(this.hostPeer, "game-completed-request", details); return true; }catch(_error){ return false; }
  }

  async _acceptGameCompleted(member, details){
    if(!this.completionHandler) return;
    try{
      const verified = await this.completionHandler({ member: frozenClone(member), details: frozenClone(details) });
      if(!verified || verified.canonical !== true) return;
      await this.acceptCanonicalCompletion(verified);
    }catch(error){ this._emit("error", { message: safeError(error) }); }
  }

  _broadcast(type, payload, exceptMemberId = null){
    if(this.role !== "host") return;
    for(const peer of this.peers.values()){
      if(!peer.memberId || peer.memberId === exceptMemberId || peer.channel?.readyState !== "open") continue;
      try{ this._sendRecord(peer, type, payload); }catch(_error){}
    }
  }

  async setJoiningLocked(locked){
    this._requireHost();
    this.joiningLocked = locked === true;
    await this._checkpoint();
    this._broadcastSessionState();
  }

  async resetStars(){
    this._requireHost();
    this.registry.resetStars();
    await this._checkpoint();
    this._broadcastSessionState();
  }

  async removePlayer(memberId){
    this._requireHost();
    if(!this.registry.remove(memberId)) throw new Error("That player cannot be removed.");
    const peer = this._peerForMember(memberId);
    if(peer){
      try{ this._sendRecord(peer, "removed", { reason: "The host removed this player." }); }catch(_error){}
      this._closeRecord(peer);
    }
    await this._checkpoint();
    this._broadcastSessionState();
  }

  async end(reason = "The host ended Nearby Arcade."){
    this._requireHost();
    this._broadcast("session-ended", { reason: String(reason).slice(0, 120) });
    for(const peer of [...this.peers.values()]) this._closeRecord(peer);
    await this.checkpointChain.catch(() => null);
    await this.storage.clearCheckpoint().catch(() => null);
    this.checkpoint = null;
    this._resetRuntime();
    this._emit("ended", { reason });
  }

  async leave({ preserveCheckpoint = true, quiet = false } = {}){
    if(this.role === "guest" && this.hostPeer?.channel?.readyState === "open"){
      try{ this._sendRecord(this.hostPeer, "member-leave", {}); }catch(_error){}
    }
    for(const peer of [...this.peers.values()]) this._closeRecord(peer);
    if(this.hostPeer) this._closeRecord(this.hostPeer);
    if(!preserveCheckpoint){
      await this.checkpointChain.catch(() => null);
      await this.storage.clearCheckpoint().catch(() => null);
      this.checkpoint = null;
    }
    this._resetRuntime();
    if(!quiet) this._emit("left", {});
  }

  _remoteEnded(reason){
    for(const peer of [...this.peers.values()]) this._closeRecord(peer);
    if(this.hostPeer) this._closeRecord(this.hostPeer);
    this.checkpointChain = this.checkpointChain.then(() => this.storage.clearCheckpoint()).catch(() => null);
    this.checkpoint = null;
    this._resetRuntime();
    this._emit("ended", { reason: String(reason || "The host ended Nearby Arcade.") });
  }

  _remoteRemoved(){
    const reason = "The host removed this player from Nearby Arcade.";
    for(const peer of [...this.peers.values()]) this._closeRecord(peer);
    if(this.hostPeer) this._closeRecord(this.hostPeer);
    this.checkpointChain = this.checkpointChain.then(() => this.storage.clearCheckpoint()).catch(() => null);
    this.checkpoint = null;
    this._resetRuntime();
    this._emit("removed", { reason });
  }

  _closeRecord(record){
    if(!record || record.closing || record.closed) return;
    record.closing = true;
    if(record.lostTimer) this.clearTimeoutFn(record.lostTimer);
    if(record.expiryTimer) this.clearTimeoutFn(record.expiryTimer);
    if(record.channel){
      record.channel.onopen = null;
      record.channel.onmessage = null;
      record.channel.onerror = null;
      record.channel.onclose = null;
    }
    if(record.pc){
      record.pc.onconnectionstatechange = null;
      record.pc.oniceconnectionstatechange = null;
      record.pc.ondatachannel = null;
    }
    try{ record.channel?.close(); }catch(_error){}
    try{ record.pc?.close(); }catch(_error){}
    this.peers.delete(record.peerKey);
    if(record.pairingId) this.pendingPairings.delete(record.pairingId);
    if(this.hostPeer === record) this.hostPeer = null;
    record.closed = true;
    record.closing = false;
  }

  _expirePairings(){
    const time = this.now();
    for(const record of [...this.pendingPairings.values()]){
      if(Number(record.expiresAt) <= time) this._closeRecord(record);
    }
  }

  _beginPairingOperation(externalSignal = null){
    const controller = new AbortController();
    const abort = () => {
      if(controller.signal.aborted) return;
      try{ controller.abort(externalSignal?.reason); }
      catch(_error){ controller.abort(); }
    };
    if(externalSignal){
      if(externalSignal.aborted) abort();
      else externalSignal.addEventListener("abort", abort, { once: true });
    }
    this.pairingSetupControllers.add(controller);
    return {
      signal: controller.signal,
      finish: () => {
        this.pairingSetupControllers.delete(controller);
        if(externalSignal) externalSignal.removeEventListener("abort", abort);
      }
    };
  }

  _resetRuntime(){
    this.runtimeGeneration += 1;
    for(const controller of this.pairingSetupControllers){
      try{ controller.abort(new DOMException("Pairing was cancelled.", "AbortError")); }catch(_error){ try{ controller.abort(); }catch(_ignored){} }
    }
    this.pairingSetupControllers.clear();
    this.role = null;
    this.sessionId = null;
    this.sessionName = "";
    this.mascot = "🎮";
    this.joiningLocked = false;
    this.registry = null;
    this.identity = null;
    this.members = [];
    this.status = "Internet";
    this.pendingPairings.clear();
    this.peers.clear();
    this.hostPeer = null;
    for(const request of this.pendingRequests.values()){
      this.clearTimeoutFn(request.timer);
      request.reject(Object.assign(new Error("Nearby Arcade disconnected."), { status: 503 }));
    }
    this.pendingRequests.clear();
    if(this.heartbeatTimer) this.clearIntervalFn(this.heartbeatTimer);
    this.heartbeatTimer = 0;
    this._emitState();
  }

  _startHeartbeat(){
    if(this.heartbeatTimer || !this.setIntervalFn) return;
    this.heartbeatTimer = this.setIntervalFn(() => {
      const records = this.role === "host" ? [...this.peers.values()] : this.hostPeer ? [this.hostPeer] : [];
      for(const record of records){
        if(record.channel?.readyState !== "open") continue;
        try{ this._sendRecord(record, "ping", { at: this.now() }); }catch(_error){}
      }
    }, HEARTBEAT_MS);
  }

  _checkpoint(){
    const save = async() => {
      if(!this.role || !this.sessionId) return;
      let roomService = null;
      if(this.role === "host" && this.checkpointProvider){
        try{ roomService = await this.checkpointProvider(); }catch(_error){ roomService = this.checkpoint?.roomService || null; }
      }
      if(!this.role || !this.sessionId) return;
      const value = {
        schema: SESSION_CHECKPOINT_SCHEMA,
        protocolVersion: NEARBY_PROTOCOL_VERSION,
        role: this.role,
        sessionId: this.sessionId,
        sessionName: this.sessionName,
        mascot: this.mascot,
        joiningLocked: this.joiningLocked,
        identity: this.identity,
        members: this.role === "host" && this.registry ? this.registry.serialize() : this.members,
        completionKeys: [...this.completionKeys].slice(-256),
        roomService,
        updatedAt: this.now()
      };
      this.checkpoint = value;
      await this.storage.saveCheckpoint(value).catch(() => null);
    };
    const queued = this.checkpointChain.then(save, save);
    this.checkpointChain = queued.catch(() => null);
    return queued;
  }

  _requireReady(){
    if(!this.browserIdentity) throw Object.assign(new Error("Nearby Arcade is still getting ready."), { code: "not_ready" });
    if(!this.cryptoObject || typeof this.cryptoObject.getRandomValues !== "function") throw Object.assign(new Error("This browser cannot create a secure Nearby Arcade connection."), { code: "web_crypto_required" });
  }
  _requireSignaling(){ if(!this.signaling) throw Object.assign(new Error("Nearby pairing tools are not ready."), { code: "signaling_unavailable" }); }
  _requireHost(){ if(this.role !== "host") throw Object.assign(new Error("Only the Nearby Arcade host can do that."), { code: "host_required" }); }
}
