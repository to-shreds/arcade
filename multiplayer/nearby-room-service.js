import { GAME_TYPES, GENERIC_ROOM_LIMITS, GenericRoomModel, normalizeUsername } from "./models/generic-room-model.js";
import { GENERIC_GAME_AUTHORITY, authorityForGenericGame, validateGenericGameAction } from "./models/generic-transition-validators.js";
import { canonicalizeMonopolyStartRandomness } from "./models/monopoly-authority.js";
import { MemoryStorage, RoomModel, tokenHash } from "./models/room-model.js";
import { canonicalizeSorryStart } from "./models/sorry-transition-validator.js";

export const NEARBY_ROOM_SERVICE_VERSION = 1;
export const NEARBY_CHESS_AUTHORITY_CONTRACT = Object.freeze({
  id: "chess-rules-v1",
  ruleValidated: true,
  description: "Exact shared Chess engine and room-action authority."
});
export const NEARBY_GENERIC_AUTHORITY_CONTRACT = Object.freeze({
  id: "generic-per-game-authority-v3",
  ruleValidated: true,
  description: "Per-game Nearby authority: exact legal transitions for Sorry, Monopoly, Memory, Tic Tac Toe, Dots, and Checkers, plus locked identity and canonical chat authority.",
  games: GENERIC_GAME_AUTHORITY
});

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_REQUEST_BYTES = 96 * 1024;
const MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024;
const MAX_PATH_LENGTH = 256;
const MAX_ROOMS = 64;
const MAX_MEMBERS = 32;
const MAX_SOCKETS = 256;
const MAX_PUBLIC_ROOM_BYTES = 64 * 1024;
const MAX_GENERIC_STATE_WIRE_BYTES = 56 * 1024;
const FORBIDDEN_ACTION_IDENTITY_FIELDS = Object.freeze(["memberId", "playerId", "seat", "side", "token", "reconnectToken", "username"]);

function secureRandomIndex(maxExclusive, cryptoObject = globalThis.crypto) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x1_0000_0000) throw serviceError(500, "Invalid Nearby random range");
  const ceiling = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const value = new Uint32Array(1);
  if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") throw serviceError(500, "Nearby secure randomness is unavailable");
  do cryptoObject.getRandomValues(value); while (value[0] >= ceiling);
  return value[0] % maxExclusive;
}

function freshMonopolyRandom(cryptoObject = globalThis.crypto) {
  return { version: 1, dice: null, utilityDice: null };
}

function validMonopolyRandom(value) {
  return plainObject(value) && value.version === 1 && [value.dice, value.utilityDice].every((pair) => pair === null || (Array.isArray(pair) && pair.length === 2 && pair.every((die) => Number.isInteger(die) && die >= 1 && die <= 6)));
}

function freshMonopolyDice(cryptoObject = globalThis.crypto) {
  return [secureRandomIndex(6, cryptoObject) + 1, secureRandomIndex(6, cryptoObject) + 1];
}

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function byteLength(value) {
  let serialized;
  try { serialized = typeof value === "string" ? value : JSON.stringify(value); }
  catch { throw serviceError(400, "Value must be valid JSON"); }
  if (serialized === undefined) throw serviceError(400, "Value must be valid JSON");
  return new TextEncoder().encode(serialized).byteLength;
}

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function randomCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function roomKey(kind, code) {
  return `${kind}:${code}`;
}

function cleanMemberId(value) {
  const memberId = String(value || "");
  if (!MEMBER_ID_PATTERN.test(memberId)) throw serviceError(400, "Invalid Arcade session member identity");
  return memberId;
}

function cleanAvatar(value) {
  const avatar = Array.from(String(value || "🙂")).slice(0, 8).join("");
  if (!avatar || /[\u0000-\u001f\u007f<>]/.test(avatar)) throw serviceError(400, "Invalid Arcade avatar");
  return avatar;
}

function cleanColor(value) {
  const color = String(value || "").trim();
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : "";
}

function publicIdentity(member) {
  return {
    memberId: member.memberId,
    nickname: member.nickname,
    avatar: member.avatar,
    color: member.color,
    connected: member.connected === true
  };
}

function normalizeIdentity(value) {
  if (!plainObject(value)) throw serviceError(400, "Arcade session identity must be an object");
  return {
    memberId: cleanMemberId(value.memberId),
    nickname: normalizeUsername(value.nickname ?? value.username ?? value.name),
    avatar: cleanAvatar(value.avatar),
    color: cleanColor(value.color),
    connected: value.connected !== false
  };
}

