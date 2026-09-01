export const ARCADE_BRIDGE_SCOPE = "arcade-multiplayer";
export const ARCADE_BRIDGE_VERSION = 1;
export const MAX_BRIDGE_BYTES = 112 * 1024;
export const MAX_NEARBY_PLAYERS = 8;
// Removed identities remain proof/name reservations for the life of a Nearby
// session, but they must not permanently consume one of the eight live seats.
// Bound the private historical registry independently to keep checkpoints and
// duplicate-name scans small.
export const MAX_NEARBY_IDENTITIES = 32;

export const AVATARS = Object.freeze(["🚀", "🦖", "🦄", "😎", "🐼", "🐯", "🦊", "🐙", "🦈", "🐸", "🐲", "🛸"]);
export const REACTIONS = Object.freeze(["😂", "🤯", "😎", "💩", "👑", "🦖", "🍕", "🚀", "🎉", "👏"]);
export const MEMBER_COLORS = Object.freeze(["#21dcff", "#ff5ac8", "#ffce3a", "#72ef80", "#9b7cff", "#ff7b54", "#6ee7d8", "#f59eeb"]);

const SILLY_FIRST = Object.freeze(["Cosmic", "Waffle", "Sneaky", "Rocket", "Disco", "Turbo", "Jelly", "Ninja", "Fuzzy", "Pickle", "Moon", "Thunder"]);
const SILLY_SECOND = Object.freeze(["Banana", "Dragon", "Pickle", "Chicken", "Turtle", "Panda", "Shark", "Dinosaur", "Llama", "Cupcake", "Raccoon", "Potato"]);
const SESSION_FIRST = Object.freeze(["ROCKET", "PURPLE", "WAFFLE", "DISCO", "COSMIC", "TURBO", "JELLY", "RAINBOW", "MOON", "NINJA"]);
const SESSION_SECOND = Object.freeze(["PANDA", "TIGER", "SHARK", "DINOSAUR", "DRAGON", "LLAMA", "TURTLE", "CHICKEN", "OCTOPUS", "RACCOON"]);
const SESSION_MASCOTS = Object.freeze(["🐼", "🐯", "🦈", "🦖", "🐲", "🦙", "🐢", "🐔", "🐙", "🦝"]);

export function randomBytes(length = 16, cryptoObject = globalThis.crypto){
  const bytes = new Uint8Array(Math.max(1, Math.min(64, Number(length) || 16)));
  if(!cryptoObject || typeof cryptoObject.getRandomValues !== "function"){
    throw Object.assign(new Error("This browser cannot create a secure Nearby Arcade identity."), { code: "web_crypto_required" });
  }
  cryptoObject.getRandomValues(bytes);
  return bytes;
}

export function randomId(prefix = "id", cryptoObject = globalThis.crypto){
  const body = Array.from(randomBytes(16, cryptoObject), value => value.toString(16).padStart(2, "0")).join("");
  return `${String(prefix).replace(/[^a-z0-9_-]/gi, "").slice(0, 20) || "id"}_${body}`;
}

