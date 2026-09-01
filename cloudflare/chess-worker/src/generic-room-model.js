import { randomToken, tokenHash } from "./room-model.js";

const ROOM_KEY = "room";
const MAX_STATE_BYTES = 256 * 1024;
const MAX_RESULT_BYTES = 16 * 1024;
const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_LENGTH = 500;
const MAX_DEPARTED_MEMBERS = 32;
const CHAT_MIN_INTERVAL_MS = 350;
const CHAT_BURST_WINDOW_MS = 10_000;
const CHAT_BURST_LIMIT = 12;
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,23}$/u;

export const GAME_TYPES = Object.freeze({
  sorry: Object.freeze({ minPlayers: 2, minSeats: 2, maxSeats: 4 }),
  monopoly: Object.freeze({ minPlayers: 2, minSeats: 2, maxSeats: 6 }),
  memory: Object.freeze({ minPlayers: 2, minSeats: 2, maxSeats: 4 }),
  "tic-tac-toe": Object.freeze({ minPlayers: 2, minSeats: 2, maxSeats: 2 }),
  dots: Object.freeze({ minPlayers: 2, minSeats: 2, maxSeats: 4 }),
  checkers: Object.freeze({ minPlayers: 2, minSeats: 2, maxSeats: 2 }),
  chat: Object.freeze({ minPlayers: 1, minSeats: 1, maxSeats: 32 })
});

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomId(prefix) {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `${prefix}_${base64Url(bytes)}`;
}

function activeMembers(room) {
  return room.members.filter((member) => !member.leftAt);
}

function compactMembers(room) {
  const active = activeMembers(room);
  const departed = room.members.filter((member) => member.leftAt).sort((a, b) => String(b.leftAt).localeCompare(String(a.leftAt))).slice(0, MAX_DEPARTED_MEMBERS);
  room.members = [...active, ...departed];
}

function memberAtSeat(room, seat) {
  return activeMembers(room).find((member) => member.seat === seat) || null;
}

function nextOccupiedSeat(room, afterSeat) {
  const seats = activeMembers(room).map((member) => member.seat).sort((a, b) => a - b);
  if (!seats.length) return null;
  return seats.find((seat) => seat > afterSeat) ?? seats[0];
}

function requireExactVersion(room, action) {
  const expectedVersion = Number(action?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== room.version) {
    throw httpError(409, "Room state changed; refresh and try again");
  }
}

function jsonBytes(value, label) {
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw httpError(400, `${label} must be valid JSON`); }
  if (serialized === undefined) throw httpError(400, `${label} must be valid JSON`);
  return new TextEncoder().encode(serialized).byteLength;
}

function validatedJson(value, label, maxBytes) {
  if (jsonBytes(value, label) > maxBytes) throw httpError(413, `${label} is too large`);
  return value;
}

export function normalizeUsername(value) {
  const username = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!USERNAME_PATTERN.test(username)) {
    throw httpError(400, "Username must be 1-24 letters, numbers, spaces, apostrophes, periods, underscores, or hyphens");
  }
  return username;
}