function normalizedNameMatches(left, right) {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function normalizeCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

function parseRoute(pathValue, allowSocket = false) {
  if (typeof pathValue !== "string" || !pathValue.startsWith("/") || pathValue.length > MAX_PATH_LENGTH) {
    throw serviceError(400, "Invalid Nearby room path");
  }
  let url;
  try { url = new URL(pathValue, "https://nearby.arcade.invalid"); }
  catch { throw serviceError(400, "Invalid Nearby room path"); }
  if (url.origin !== "https://nearby.arcade.invalid" || url.hash) throw serviceError(400, "Invalid Nearby room path");
  const match = /^\/api\/(chess|arcade)\/rooms(?:\/([^/]+)\/(join|state|actions|ws))?$/.exec(url.pathname);
  if (!match) throw serviceError(404, "Not found");
  const kind = match[1];
  const operation = match[3] || "create";
  if (operation === "ws" && !allowSocket) throw serviceError(405, "Method not allowed");
  if (operation !== "ws" && url.search) throw serviceError(400, "Unexpected query parameters");
  const code = match[2] === undefined ? null : normalizeCode(match[2]);
  if (match[2] !== undefined && !code) throw serviceError(400, "Invalid room code");
  return { kind, code, operation, url };
}

function parseJsonBody(body, required = true) {
  if (body === undefined || body === null || body === "") {
    if (required) throw serviceError(400, "Request body must be an object");
    return {};
  }
  if (byteLength(body) > MAX_REQUEST_BYTES) throw serviceError(413, "Request body is too large");
  let value = body;
  if (typeof body === "string") {
    try { value = JSON.parse(body); }
    catch { throw serviceError(400, "Request body is not valid JSON"); }
  }
  if (!plainObject(value)) throw serviceError(400, "Request body must be an object");
  return value;
}

function headerValue(headers, wanted) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(wanted) || "";
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

function bearerFromHeaders(headers) {
  const match = /^Bearer\s+(.+)$/i.exec(headerValue(headers, "authorization"));
  return match ? match[1] : null;
}

function actionWithoutIdentityClaims(value) {
  const action = parseJsonBody(value);
  if (action.type === "rename") throw serviceError(403, "Nearby Arcade names are locked for this session");
  for (const field of FORBIDDEN_ACTION_IDENTITY_FIELDS) {
    if (Object.hasOwn(action, field)) throw serviceError(400, "Identity is supplied by Nearby Arcade, not by game actions");
  }
  return action;
}

function statusFor(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function errorMessage(error) {
  return statusFor(error) >= 500 ? "Nearby Arcade room error" : String(error?.message || "Nearby Arcade request failed");
}

function bindingTokenMatches(binding, candidate) {
  return Boolean(binding && typeof candidate === "string" && candidate === binding.token);
}

function rejectRoomBindingClaims(body, allowReconnectToken = false) {
  for (const field of ["memberId", "playerId", "seat", "side", "token"]) {
    if (Object.hasOwn(body, field)) throw serviceError(400, "Room bindings are supplied by Nearby Arcade");
  }
  if (!allowReconnectToken && Object.hasOwn(body, "reconnectToken")) throw serviceError(400, "Reconnect tokens are not accepted for room creation");
}

export class NearbyRoomService {
  constructor(options = {}) {
    this.members = new Map();
    this.rooms = new Map();
    this.sockets = new Map();
    this.listeners = new Set();
    this.tail = Promise.resolve();
    this.cryptoObject = options.cryptoObject || globalThis.crypto;
    if (typeof options.onEvent === "function") this.listeners.add(options.onEvent);
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Nearby room listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit(event) {
    const safe = clone(event);
    for (const listener of this.listeners) {
      try { listener(safe); } catch {}
    }
  }

  _enqueue(task) {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  async registerMember(identity) {
    return await this._enqueue(async () => {
      if (this.members.size >= MAX_MEMBERS && !this.members.has(String(identity?.memberId || ""))) throw serviceError(409, "Nearby Arcade is full");
      const member = normalizeIdentity(identity);
      const existing = this.members.get(member.memberId);
      if (existing) {
        if (existing.nickname !== member.nickname || existing.avatar !== member.avatar || existing.color !== member.color) {
          throw serviceError(409, "This Nearby Arcade identity is already locked");
        }
        existing.connected = member.connected;
        return publicIdentity(existing);
      }
      for (const candidate of this.members.values()) {
        if (normalizedNameMatches(candidate.nickname, member.nickname)) throw serviceError(409, "That nickname is reserved in this Nearby Arcade session");
      }
      this.members.set(member.memberId, member);
      return publicIdentity(member);
    });
  }

  async setMemberPresence(memberIdValue, connected) {
    return await this._enqueue(async () => {
      const memberId = cleanMemberId(memberIdValue);
      const member = this.members.get(memberId);
      if (!member) throw serviceError(401, "Unknown Nearby Arcade member");
      const changed = member.connected !== (connected === true);
      member.connected = connected === true;
      if (changed) {
        for (const entry of this.rooms.values()) {
          if (entry.bindings.has(memberId)) await this._broadcastRoom(entry);
        }
      }
      return publicIdentity(member);
    });
  }

  listMembers() {
    return Array.from(this.members.values(), publicIdentity);
  }

  _requireMember(memberIdValue) {
    const memberId = cleanMemberId(memberIdValue);
    const member = this.members.get(memberId);
    if (!member) throw serviceError(401, "Unknown Nearby Arcade member");
    return member;
  }

  _allocateCode(kind) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomCode();
      if (!this.rooms.has(roomKey(kind, code))) return code;
    }
    throw serviceError(503, "Could not allocate a room code");
  }

  _entry(kind, code) {
    const entry = this.rooms.get(roomKey(kind, code));
    if (!entry) throw serviceError(404, "Room not found");
    return entry;
  }

  _roomSockets(entry) {
    return Array.from(this.sockets.values()).filter((socket) => socket.kind === entry.kind && socket.code === entry.code);
  }

  _memberHasOpenRoomSocket(entry, memberId) {
    return this._roomSockets(entry).some((socket) => socket.memberId === memberId);
  }

  _chessPresence(entry) {
    const presence = { w: false, b: false };
    for (const binding of entry.bindings.values()) {
      const member = this.members.get(binding.memberId);
      if ((binding.side === "w" || binding.side === "b") && member?.connected && this._memberHasOpenRoomSocket(entry, binding.memberId)) presence[binding.side] = true;
    }
    return presence;
  }

  _genericPresence(entry) {
    const playerIds = new Set();
    for (const binding of entry.bindings.values()) {
      const member = this.members.get(binding.memberId);
      if (binding.playerId && member?.connected && this._memberHasOpenRoomSocket(entry, binding.memberId)) playerIds.add(binding.playerId);
    }
    return playerIds;
  }

  _assertGenericRoomWireSize(entry, model, room, extraBinding = null) {
    const presence = this._genericPresence(entry);
    const playerIds = new Set(Array.from(entry.bindings.values(), (binding) => binding.playerId).filter(Boolean));
    if (extraBinding?.playerId) playerIds.add(extraBinding.playerId);
    if (!playerIds.size) playerIds.add(null);
    for (const playerId of playerIds) {
      const publicRoom = model.public(room, playerId, presence);
      if (byteLength({ type: "state", room: publicRoom }) > MAX_PUBLIC_ROOM_BYTES) {
        throw serviceError(413, "Nearby room state is too large to synchronize safely");
      }
    }
  }

  _finishGenericDeparture(room, departedPlayerId, reason) {
    if (!room || room.game === "chat") return room;
    room.status = "finished";
    room.turn = null;
    room.result = {
      type: "abandoned",
      reason,
      departedPlayerId
    };
    return room;
  }

  async _publicRoom(entry, memberId, loadedRoom = null) {
    const binding = entry.bindings.get(memberId);
    if (!binding) throw serviceError(401, "This Nearby member is not bound to that game room");
    const room = loadedRoom || await entry.model.load();
    if (!room) throw serviceError(404, "Room not found");
    const result = entry.kind === "chess"
      ? entry.model.public(room, binding.side, this._chessPresence(entry))
      : entry.model.public(room, binding.playerId, this._genericPresence(entry));
    if (entry.kind === "arcade" && entry.game === "monopoly") {
      if (!validMonopolyRandom(entry.monopolyRandom)) entry.monopolyRandom = freshMonopolyRandom(this.cryptoObject);
      const ownsDecision = room.turn?.playerId === binding.playerId;
      result.nearbyRandom = ownsDecision ? clone(entry.monopolyRandom) : { version: 1, dice: null, utilityDice: null };
    }
    return result;
  }

  _validateSuppliedToken(entry, memberId, candidate, required = false) {
    const binding = entry.bindings.get(memberId);
    if (!candidate) {
      if (required) throw serviceError(403, "Reconnect token does not belong to this Nearby member");
      return binding;
    }
    if (!bindingTokenMatches(binding, candidate)) throw serviceError(403, "Reconnect token does not belong to this Nearby member");
    return binding;
  }

  _validateAuthorization(entry, memberId, headers) {
    const supplied = bearerFromHeaders(headers);
    if (supplied) this._validateSuppliedToken(entry, memberId, supplied, true);
    const binding = entry.bindings.get(memberId);
    if (!binding) throw serviceError(401, "This Nearby member is not bound to that game room");
    return binding;
  }

  async handleHttp(memberIdValue, request = {}) {
    return await this._enqueue(async () => {
      try {
        const member = this._requireMember(memberIdValue);
        if (!plainObject(request)) throw serviceError(400, "Nearby room request must be an object");
        const route = parseRoute(request.url ?? request.path ?? "");
        const method = String(request.method || "GET").toUpperCase();
        let result;
        if (route.operation === "create") {
          if (method !== "POST") throw serviceError(405, "Method not allowed");
          const body = parseJsonBody(request.body, route.kind !== "chess");
          result = await this._createRoom(member, route.kind, body);
        } else if (route.operation === "join") {
          if (method !== "POST") throw serviceError(405, "Method not allowed");
          result = await this._joinRoom(member, route.kind, route.code, parseJsonBody(request.body, false));
        } else if (route.operation === "state") {
          if (method !== "GET") throw serviceError(405, "Method not allowed");
          const entry = this._entry(route.kind, route.code);
          this._validateAuthorization(entry, member.memberId, request.headers);
          result = { ok: true, room: await this._publicRoom(entry, member.memberId) };
        } else if (route.operation === "actions") {
          if (method !== "POST") throw serviceError(405, "Method not allowed");
          const entry = this._entry(route.kind, route.code);
          this._validateAuthorization(entry, member.memberId, request.headers);
          result = await this._applyAction(entry, member.memberId, actionWithoutIdentityClaims(request.body));
        } else {
          throw serviceError(405, "Method not allowed");
        }
        return { status: 200, body: result };
      } catch (error) {
        return { status: statusFor(error), body: { ok: false, error: errorMessage(error) } };
      }
    });
  }

  async _createRoom(member, kind, body) {
    rejectRoomBindingClaims(body, false);
    if (this.rooms.size >= MAX_ROOMS) throw serviceError(409, "Too many Nearby game rooms are active");
    const code = this._allocateCode(kind);
    const storage = new MemoryStorage();
    if (kind === "chess") {
      const model = new RoomModel(storage);
      const created = await model.create(code);
      const entry = { kind, code, game: "chess", storage, model, bindings: new Map(), completionKey: null };
      entry.bindings.set(member.memberId, { memberId: member.memberId, token: created.token, side: created.side });
      this.rooms.set(roomKey(kind, code), entry);
      return { ok: true, ...created, room: await this._publicRoom(entry, member.memberId) };
    }
    const model = new GenericRoomModel(storage);
    const created = await model.create({
      code,
      game: body.game,
      username: member.nickname,
      maxPlayers: body.maxPlayers,
      state: Object.hasOwn(body, "state") ? body.state : null
    });
    const entry = { kind, code, game: created.room.game, storage, model, bindings: new Map(), completionKey: null };
    if (entry.game === "monopoly") entry.monopolyRandom = freshMonopolyRandom(this.cryptoObject);
    const binding = {
      memberId: member.memberId,
      token: created.token,
      playerId: created.playerId,
      seat: created.seat
    };
    this._assertGenericRoomWireSize(entry, model, await model.load(), binding);
    entry.bindings.set(member.memberId, binding);
    this.rooms.set(roomKey(kind, code), entry);
    return { ok: true, ...created, room: await this._publicRoom(entry, member.memberId) };
  }

  async _joinRoom(member, kind, code, body) {
    rejectRoomBindingClaims(body, true);
    const entry = this._entry(kind, code);
    const existing = entry.bindings.get(member.memberId) || null;
    const suppliedToken = body.reconnectToken == null ? null : String(body.reconnectToken);
    if (suppliedToken) this._validateSuppliedToken(entry, member.memberId, suppliedToken, true);
    if (existing) {
      try {
        const restored = kind === "chess"
          ? await entry.model.join(existing.token)
          : await entry.model.join({ reconnectToken: existing.token });
        await this._broadcastRoom(entry);
        return { ok: true, ...restored, room: await this._publicRoom(entry, member.memberId) };
      } catch (error) {
        if (suppliedToken || statusFor(error) !== 401 || kind === "chess") throw error;
        entry.bindings.delete(member.memberId);
      }
    } else if (suppliedToken) {
      throw serviceError(403, "Reconnect token does not belong to this Nearby member");
    }

    if (kind === "chess") {
      const joined = await entry.model.join();
      entry.bindings.set(member.memberId, { memberId: member.memberId, token: joined.token, side: joined.side });
      await this._broadcastRoom(entry);
      return { ok: true, ...joined, room: await this._publicRoom(entry, member.memberId) };
    }
    const current = await entry.model.load();
    const candidateStorage = new MemoryStorage();
    await candidateStorage.put("room", current);
    const candidateModel = new GenericRoomModel(candidateStorage);
    const joined = await candidateModel.join({ username: member.nickname });
    const binding = {
      memberId: member.memberId,
      token: joined.token,
      playerId: joined.playerId,
      seat: joined.seat
    };
    const candidate = await candidateModel.load();
    this._assertGenericRoomWireSize(entry, candidateModel, candidate, binding);
    await entry.storage.put("room", candidate);
    entry.bindings.set(member.memberId, binding);
    await this._broadcastRoom(entry);
    return { ok: true, ...joined, room: await this._publicRoom(entry, member.memberId) };
  }

  async _applyAction(entry, memberId, action) {
    const binding = entry.bindings.get(memberId);
    if (!binding) throw serviceError(401, "This Nearby member is not bound to that game room");
    let room;
    if (entry.kind === "chess") {
      room = await entry.model.actAsSide(binding.side, action, this._chessPresence(entry));
    } else {
      const current = await entry.model.load();
      const roomMember = current?.members?.find((candidate) => candidate.playerId === binding.playerId && !candidate.leftAt);
      if (!roomMember && action.type !== "leave") throw serviceError(401, "This Nearby member no longer owns an active room seat");
      if (roomMember && current.game === "monopoly" && action.type === "monopoly-random") {
        const expectedVersion = Number(action.expectedVersion);
        if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) throw serviceError(409, "Room state changed; refresh and try again");
        if (current.status !== "active" || current.turn?.playerId !== roomMember.playerId) throw serviceError(403, "It is not your turn");
        if (!validMonopolyRandom(entry.monopolyRandom)) entry.monopolyRandom = freshMonopolyRandom(this.cryptoObject);
        if (action.kind === "roll") {
          if (!(current.state?.phase === "roll" || (current.state?.phase === "end" && current.state?.extraRoll))) throw serviceError(409, "Monopoly is not waiting for a roll");
          if (!entry.monopolyRandom.dice) entry.monopolyRandom.dice = freshMonopolyDice(this.cryptoObject);
        } else if (action.kind === "utility") {
          if (!(current.state?.phase === "cardDraw" && current.state?.pendingCard?.id === "c_util")) throw serviceError(409, "Monopoly is not waiting for utility dice");
          if (!entry.monopolyRandom.utilityDice) entry.monopolyRandom.utilityDice = freshMonopolyDice(this.cryptoObject);
        } else throw serviceError(400, "Unsupported Monopoly random request");
        await this._broadcastRoom(entry);
        return { ok: true, room: await this._publicRoom(entry, memberId, current) };
      }
      if (roomMember && !["chat", "leave", "rename"].includes(action.type)) {
        const expectedVersion = Number(action.expectedVersion);
        if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) throw serviceError(409, "Room state changed; refresh and try again");
        if (["start", "restart", "state"].includes(action.type) && Object.hasOwn(action, "state") && byteLength(action.state) > MAX_GENERIC_STATE_WIRE_BYTES) {
          throw serviceError(413, "Nearby game state is too large to synchronize safely");
        }
        if (action.type === "start" || action.type === "restart") {
          if (current.hostPlayerId !== roomMember.playerId) throw serviceError(403, "Only the room host can start the game");
        } else if (action.type === "state") {
          if (current.status !== "active" || !current.turn) throw serviceError(409, "Game is not active");
          if (current.turn.playerId !== roomMember.playerId) throw serviceError(403, "It is not your turn");
        }
        if (current.game === "sorry" && (action.type === "start" || action.type === "restart")) {
          action = canonicalizeSorryStart(action, this.cryptoObject);
        }
        if (current.game === "monopoly") {
          if (action.type === "start" || action.type === "restart") {
            const state = clone(action.state);
            canonicalizeMonopolyStartRandomness(state, (maximum) => secureRandomIndex(maximum, this.cryptoObject));
            action = { ...action, state };
          } else if (action.type === "state" && action.intent?.kind === "roll") {
            if (!validMonopolyRandom(entry.monopolyRandom) || !Array.isArray(entry.monopolyRandom.dice) || action.intent.d1 !== entry.monopolyRandom.dice[0] || action.intent.d2 !== entry.monopolyRandom.dice[1]) {
              throw serviceError(422, "Use the dice supplied by the Nearby Monopoly host");
            }
          } else if (action.type === "state" && action.intent?.kind === "resolve-card" && current.state?.pendingCard?.id === "c_util") {
            if (!validMonopolyRandom(entry.monopolyRandom) || !Array.isArray(entry.monopolyRandom.utilityDice) || action.state?.lastRoll?.[0] !== entry.monopolyRandom.utilityDice[0] || action.state?.lastRoll?.[1] !== entry.monopolyRandom.utilityDice[1]) {
              throw serviceError(422, "Use the utility dice supplied by the Nearby Monopoly host");
            }
          }
          if (action.type === "state" && entry.monopolyRandom?.dice && action.intent?.kind !== "roll") throw serviceError(409, "Complete the committed Nearby Monopoly roll first");
          if (action.type === "state" && entry.monopolyRandom?.utilityDice && !(action.intent?.kind === "resolve-card" && current.state?.pendingCard?.id === "c_util")) throw serviceError(409, "Complete the committed Nearby Monopoly utility roll first");
        }
        validateGenericGameAction(current, roomMember, action);
      }
      const candidateStorage = new MemoryStorage();
      await candidateStorage.put("room", current);
      const candidateModel = new GenericRoomModel(candidateStorage);
      room = action.type === "leave"
        ? await candidateModel.act(binding.token, action, this._genericPresence(entry))
        : await candidateModel.actAsPlayer(binding.playerId, action, this._genericPresence(entry));
      let candidate = await candidateModel.load();
      if (action.type === "leave" && current?.status === "active" && current.game !== "chat") {
        candidate = this._finishGenericDeparture(candidate, binding.playerId, "player-left");
        await candidateModel.save(candidate);
      }
      this._assertGenericRoomWireSize(entry, candidateModel, candidate);
      await entry.storage.put("room", candidate);
      if (entry.game === "monopoly" && action.type === "state" && action.intent?.kind === "roll") {
        entry.monopolyRandom = { ...entry.monopolyRandom, dice: null };
      } else if (entry.game === "monopoly" && action.type === "state" && action.intent?.kind === "resolve-card" && current.state?.pendingCard?.id === "c_util") {
        entry.monopolyRandom = { ...entry.monopolyRandom, utilityDice: null };
      }
    }
    if (entry.kind === "chess" && action.type === "leave") {
      await this._closeMemberRoomSockets(entry, memberId, "Left room");
      entry.bindings.delete(memberId);
      if (!entry.bindings.size) this.rooms.delete(roomKey(entry.kind, entry.code));
      else {
        await this._broadcastRoom(entry);
        await this._emitCompletionIfNew(entry);
      }
      return { ok: true, room: null };
    }
    if (entry.kind === "arcade" && action.type === "leave") {
      await this._closeMemberRoomSockets(entry, memberId, "Left room");
      entry.bindings.delete(memberId);
      if (!entry.bindings.size) this.rooms.delete(roomKey(entry.kind, entry.code));
      else {
        await this._broadcastRoom(entry);
        await this._emitCompletionIfNew(entry);
      }
      return { ok: true, room: null };
    }
    await this._broadcastRoom(entry);
    await this._emitCompletionIfNew(entry);
    return { ok: true, room: await this._publicRoom(entry, memberId, await entry.model.load()).catch(() => room) };
  }

  async openSocket(memberIdValue, request = {}) {
    return await this._enqueue(async () => {
      const member = this._requireMember(memberIdValue);
      if (!plainObject(request)) throw serviceError(400, "Nearby socket request must be an object");
      const socketId = String(request.socketId || "");
      if (!MEMBER_ID_PATTERN.test(socketId) || socketId.length > 128) throw serviceError(400, "Invalid Nearby socket identity");
      if (this.sockets.size >= MAX_SOCKETS && !this.sockets.has(socketId)) throw serviceError(409, "Too many Nearby room sockets are open");
      if (this.sockets.has(socketId)) throw serviceError(409, "Nearby socket is already open");
      const route = parseRoute(request.url ?? request.path ?? "", true);
      if (route.operation !== "ws") throw serviceError(400, "Nearby socket path must end in /ws");
      const entry = this._entry(route.kind, route.code);
      const token = route.url.searchParams.get("token") || "";
      if (Array.from(route.url.searchParams.keys()).some((key) => key !== "token")) throw serviceError(400, "Unexpected socket query parameters");
      this._validateSuppliedToken(entry, member.memberId, token, true);
      this.sockets.set(socketId, { socketId, memberId: member.memberId, kind: route.kind, code: route.code });
      const initialRoom = await this._publicRoom(entry, member.memberId);
      await this._broadcastRoom(entry, socketId);
      return { ok: true, socketId, initialData: JSON.stringify({ type: "state", room: initialRoom }) };
    });
  }

  async sendSocket(memberIdValue, request = {}) {
    return await this._enqueue(async () => {
      const member = this._requireMember(memberIdValue);
      const socketId = String(request.socketId || "");
      const socket = this.sockets.get(socketId);
      if (!socket || socket.memberId !== member.memberId) throw serviceError(403, "Nearby socket does not belong to this member");
      const entry = this._entry(socket.kind, socket.code);
      try {
        const action = actionWithoutIdentityClaims(request.data);
        const result = await this._applyAction(entry, member.memberId, action);
        return { ok: true, version: result.room?.version ?? null };
      } catch (error) {
        this._emit({
          type: "socket-message",
          targetMemberId: member.memberId,
          socketId,
          data: JSON.stringify({ type: "error", status: statusFor(error), error: errorMessage(error) })
        });
        return { ok: true, rejected: true, status: statusFor(error) };
      }
    });
  }

  async closeSocket(memberIdValue, request = {}) {
    return await this._enqueue(async () => {
      const member = this._requireMember(memberIdValue);
      const socketId = String(request.socketId || "");
      const socket = this.sockets.get(socketId);
      if (!socket || socket.memberId !== member.memberId) return { ok: true, closed: false };
      const entry = this.rooms.get(roomKey(socket.kind, socket.code));
      this.sockets.delete(socketId);
      if (entry) await this._broadcastRoom(entry);
      return { ok: true, closed: true };
    });
  }

  async closeMemberSockets(memberIdValue, reason = "Nearby connection closed") {
    return await this._enqueue(async () => {
      const member = this._requireMember(memberIdValue);
      const affected = new Set();
      let closed = 0;
      for (const socket of Array.from(this.sockets.values())) {
        if (socket.memberId !== member.memberId) continue;
        this.sockets.delete(socket.socketId);
        affected.add(roomKey(socket.kind, socket.code));
        closed += 1;
        this._emit({
          type: "socket-close",
          targetMemberId: member.memberId,
          socketId: socket.socketId,
          code: 1000,
          reason: String(reason || "Nearby connection closed").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120),
          clean: true
        });
      }
      for (const key of affected) {
        const entry = this.rooms.get(key);
        if (entry) await this._broadcastRoom(entry);
      }
      return { ok: true, closed };
    });
  }

  async removeMemberFromRooms(memberIdValue, reason = "Removed from Nearby Arcade") {
    return await this._enqueue(async () => {
      const member = this._requireMember(memberIdValue);
      const affected = [];
      member.connected = false;
      for (const [key, entry] of Array.from(this.rooms.entries())) {
        const binding = entry.bindings.get(member.memberId);
        if (!binding) continue;
        const otherBindings = Array.from(entry.bindings.values()).filter((candidate) => candidate.memberId !== member.memberId);
        let outcome = "detached";
        if (entry.kind === "chess") {
          const stored = await entry.model.load();
          if (!stored?.game?.result?.over && otherBindings.length) {
            await entry.model.actAsSide(binding.side, { type: "resign", expectedVersion: stored.version }, this._chessPresence(entry));
            outcome = "resigned";
          }
        } else {
          const beforeLeave = await entry.model.load();
          await entry.model.act(binding.token, { type: "leave" }, this._genericPresence(entry));
          let stored = await entry.model.load();
          if (beforeLeave?.status === "active" && beforeLeave.game !== "chat") {
            stored = this._finishGenericDeparture(stored, binding.playerId, "player-removed");
            await entry.model.save(stored);
          }
          outcome = stored?.status === "finished" ? "ended" : "left";
        }
        await this._closeMemberRoomSockets(entry, member.memberId, reason);
        entry.bindings.delete(member.memberId);
        if (!entry.bindings.size) {
          this.rooms.delete(key);
          outcome = "removed-room";
        } else {
          await this._broadcastRoom(entry);
          await this._emitCompletionIfNew(entry);
        }
        affected.push({ kind: entry.kind, code: entry.code, game: entry.game, outcome });
      }
      return { ok: true, member: publicIdentity(member), rooms: affected };
    });
  }

  async _closeMemberRoomSockets(entry, memberId, reason) {
    for (const socket of this._roomSockets(entry)) {
      if (socket.memberId !== memberId) continue;
      this.sockets.delete(socket.socketId);
      this._emit({ type: "socket-close", targetMemberId: memberId, socketId: socket.socketId, code: 1000, reason: String(reason || "") });
    }
  }

  async _broadcastRoom(entry, skipSocketId = null) {
    const room = await entry.model.load();
    if (!room) return;
    const publicByMember = new Map();
    for (const socket of this._roomSockets(entry)) {
      if (socket.socketId === skipSocketId) continue;
      if (!publicByMember.has(socket.memberId)) {
        try { publicByMember.set(socket.memberId, await this._publicRoom(entry, socket.memberId, room)); }
        catch { continue; }
      }
      this._emit({
        type: "socket-message",
        targetMemberId: socket.memberId,
        socketId: socket.socketId,
        data: JSON.stringify({ type: "state", room: publicByMember.get(socket.memberId) })
      });
    }
    for (const [memberId, publicRoom] of publicByMember) {
      this._emit({ type: "room-state", targetMemberId: memberId, roomKind: entry.kind, roomCode: entry.code, room: publicRoom });
    }
  }

  _completionFromRoom(entry, room) {
    if (entry.kind === "chess") {
      const result = room?.game?.result;
      if (!result?.over) return null;
      const winnerBinding = result.winner ? Array.from(entry.bindings.values()).find((binding) => binding.side === result.winner) : null;
      return {
        completionId: entry.completionKey || `terminal:${entry.kind}:${entry.code}:${room.version}`,
        canonical: true,
        verifiedRules: true,
        authority: NEARBY_CHESS_AUTHORITY_CONTRACT.id,
        gameId: "chess",
        roomCode: entry.code,
        version: room.version,
        winnerMemberId: winnerBinding?.memberId || null,
        winnerPlayerId: winnerBinding?.memberId || null,
        winnerSeat: result.winner || null,
        tie: !result.winner,
        result: clone(result)
      };
    }
    if (room?.game === "tic-tac-toe" && room?.status === "active" && room.state?.roundOver) {
      const winnerMark = room.state.roundOver.winner;
      const active = room.members.filter((candidate) => !candidate.leftAt).sort((left, right) => left.seat - right.seat);
      const winnerSeat = winnerMark === "X" ? active[0]?.seat ?? null : winnerMark === "O" ? active[1]?.seat ?? null : null;
      const winnerPlayerId = winnerSeat === null ? null : active.find((candidate) => candidate.seat === winnerSeat)?.playerId || null;
      const winnerBinding = winnerPlayerId ? Array.from(entry.bindings.values()).find((binding) => binding.playerId === winnerPlayerId) : null;
      return {
        completionId: entry.completionKey || `terminal:${entry.kind}:${entry.code}:${room.version}`,
        canonical: true,
        verifiedRules: true,
        authority: authorityForGenericGame(room.game)?.id || NEARBY_GENERIC_AUTHORITY_CONTRACT.id,
        gameId: room.game,
        roomCode: entry.code,
        version: room.version,
        winnerMemberId: winnerBinding?.memberId || null,
        winnerPlayerId,
        winnerSeat,
        tie: winnerMark === "D",
        result: {
          type: "round",
          winner: winnerMark,
          line: clone(room.state.roundOver.line),
          scoreX: room.state.scoreX,
          scoreO: room.state.scoreO
        }
      };
    }
    if (room?.status !== "finished") return null;
    const authority = authorityForGenericGame(room.game) || NEARBY_GENERIC_AUTHORITY_CONTRACT;
    const result = room.result == null ? null : clone(room.result);
    let winnerPlayerId = typeof result?.winnerPlayerId === "string" ? result.winnerPlayerId : null;
    let winnerSeat = Number.isInteger(result?.winnerSeat) ? result.winnerSeat : Number.isInteger(result?.winner) ? result.winner : null;
    if (!winnerPlayerId && winnerSeat !== null) {
      winnerPlayerId = room.members.find((candidate) => !candidate.leftAt && candidate.seat === winnerSeat)?.playerId || null;
    }
    if (!winnerPlayerId && room.game === "memory" && Array.isArray(result?.winners) && result.winners.length === 1) {
      const winnerName = String(result.winners[0] || "");
      winnerPlayerId = room.members.find((candidate) => !candidate.leftAt && candidate.username === winnerName)?.playerId || null;
      winnerSeat = winnerPlayerId ? room.members.find((candidate) => candidate.playerId === winnerPlayerId)?.seat ?? null : null;
    }
    const winnerBinding = winnerPlayerId ? Array.from(entry.bindings.values()).find((binding) => binding.playerId === winnerPlayerId) : null;
    return {
      completionId: entry.completionKey || `terminal:${entry.kind}:${entry.code}:${room.version}`,
      canonical: true,
      verifiedRules: authority.completionVerified === true,
      authority: authority.id || NEARBY_GENERIC_AUTHORITY_CONTRACT.id,
      gameId: room.game,
      roomCode: entry.code,
      version: room.version,
      winnerMemberId: winnerBinding?.memberId || null,
      winnerPlayerId,
      winnerSeat,
      tie: result?.tie === true || (winnerPlayerId === null && winnerSeat === null && result?.type !== "abandoned"),
      result
    };
  }

  async _emitCompletionIfNew(entry) {
    const room = await entry.model.load();
    const completion = this._completionFromRoom(entry, room);
    if (!completion) {
      entry.completionKey = null;
      return;
    }
    if (entry.completionKey) return;
    entry.completionKey = completion.completionId;
    this._emit({ type: "completion", roomKind: entry.kind, roomCode: entry.code, completion });
  }

  async completionFor(kindValue, codeValue) {
    return await this._enqueue(async () => {
      const kind = kindValue === "chess" ? "chess" : kindValue === "arcade" ? "arcade" : null;
      const code = normalizeCode(codeValue);
      if (!kind || !code) throw serviceError(400, "Invalid Nearby room identity");
      const entry = this._entry(kind, code);
      const completion = this._completionFromRoom(entry, await entry.model.load());
      if (completion && !entry.completionKey) entry.completionKey = completion.completionId;
      return completion;
    });
  }

  async exportCheckpoint() {
    return await this._enqueue(async () => {
      const checkpoint = {
        schema: NEARBY_ROOM_SERVICE_VERSION,
        contracts: {
          chess: NEARBY_CHESS_AUTHORITY_CONTRACT.id,
          generic: NEARBY_GENERIC_AUTHORITY_CONTRACT.id
        },
        members: Array.from(this.members.values(), (member) => ({ ...publicIdentity(member), connected: false })),
        rooms: []
      };
      for (const entry of this.rooms.values()) {
        const state = await entry.model.load();
        if (!state) continue;
        checkpoint.rooms.push({
          kind: entry.kind,
          code: entry.code,
          game: entry.game,
          state,
          bindings: Array.from(entry.bindings.values(), (binding) => ({ ...binding })),
          completionKey: entry.completionKey,
          ...(entry.game === "monopoly" && validMonopolyRandom(entry.monopolyRandom) ? { monopolyRandom: clone(entry.monopolyRandom) } : {})
        });
      }
      if (byteLength(checkpoint) > MAX_CHECKPOINT_BYTES) throw serviceError(413, "Nearby room checkpoint is too large");
      return clone(checkpoint);
    });
  }

  async importCheckpoint(checkpointValue) {
    return await this._enqueue(async () => {
      if (byteLength(checkpointValue) > MAX_CHECKPOINT_BYTES) throw serviceError(413, "Nearby room checkpoint is too large");
      const checkpoint = clone(checkpointValue);
      if (!plainObject(checkpoint) || checkpoint.schema !== NEARBY_ROOM_SERVICE_VERSION || !Array.isArray(checkpoint.members) || !Array.isArray(checkpoint.rooms)) {
        throw serviceError(400, "Unsupported Nearby room checkpoint");
      }
      if (checkpoint.contracts && (
        checkpoint.contracts.chess !== NEARBY_CHESS_AUTHORITY_CONTRACT.id ||
        checkpoint.contracts.generic !== NEARBY_GENERIC_AUTHORITY_CONTRACT.id
      )) throw serviceError(400, "Nearby room checkpoint uses incompatible authority contracts");
      if (checkpoint.members.length > MAX_MEMBERS || checkpoint.rooms.length > MAX_ROOMS) throw serviceError(413, "Nearby room checkpoint exceeds supported limits");
      const members = new Map();
      for (const value of checkpoint.members) {
        const member = normalizeIdentity({ ...value, connected: false });
        if (members.has(member.memberId)) throw serviceError(400, "Duplicate checkpoint member");
        for (const candidate of members.values()) {
          if (normalizedNameMatches(candidate.nickname, member.nickname)) throw serviceError(400, "Duplicate checkpoint nickname");
        }
        members.set(member.memberId, member);
      }
      const rooms = new Map();
      for (const saved of checkpoint.rooms) {
        if (!plainObject(saved) || (saved.kind !== "chess" && saved.kind !== "arcade")) throw serviceError(400, "Invalid checkpoint room");
        const code = normalizeCode(saved.code);
        if (!code || !plainObject(saved.state) || !Array.isArray(saved.bindings)) throw serviceError(400, "Invalid checkpoint room");
        if (rooms.has(roomKey(saved.kind, code))) throw serviceError(400, "Duplicate checkpoint room");
        const storage = new MemoryStorage();
        await storage.put("room", saved.state);
        const model = saved.kind === "chess" ? new RoomModel(storage) : new GenericRoomModel(storage);
        const entry = {
          kind: saved.kind,
          code,
          game: saved.kind === "chess" ? "chess" : String(saved.state.game || saved.game || ""),
          storage,
          model,
          bindings: new Map(),
          completionKey: typeof saved.completionKey === "string" ? saved.completionKey : null
        };
        if (entry.game === "monopoly") entry.monopolyRandom = validMonopolyRandom(saved.monopolyRandom) ? clone(saved.monopolyRandom) : freshMonopolyRandom(this.cryptoObject);
        if (saved.kind === "arcade" && !GAME_TYPES[entry.game]) throw serviceError(400, "Unsupported checkpoint game");
        const loaded = await model.load();
        if (loaded.code !== code || loaded.schema !== 1) throw serviceError(400, "Checkpoint room state does not match its identity");
        if (saved.kind === "arcade") {
          if (byteLength(loaded.state) > GENERIC_ROOM_LIMITS.MAX_STATE_BYTES || byteLength(loaded.result) > GENERIC_ROOM_LIMITS.MAX_RESULT_BYTES) {
            throw serviceError(413, "Checkpoint room payload exceeds online-parity limits");
          }
        } else {
          try { model.public(loaded, null); }
          catch { throw serviceError(400, "Checkpoint Chess state is invalid"); }
        }
        for (const rawBinding of saved.bindings) {
          if (!plainObject(rawBinding)) throw serviceError(400, "Invalid checkpoint room binding");
          const memberId = cleanMemberId(rawBinding.memberId);
          if (!members.has(memberId) || entry.bindings.has(memberId) || typeof rawBinding.token !== "string") throw serviceError(400, "Invalid checkpoint room binding");
          if (saved.kind === "chess") {
            const side = await model.sideForToken(loaded, rawBinding.token);
            if (!side || side !== rawBinding.side) throw serviceError(400, "Checkpoint Chess binding is invalid");
            entry.bindings.set(memberId, { memberId, token: rawBinding.token, side });
          } else {
            const hash = await tokenHash(rawBinding.token);
            const roomMember = model.memberForHash(loaded, hash, true);
            if (!roomMember || roomMember.playerId !== rawBinding.playerId || roomMember.seat !== rawBinding.seat) throw serviceError(400, "Checkpoint room binding is invalid");
            entry.bindings.set(memberId, { memberId, token: rawBinding.token, playerId: roomMember.playerId, seat: roomMember.seat });
          }
        }
        if (saved.kind === "arcade") this._assertGenericRoomWireSize(entry, model, loaded);
        rooms.set(roomKey(saved.kind, code), entry);
      }
      this.members = members;
      this.rooms = rooms;
      this.sockets.clear();
      return { members: this.listMembers(), rooms: this.rooms.size };
    });
  }
}

export const NEARBY_ROOM_LIMITS = Object.freeze({
  MAX_REQUEST_BYTES,
  MAX_CHECKPOINT_BYTES,
  MAX_PATH_LENGTH,
  MAX_ROOMS,
  MAX_MEMBERS,
  MAX_SOCKETS,
  MAX_PUBLIC_ROOM_BYTES,
  MAX_GENERIC_STATE_WIRE_BYTES
});
