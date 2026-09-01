import { applyGameMove, createGame, forceDraw, forceResign, publicGame, undoLastMove } from "./chess-engine.js";

const ROOM_KEY = "room";

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function tokenHash(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

export class RoomModel {
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

  async create(code) {
    const token = randomToken();
    const whiteHash = await tokenHash(token);
    if (await this.load()) throw httpError(409, "Room already exists");
    const room = {
      schema: 1,
      code,
      game: createGame(),
      whiteHash,
      blackHash: null,
      version: 1,
      pending: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.save(room);
    return { token, side: "w", room: this.public(room, "w") };
  }

  sideForHash(room, hash) {
    if (!room || !hash) return null;
    if (hash === room.whiteHash) return "w";
    if (hash === room.blackHash) return "b";
    return null;
  }

  async sideForToken(room, token) {
    const hash = await tokenHash(token);
    return this.sideForHash(room, hash);
  }

  async join(token = null) {
    // Hash before reading storage so Durable Object requests retain a single
    // load/check/write critical section after the input gate is opened.
    const preparedToken = token || randomToken();
    const preparedHash = await tokenHash(preparedToken);
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    if (token) {
      const side = this.sideForHash(room, preparedHash);
      if (!side) throw httpError(401, "Reconnect token is not valid for this room");
      return { token, side, room: this.public(room, side) };
    }
    if (room.closedAt || room.game.result?.over) throw httpError(410, "This chess room has closed");
    if (room.blackHash) throw httpError(409, "This room already has two players");
    room.blackHash = preparedHash;
    room.version++;
    await this.save(room);
    return { token: preparedToken, side: "b", room: this.public(room, "b") };
  }

  public(room, side = null, presence = { w: false, b: false }) {
    return {
      code: room.code,
      version: room.version,
      side,
      ready: Boolean(room.whiteHash && room.blackHash),
      presence,
      pending: room.pending,
      game: publicGame(room.game),
      updatedAt: room.updatedAt
    };
  }

  async state(token, presence) {
    const hash = await tokenHash(token);
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    const side = this.sideForHash(room, hash);
    if (!side) throw httpError(401, "Invalid room token");
    return this.public(room, side, presence);
  }

  async act(token, action, presence) {
    const hash = await tokenHash(token);
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    const side = this.sideForHash(room, hash);
    if (!side) throw httpError(401, "Invalid room token");
    return await this.actForSide(room, side, action, presence);
  }

  async actAsSide(side, action, presence) {
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    if ((side !== "w" && side !== "b") || !(side === "w" ? room.whiteHash : room.blackHash)) {
      throw httpError(401, "Invalid room seat");
    }
    return await this.actForSide(room, side, action, presence);
  }

  async actForSide(room, side, action, presence) {
    if (!action || typeof action !== "object" || Array.isArray(action)) throw httpError(400, "Action must be an object");
    const expectedVersion = Number(action.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== room.version) throw httpError(409, "Room state changed; refresh and try again");
    const other = side === "w" ? "b" : "w";
    const type = action.type;
    if (type === "move") {
      if (!room.blackHash) throw httpError(409, "Wait for an opponent before moving");
      if (room.game.result?.over) throw httpError(409, "Game is already over");
      if (room.game.position.turn !== side) throw httpError(403, "It is not your turn");
      try {
        room.game = applyGameMove(room.game, action.uci);
      } catch (error) {
        throw httpError(422, error.message === "Illegal move" ? "Illegal move" : "Invalid move");
      }
      room.pending = null;
    } else if (type === "request-undo" || type === "request-draw") {
      if (!room.blackHash) throw httpError(409, "Wait for an opponent");
      if (room.game.result?.over) throw httpError(409, "Game is already over");
      if (room.pending) throw httpError(409, "A request is already waiting");
      if (type === "request-undo" && !room.game.moves.length) throw httpError(409, "There is no move to undo");
      room.pending = { type: type === "request-undo" ? "undo" : "draw", from: side, createdAt: nowIso() };
    } else if (type === "accept-request") {
      if (!room.pending) throw httpError(409, "There is no request to accept");
      if (room.pending.from !== other) throw httpError(403, "You cannot accept your own request");
      if (room.pending.type === "undo") room.game = undoLastMove(room.game);
      else room.game = forceDraw(room.game, "agreement");
      room.pending = null;
    } else if (type === "reject-request") {
      if (!room.pending) throw httpError(409, "There is no request to reject");
      if (room.pending.from !== other) throw httpError(403, "You cannot reject your own request");
      room.pending = null;
    } else if (type === "cancel-request") {
      if (!room.pending || room.pending.from !== side) throw httpError(409, "You have no request to cancel");
      room.pending = null;
    } else if (type === "resign") {
      room.game = forceResign(room.game, side);
      room.pending = null;
    } else if (type === "leave") {
      const otherHash = side === "w" ? room.blackHash : room.whiteHash;
      if (otherHash && !room.game.result?.over) room.game = forceResign(room.game, side);
      if (!otherHash) room.closedAt = nowIso();
      if (side === "w") room.whiteHash = null;
      else room.blackHash = null;
      room.pending = null;
    } else {
      throw httpError(400, "Unknown action");
    }
    room.version++;
    await this.save(room);
    return this.public(room, side, presence);
  }
}

export class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { const value = this.map.get(key); return value === undefined ? undefined : structuredClone(value); }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
}
