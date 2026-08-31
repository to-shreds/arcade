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
    if (await this.load()) throw httpError(409, "Room already exists");
    const token = randomToken();
    const room = {
      schema: 1,
      code,
      game: createGame(),
      whiteHash: await tokenHash(token),
      blackHash: null,
      version: 1,
      pending: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.save(room);
    return { token, side: "w", room: this.public(room, "w") };
  }

  async sideForToken(room, token) {
    const hash = await tokenHash(token);
    if (!hash) return null;
    if (hash === room.whiteHash) return "w";
    if (hash === room.blackHash) return "b";
    return null;
  }

  async join(token = null) {
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    if (token) {
      const side = await this.sideForToken(room, token);
      if (!side) throw httpError(401, "Reconnect token is not valid for this room");
      return { token, side, room: this.public(room, side) };
    }
    if (room.blackHash) throw httpError(409, "This room already has two players");
    const blackToken = randomToken();
    room.blackHash = await tokenHash(blackToken);
    room.version++;
    await this.save(room);
    return { token: blackToken, side: "b", room: this.public(room, "b") };
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
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    const side = await this.sideForToken(room, token);
    if (!side) throw httpError(401, "Invalid room token");
    return this.public(room, side, presence);
  }

  async act(token, action, presence) {
    const room = await this.load();
    if (!room) throw httpError(404, "Room not found");
    const side = await this.sideForToken(room, token);
    if (!side) throw httpError(401, "Invalid room token");
    if (!action || typeof action !== "object") throw httpError(400, "Action must be an object");
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
