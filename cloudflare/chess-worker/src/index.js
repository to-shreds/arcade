import { RoomModel } from "./room-model.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function errorResponse(error, headers = {}) {
  const status = Number(error?.status) || 500;
  const message = status >= 500 ? "Server error" : error.message;
  return json({ ok: false, error: message }, status, headers);
}

async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    const error = new Error("Content-Type must be application/json");
    error.status = 415;
    throw error;
  }
  try { return await request.json(); }
  catch {
    const error = new Error("Request body is not valid JSON");
    error.status = 400;
    throw error;
  }
}

function allowedOrigins(env) {
  return new Set(String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function corsFor(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).has(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function randomCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function normalizeCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

function bearer(request) {
  const value = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1] : null;
}

function roomStub(env, code) {
  return env.CHESS_ROOMS.get(env.CHESS_ROOMS.idFromName(code));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "arcade-chess" });
    const cors = corsFor(request, env);
    if (!cors) return json({ ok: false, error: "Origin is not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/api/chess/rooms" && request.method === "POST") {
        for (let attempt = 0; attempt < 8; attempt++) {
          const code = randomCode();
          const response = await roomStub(env, code).fetch("https://room.internal/create", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code })
          });
          if (response.status === 409) continue;
          const body = await response.text();
          return new Response(body, { status: response.status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
        }
        return json({ ok: false, error: "Could not allocate a room code" }, 503, cors);
      }
      const match = /^\/api\/chess\/rooms\/([^/]+)(?:\/(join|state|actions|ws))?$/.exec(url.pathname);
      if (!match) return json({ ok: false, error: "Not found" }, 404, cors);
      const code = normalizeCode(match[1]);
      if (!code) return json({ ok: false, error: "Invalid room code" }, 400, cors);
      const operation = match[2];
      const stub = roomStub(env, code);
      if (operation === "join" && request.method === "POST") {
        const body = await readJson(request);
        const response = await stub.fetch("https://room.internal/join", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: body.reconnectToken || null })
        });
        return new Response(response.body, { status: response.status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      if (operation === "state" && request.method === "GET") {
        const token = bearer(request);
        const response = await stub.fetch("https://room.internal/state", { headers: { authorization: `Bearer ${token || ""}` } });
        return new Response(response.body, { status: response.status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      if (operation === "actions" && request.method === "POST") {
        const token = bearer(request);
        const body = await readJson(request);
        const response = await stub.fetch("https://room.internal/action", {
          method: "POST", headers: { authorization: `Bearer ${token || ""}`, "content-type": "application/json" }, body: JSON.stringify(body)
        });
        return new Response(response.body, { status: response.status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      if (operation === "ws" && request.method === "GET") {
        if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return json({ ok: false, error: "WebSocket upgrade required" }, 426, cors);
        const token = url.searchParams.get("token") || "";
        const internal = new URL("https://room.internal/ws");
        internal.searchParams.set("token", token);
        return await stub.fetch(new Request(internal, request));
      }
      return json({ ok: false, error: "Method not allowed" }, 405, cors);
    } catch (error) {
      return errorResponse(error, cors);
    }
  }
};

export class ChessRoom {
  constructor(state) {
    this.state = state;
    this.model = new RoomModel(state.storage);
  }

  connections() {
    const presence = { w: false, b: false };
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      if (attachment.side === "w" || attachment.side === "b") presence[attachment.side] = true;
    }
    return presence;
  }

  async broadcast() {
    const room = await this.model.load();
    if (!room) return;
    const presence = this.connections();
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      try { socket.send(JSON.stringify({ type: "state", room: this.model.public(room, attachment.side || null, presence) })); }
      catch { try { socket.close(1011, "Delivery failed"); } catch {} }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/create" && request.method === "POST") {
        const { code } = await request.json();
        const result = await this.model.create(code);
        return json({ ok: true, ...result });
      }
      if (url.pathname === "/join" && request.method === "POST") {
        const { token } = await request.json();
        const result = await this.model.join(token);
        await this.broadcast();
        return json({ ok: true, ...result });
      }
      if (url.pathname === "/state" && request.method === "GET") {
        return json({ ok: true, room: await this.model.state(bearer(request), this.connections()) });
      }
      if (url.pathname === "/action" && request.method === "POST") {
        const result = await this.model.act(bearer(request), await request.json(), this.connections());
        await this.broadcast();
        return json({ ok: true, room: result });
      }
      if (url.pathname === "/ws" && request.method === "GET") {
        const token = url.searchParams.get("token") || "";
        const room = await this.model.load();
        const side = room ? await this.model.sideForToken(room, token) : null;
        if (!side) return json({ ok: false, error: "Invalid room token" }, 401);
        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        server.serializeAttachment({ side });
        this.state.acceptWebSocket(server);
        server.send(JSON.stringify({ type: "state", room: this.model.public(room, side, this.connections()) }));
        await this.broadcast();
        return new Response(null, { status: 101, webSocket: client });
      }
      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }

  async webSocketMessage(socket, message) {
    const attachment = socket.deserializeAttachment() || {};
    try {
      const action = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
      const room = await this.model.load();
      if (!room) throw Object.assign(new Error("Room not found"), { status: 404 });
      const tokenSide = attachment.side;
      const tokenHashValue = tokenSide === "w" ? room.whiteHash : room.blackHash;
      if (!tokenHashValue) throw Object.assign(new Error("Invalid room seat"), { status: 401 });
      // WebSockets are authenticated during upgrade. A temporary token shim lets the model
      // enforce the exact same rules without placing the reconnect token in socket state.
      const side = tokenSide;
      const expectedVersion = Number(action.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion !== room.version) throw Object.assign(new Error("Room state changed; refresh and try again"), { status: 409 });
      const other = side === "w" ? "b" : "w";
      if (action.type === "move") {
        if (!room.blackHash) throw Object.assign(new Error("Wait for an opponent before moving"), { status: 409 });
        if (room.game.result?.over) throw Object.assign(new Error("Game is already over"), { status: 409 });
        if (room.game.position.turn !== side) throw Object.assign(new Error("It is not your turn"), { status: 403 });
        try { room.game = (await import("./chess-engine.js")).applyGameMove(room.game, action.uci); }
        catch (error) { throw Object.assign(new Error(error.message === "Illegal move" ? "Illegal move" : "Invalid move"), { status: 422 }); }
        room.pending = null;
      } else if (action.type === "request-undo" || action.type === "request-draw") {
        if (!room.blackHash || room.game.result?.over || room.pending) throw Object.assign(new Error("Request is not available"), { status: 409 });
        if (action.type === "request-undo" && !room.game.moves.length) throw Object.assign(new Error("There is no move to undo"), { status: 409 });
        room.pending = { type: action.type === "request-undo" ? "undo" : "draw", from: side, createdAt: nowIsoForSocket() };
      } else if (action.type === "accept-request") {
        if (!room.pending || room.pending.from !== other) throw Object.assign(new Error("There is no opponent request to accept"), { status: 403 });
        const engine = await import("./chess-engine.js");
        room.game = room.pending.type === "undo" ? engine.undoLastMove(room.game) : engine.forceDraw(room.game, "agreement");
        room.pending = null;
      } else if (action.type === "reject-request") {
        if (!room.pending || room.pending.from !== other) throw Object.assign(new Error("There is no opponent request to reject"), { status: 403 });
        room.pending = null;
      } else if (action.type === "cancel-request") {
        if (!room.pending || room.pending.from !== side) throw Object.assign(new Error("You have no request to cancel"), { status: 409 });
        room.pending = null;
      } else if (action.type === "resign") {
        room.game = (await import("./chess-engine.js")).forceResign(room.game, side);
        room.pending = null;
      } else throw Object.assign(new Error("Unknown action"), { status: 400 });
      room.version++;
      await this.model.save(room);
      await this.broadcast();
    } catch (error) {
      try { socket.send(JSON.stringify({ type: "error", status: Number(error.status) || 400, error: error.message || "Invalid action" })); } catch {}
    }
  }

  async webSocketClose() { await this.broadcast(); }
  async webSocketError() { await this.broadcast(); }
}

function nowIsoForSocket() { return new Date().toISOString(); }