export function randomSecret(cryptoObject = globalThis.crypto){
  const bytes = randomBytes(24, cryptoObject);
  let binary = "";
  for(const value of bytes) binary += String.fromCharCode(value);
  if(typeof btoa === "function") return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

export function byteLength(value){
  let text;
  try{ text = typeof value === "string" ? value : JSON.stringify(value); }
  catch(_error){ return Number.POSITIVE_INFINITY; }
  if(typeof TextEncoder === "function") return new TextEncoder().encode(text == null ? "" : text).byteLength;
  return unescape(encodeURIComponent(text == null ? "" : text)).length;
}

export function normalizeNickname(value){
  return String(value == null ? "" : value).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function cleanNickname(value){
  const clean = String(value == null ? "" : value).normalize("NFKC").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().replace(/\s+/g, " ").slice(0, 24);
  if(!/^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,23}$/u.test(clean)){
    throw Object.assign(new Error("Use 1-24 letters or numbers, with spaces, apostrophes, periods, underscores, or hyphens."), { code: "nickname_invalid" });
  }
  return clean;
}

export function cleanAvatar(value){
  const candidate = String(value || "").slice(0, 8);
  return AVATARS.includes(candidate) ? candidate : AVATARS[0];
}

export function cleanColor(value, fallbackIndex = 0){
  const candidate = String(value || "");
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : MEMBER_COLORS[Math.abs(Number(fallbackIndex) || 0) % MEMBER_COLORS.length];
}

export function sillyName(random = Math.random){
  return `${SILLY_FIRST[Math.floor(random() * SILLY_FIRST.length) % SILLY_FIRST.length]} ${SILLY_SECOND[Math.floor(random() * SILLY_SECOND.length) % SILLY_SECOND.length]}`;
}

export function sessionLabel(random = Math.random){
  const index = Math.floor(random() * SESSION_SECOND.length) % SESSION_SECOND.length;
  return Object.freeze({
    name: `${SESSION_FIRST[Math.floor(random() * SESSION_FIRST.length) % SESSION_FIRST.length]} ${SESSION_SECOND[index]}`,
    mascot: SESSION_MASCOTS[index]
  });
}

export function sanitizedProfile(value, fallbackIndex = 0){
  if(!value || typeof value !== "object") throw Object.assign(new Error("Player details are missing."), { code: "profile_required" });
  const browserId = String(value.browserId || "");
  if(!/^[A-Za-z0-9_-]{20,100}$/.test(browserId)) throw Object.assign(new Error("This browser identity is not valid."), { code: "browser_identity_invalid" });
  return Object.freeze({
    browserId,
    nickname: cleanNickname(value.nickname),
    avatar: cleanAvatar(value.avatar),
    color: cleanColor(value.color, fallbackIndex)
  });
}

function publicMember(member){
  return Object.freeze({
    memberId: member.memberId,
    nickname: member.nickname,
    avatar: member.avatar,
    color: member.color,
    host: member.host === true,
    presence: member.presence,
    stars: member.stars,
    joinedAt: member.joinedAt,
    removed: member.removed === true
  });
}

export class NearbyIdentityRegistry {
  constructor({ members = [], cryptoObject = globalThis.crypto, now = () => Date.now() } = {}){
    this.cryptoObject = cryptoObject;
    this.now = now;
    this.members = new Map();
    this.browserIndex = new Map();
    for(const source of Array.isArray(members) ? members : []) this._restore(source);
  }

  _restore(source){
    if(!source || typeof source !== "object") return;
    const browserId = String(source.browserId || "");
    const reconnectProof = String(source.reconnectProof || "");
    const memberId = String(source.memberId || "");
    if(!/^[A-Za-z0-9_-]{20,100}$/.test(browserId) || !/^[a-f0-9]{64}$/.test(reconnectProof) || !/^[A-Za-z0-9_-]{12,100}$/.test(memberId) || this.browserIndex.has(browserId)) return;
    let nickname;
    try{ nickname = cleanNickname(source.nickname); }catch(_error){ return; }
    if([...this.members.values()].some(member => normalizeNickname(member.nickname) === normalizeNickname(nickname))) return;
    const member = {
      memberId,
      browserId,
      reconnectProof,
      nickname,
      avatar: cleanAvatar(source.avatar),
      color: cleanColor(source.color, this.members.size),
      host: source.host === true,
      presence: source.presence === "connected" ? "connected" : "disconnected",
      stars: Math.max(0, Math.min(999, Math.floor(Number(source.stars) || 0))),
      joinedAt: Number(source.joinedAt) || this.now(),
      removed: source.removed === true
    };
    this.members.set(memberId, member);
    this.browserIndex.set(browserId, memberId);
  }

  join(profile, { host = false } = {}){
    const clean = sanitizedProfile(profile, this.members.size);
    const reconnectProof = String(profile?.reconnectProof || "");
    if(!/^[a-f0-9]{64}$/.test(reconnectProof)) throw Object.assign(new Error("This browser reconnect proof is invalid."), { code: "identity_proof_invalid" });
    const knownId = this.browserIndex.get(clean.browserId);
    if(knownId){
      const known = this.members.get(knownId);
      if(known.reconnectProof !== reconnectProof) throw Object.assign(new Error("This browser could not prove its reserved Nearby identity."), { code: "identity_proof_invalid" });
      if(known.removed) throw Object.assign(new Error("This player was removed from this Nearby Arcade."), { code: "identity_removed" });
      known.presence = "connected";
      return Object.freeze({ member: publicMember(known), reconnected: true, nameLocked: clean.nickname !== known.nickname || clean.avatar !== known.avatar });
    }
    const normalized = normalizeNickname(clean.nickname);
    if([...this.members.values()].some(member => normalizeNickname(member.nickname) === normalized)){
      throw Object.assign(new Error("That nickname is already reserved in this Nearby Arcade."), { code: "nickname_taken" });
    }
    const currentMembers = [...this.members.values()].filter(member => !member.removed).length;
    if(currentMembers >= MAX_NEARBY_PLAYERS) throw Object.assign(new Error("This Nearby Arcade already has eight players."), { code: "session_full" });
    if(this.members.size >= MAX_NEARBY_IDENTITIES) throw Object.assign(new Error("This Nearby Arcade has reached its player-history limit. Start a new Nearby Arcade to add somebody else."), { code: "session_history_full" });
    const member = {
      memberId: randomId("member", this.cryptoObject),
      ...clean,
      reconnectProof,
      host: host === true,
      presence: "connected",
      stars: 0,
      joinedAt: this.now(),
      removed: false
    };
    this.members.set(member.memberId, member);
    this.browserIndex.set(member.browserId, member.memberId);
    return Object.freeze({ member: publicMember(member), reconnected: false, nameLocked: true });
  }

  get(memberId){
    const member = this.members.get(String(memberId || ""));
    return member ? publicMember(member) : null;
  }

  getByBrowser(browserId){
    const memberId = this.browserIndex.get(String(browserId || ""));
    return memberId ? this.get(memberId) : null;
  }

  setPresence(memberId, presence){
    const member = this.members.get(String(memberId || ""));
    if(!member || member.removed) return null;
    member.presence = presence === "connected" ? "connected" : presence === "reconnecting" ? "reconnecting" : "disconnected";
    return publicMember(member);
  }

  remove(memberId){
    const member = this.members.get(String(memberId || ""));
    if(!member || member.host) return false;
    member.removed = true;
    member.presence = "disconnected";
    return true;
  }

  addStar(memberId, amount = 1){
    const member = this.members.get(String(memberId || ""));
    if(!member || member.removed) return null;
    member.stars = Math.max(0, Math.min(999, member.stars + Math.max(0, Math.floor(Number(amount) || 0))));
    return publicMember(member);
  }

  resetStars(){
    for(const member of this.members.values()) member.stars = 0;
  }

  list({ includeRemoved = false } = {}){
    return [...this.members.values()]
      .filter(member => includeRemoved || !member.removed)
      .sort((left, right) => Number(right.host) - Number(left.host) || left.joinedAt - right.joinedAt)
      .map(publicMember);
  }

  serialize(){
    return [...this.members.values()].map(member => ({
      memberId: member.memberId,
      browserId: member.browserId,
      reconnectProof: member.reconnectProof,
      nickname: member.nickname,
      avatar: member.avatar,
      color: member.color,
      host: member.host,
      presence: member.presence,
      stars: member.stars,
      joinedAt: member.joinedAt,
      removed: member.removed
    }));
  }
}

export class ReactionRateLimiter {
  constructor({ intervalMs = 1200, burst = 3, windowMs = 8000, now = () => Date.now() } = {}){
    this.intervalMs = intervalMs;
    this.burst = burst;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  accept(memberId){
    const id = String(memberId || "");
    const time = this.now();
    const current = (this.entries.get(id) || []).filter(value => time - value < this.windowMs);
    if(current.length && time - current[current.length - 1] < this.intervalMs) return false;
    if(current.length >= this.burst) return false;
    current.push(time);
    this.entries.set(id, current);
    return true;
  }
}

export function validReaction(value){ return REACTIONS.includes(String(value || "")); }

export function offlineRuntimeReady({ offlineReady = false, hostname = "", nativeArchiveReady = false } = {}){
  return offlineReady === true || String(hostname || "").toLowerCase() === "arcade.local" || nativeArchiveReady === true;
}

export function validateFrameMessage(event, { origin, source, maxBytes = MAX_BRIDGE_BYTES } = {}){
  if(!event || event.origin !== origin || event.source !== source) return null;
  const message = event.data;
  if(!message || typeof message !== "object" || Array.isArray(message) || message.scope !== ARCADE_BRIDGE_SCOPE || message.bridgeVersion !== ARCADE_BRIDGE_VERSION) return null;
  if(!/^[A-Za-z0-9:_-]{8,120}$/.test(String(message.frameId || "")) || byteLength(message) > maxBytes) return null;
  const allowed = new Set(["hello", "rpc", "home", "open-game", "invite", "game-completed"]);
  if(!allowed.has(message.type)) return null;
  if(message.type === "rpc" && (!/^[A-Za-z0-9:_-]{8,180}$/.test(String(message.requestId || "")) || !["http", "ws-open", "ws-send", "ws-close"].includes(message.operation))) return null;
  return message;
}

export function surpriseGame(items, playerCount, random = Math.random){
  const capacities = new Map([
    ["chess", [2, 2]],
    ["sorry", [2, 4]],
    ["monopoly", [2, 6]],
    ["memory", [2, 4]],
    ["tic-tac-toe", [2, 2]],
    ["dots", [2, 4]],
    ["checkers", [2, 2]]
  ]);
  const count = Math.max(2, Math.floor(Number(playerCount) || 2));
  const choices = (Array.isArray(items) ? items : []).filter(item => {
    const capacity = item && capacities.get(item.folder);
    return item?.enabled === true && capacity && count >= capacity[0] && count <= capacity[1];
  });
  if(!choices.length) return null;
  return choices[Math.floor(random() * choices.length) % choices.length];
}

export function safeGameInvitation(value, catalogItems){
  if(!value || typeof value !== "object") return null;
  const gameId = String(value.gameId || "");
  const item = (Array.isArray(catalogItems) ? catalogItems : []).find(candidate => candidate && candidate.enabled === true && candidate.folder === gameId);
  if(!item || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(gameId)) return null;
  const roomCode = String(value.roomCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if(roomCode.length < 4) return null;
  return Object.freeze({
    invitationId: String(value.invitationId || "").slice(0, 120),
    gameId,
    roomCode,
    label: String(value.label || item.title || gameId).replace(/[<>]/g, "").slice(0, 80),
    senderId: String(value.senderId || "").slice(0, 100),
    senderName: String(value.senderName || "").replace(/[<>]/g, "").slice(0, 24),
    createdAt: Number(value.createdAt) || Date.now()
  });
}