function normalizeChatText(value) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw httpError(400, "Message cannot be empty");
  if (text.length > MAX_CHAT_LENGTH) throw httpError(413, `Message cannot exceed ${MAX_CHAT_LENGTH} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw httpError(400, "Message contains unsupported control characters");
  return text;
}

function normalizeGame(value) {
  const game = String(value ?? "").trim().toLowerCase();
  if (!GAME_TYPES[game]) throw httpError(400, "Unsupported game type");
  return game;
}

function normalizeMaxPlayers(game, value) {
  const config = GAME_TYPES[game];
  const fallback = config.maxSeats;
  const maxPlayers = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(maxPlayers) || maxPlayers < config.minSeats || maxPlayers > config.maxSeats) {
    throw httpError(400, `${game} rooms support ${config.minSeats}-${config.maxSeats} players`);
  }
  return maxPlayers;
}

export class GenericRoomModel {
  constructor(storage) {
    this.storage = storage;
  }

  async load() {
    return await this.storage.get(ROOM_KEY) || null;
  }

  async save(room) {
    room.updatedAt = nowIso();
    await this.storage.put(ROOM_KEY, room);
    return room;
  }

  memberForHash(room, hash, includeLeft = false) {
    if (!hash) return null;
    return room.members.find((member) => member.tokenHash === hash && (includeLeft || !member.leftAt)) || null;
  }

  async loadForToken(token, includeLeft = false) {
    // Hash before reading storage. A non-storage await after load could reopen the
    // Durable Object input gate and let another request mutate this room first.
    const hash = await tokenHash(token);
    const room = await this.load();
    return { room, member: room ? this.memberForHash(room, hash, includeLeft) : null };
  }

  ensureUniqueUsername(room, username, excludingPlayerId = null) {
    const collision = activeMembers(room).some((member) => member.playerId !== excludingPlayerId && member.username.localeCompare(username, undefined, { sensitivity: "accent" }) === 0);
    if (collision) throw httpError(409, "That username is already in use in this room");
  }

  async create({ code, game: gameValue, username: usernameValue, maxPlayers: requestedMaxPlayers, state = null }) {
    const game = normalizeGame(gameValue);
    const username = normalizeUsername(usernameValue);
    const maxPlayers = normalizeMaxPlayers(game, requestedMaxPlayers);
    validatedJson(state, "State", MAX_STATE_BYTES);
    const token = randomToken();
    const reconnectHash = await tokenHash(token);
    if (await this.load()) throw httpError(409, "Room already exists");
    const playerId = randomId("p");
    const timestamp = nowIso();
    const room = {
      schema: 1,
      code,
      game,
      version: 1,
      revision: 1,
      chatVersion: 0,
      status: game === "chat" ? "active" : "lobby",
      hostPlayerId: playerId,
      minPlayers: GAME_TYPES[game].minPlayers,
      maxPlayers,
      members: [{
        playerId,
        seat: 0,
        username,
        tokenHash: reconnectHash,
        joinedAt: timestamp,
        leftAt: null,
        lastChatAt: 0,
        chatWindowStartedAt: 0,
        chatWindowCount: 0
      }],
      turn: null,
      state,
      result: null,
      chat: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.save(room);
    return { code, token, playerId, seat: 0, room: this.public(room, playerId) };
  }

  async join({ username: usernameValue, reconnectToken = null }) {
    const preparedToken = reconnectToken || randomToken();
    const preparedHash = await tokenHash(preparedToken);
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    if (reconnectToken) {
      const member = this.memberForHash(room, preparedHash);
      if (!member) throw httpError(401, "Reconnect token is not valid for this room");
      return { code: room.code, token: reconnectToken, playerId: member.playerId, seat: member.seat, room: this.public(room, member.playerId) };
    }
    if (room.game !== "chat" && room.status !== "lobby") throw httpError(409, "This game has already started");
    const members = activeMembers(room);
    if (room.game === "chat" && room.status === "finished" && !members.length) throw httpError(410, "This chat room has closed");
    if (members.length >= room.maxPlayers) throw httpError(409, "This room is full");
    const username = normalizeUsername(usernameValue);
    this.ensureUniqueUsername(room, username);
    let seat = 0;
    const occupied = new Set(members.map((member) => member.seat));
    while (occupied.has(seat) && seat < room.maxPlayers) seat++;
    if (seat >= room.maxPlayers) throw httpError(409, "This room is full");
    const token = preparedToken;
    const member = {
      playerId: randomId("p"),
      seat,
      username,
      tokenHash: preparedHash,
      joinedAt: nowIso(),
      leftAt: null,
      lastChatAt: 0,
      chatWindowStartedAt: 0,
      chatWindowCount: 0
    };
    room.members.push(member);
    room.version++;
    room.revision++;
    await this.save(room);
    return { code: room.code, token, playerId: member.playerId, seat, room: this.public(room, member.playerId) };
  }

  public(room, viewerPlayerId = null, connectedPlayerIds = new Set()) {
    const connected = connectedPlayerIds instanceof Set ? connectedPlayerIds : new Set(connectedPlayerIds || []);
    const members = activeMembers(room).sort((a, b) => a.seat - b.seat).map((member) => ({
      playerId: member.playerId,
      seat: member.seat,
      username: member.username,
      connected: connected.has(member.playerId),
      joinedAt: member.joinedAt
    }));
    const viewer = room.members.find((member) => member.playerId === viewerPlayerId) || null;
    return {
      code: room.code,
      game: room.game,
      version: room.version,
      revision: room.revision,
      chatVersion: room.chatVersion,
      status: room.status,
      ready: members.length >= room.minPlayers,
      hostPlayerId: room.hostPlayerId,
      minPlayers: room.minPlayers,
      maxPlayers: room.maxPlayers,
      playerId: viewer?.playerId || null,
      seat: viewer?.seat ?? null,
      members,
      presence: Object.fromEntries(members.map((member) => [member.playerId, member.connected])),
      turn: room.turn,
      state: room.state,
      result: room.result,
      chat: room.chat,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt
    };
  }

  async state(token, connectedPlayerIds) {
    const hash = await tokenHash(token);
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    const member = this.memberForHash(room, hash);
    if (!member) throw httpError(401, "Invalid room token");
    return this.public(room, member.playerId, connectedPlayerIds);
  }

  async act(token, action, connectedPlayerIds) {
    const hash = await tokenHash(token);
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    const member = this.memberForHash(room, hash, action?.type === "leave");
    if (!member) throw httpError(401, "Invalid room token");
    return await this.actForMember(room, member, action, connectedPlayerIds);
  }

  async actAsPlayer(playerId, action, connectedPlayerIds) {
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    const member = activeMembers(room).find((candidate) => candidate.playerId === playerId) || null;
    if (!member) throw httpError(401, "Invalid room player");
    return await this.actForMember(room, member, action, connectedPlayerIds);
  }

  async actForMember(room, member, action, connectedPlayerIds) {
    if (!action || typeof action !== "object" || Array.isArray(action)) throw httpError(400, "Action must be an object");
    const type = action.type;

    if (type === "leave" && member.leftAt) return this.public(room, member.playerId, connectedPlayerIds);

    if (type === "chat") {
      const text = normalizeChatText(action.text);
      const timestamp = Date.now();
      if (timestamp - Number(member.lastChatAt || 0) < CHAT_MIN_INTERVAL_MS) throw httpError(429, "Please wait a moment before sending another message");
      if (!member.chatWindowStartedAt || timestamp - member.chatWindowStartedAt >= CHAT_BURST_WINDOW_MS) {
        member.chatWindowStartedAt = timestamp;
        member.chatWindowCount = 0;
      }
      if (member.chatWindowCount >= CHAT_BURST_LIMIT) throw httpError(429, "Too many messages; please pause before chatting again");
      member.lastChatAt = timestamp;
      member.chatWindowCount++;
      room.chat.push({
        id: randomId("m"),
        playerId: member.playerId,
        seat: member.seat,
        username: member.username,
        text,
        createdAt: nowIso()
      });
      if (room.chat.length > MAX_CHAT_MESSAGES) room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
    } else {
      if (type !== "leave") requireExactVersion(room, action);
      if (type === "start") {
        if (room.game === "chat") throw httpError(409, "Chat rooms are already active");
        if (room.status !== "lobby") throw httpError(409, "Game is not waiting to start");
        if (room.hostPlayerId !== member.playerId) throw httpError(403, "Only the room host can start the game");
        if (activeMembers(room).length < room.minPlayers) throw httpError(409, "Not enough players have joined");
        if (Object.hasOwn(action, "state")) room.state = validatedJson(action.state, "State", MAX_STATE_BYTES);
        const firstSeat = action.firstSeat === undefined ? activeMembers(room)[0].seat : Number(action.firstSeat);
        const first = Number.isInteger(firstSeat) ? memberAtSeat(room, firstSeat) : null;
        if (!first) throw httpError(400, "First seat must belong to a player in this room");
        room.status = "active";
        room.result = null;
        room.turn = { seat: first.seat, playerId: first.playerId, number: 1 };
      } else if (type === "state") {
        if (room.game === "chat") throw httpError(409, "Chat rooms do not have game state turns");
        if (room.status !== "active" || !room.turn) throw httpError(409, "Game is not active");
        if (room.turn.playerId !== member.playerId) throw httpError(403, "It is not your turn");
        if (!Object.hasOwn(action, "state")) throw httpError(400, "State action requires a state snapshot");
        room.state = validatedJson(action.state, "State", MAX_STATE_BYTES);
        if (action.finish === true) {
          room.result = validatedJson(action.result ?? null, "Result", MAX_RESULT_BYTES);
          room.status = "finished";
          room.turn = null;
        } else {
          const nextSeat = action.nextSeat === undefined ? member.seat : Number(action.nextSeat);
          const next = Number.isInteger(nextSeat) ? memberAtSeat(room, nextSeat) : null;
          if (!next) throw httpError(400, "Next seat must belong to a player in this room");
          room.turn = { seat: next.seat, playerId: next.playerId, number: room.turn.number + 1 };
        }
      } else if (type === "restart") {
        if (room.game === "chat") throw httpError(409, "Chat rooms cannot restart a game");
        if (room.hostPlayerId !== member.playerId) throw httpError(403, "Only the room host can restart the game");
        if (room.status !== "finished") throw httpError(409, "The current game must finish before restarting");
        if (activeMembers(room).length < room.minPlayers) throw httpError(409, "Not enough players have joined");
        if (Object.hasOwn(action, "state")) room.state = validatedJson(action.state, "State", MAX_STATE_BYTES);
        const firstSeat = action.firstSeat === undefined ? activeMembers(room)[0].seat : Number(action.firstSeat);
        const first = Number.isInteger(firstSeat) ? memberAtSeat(room, firstSeat) : null;
        if (!first) throw httpError(400, "First seat must belong to a player in this room");
        room.status = "active";
        room.result = null;
        room.turn = { seat: first.seat, playerId: first.playerId, number: 1 };
      } else if (type === "rename") {
        const username = normalizeUsername(action.username);
        this.ensureUniqueUsername(room, username, member.playerId);
        member.username = username;
      } else if (type === "leave") {
        member.leftAt = nowIso();
        const remaining = activeMembers(room);
        if (room.hostPlayerId === member.playerId) room.hostPlayerId = remaining.sort((a, b) => a.seat - b.seat)[0]?.playerId || null;
        if (!remaining.length) {
          room.status = "finished";
          room.turn = null;
          room.result = { type: "abandoned", reason: "all-players-left" };
        } else if (room.status === "active" && room.game !== "chat") {
          if (remaining.length < room.minPlayers) {
            room.status = "finished";
            room.turn = null;
            room.result = { type: "abandoned", reason: "not-enough-players", departedPlayerId: member.playerId };
          } else if (room.turn?.playerId === member.playerId) {
            const seat = nextOccupiedSeat(room, member.seat);
            const next = memberAtSeat(room, seat);
            room.turn = { seat: next.seat, playerId: next.playerId, number: room.turn.number + 1 };
          }
        }
        compactMembers(room);
      } else {
        throw httpError(400, "Unknown action");
      }
    }

    room.revision++;
    if (type === "chat") room.chatVersion++;
    else if (type !== "rename") room.version++;
    await this.save(room);
    return this.public(room, member.playerId, connectedPlayerIds);
  }
}

export const GENERIC_ROOM_LIMITS = Object.freeze({
  MAX_STATE_BYTES,
  MAX_RESULT_BYTES,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_LENGTH,
  MAX_DEPARTED_MEMBERS,
  CHAT_MIN_INTERVAL_MS,
  CHAT_BURST_WINDOW_MS,
  CHAT_BURST_LIMIT
});
