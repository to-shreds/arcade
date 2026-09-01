import { RoomModel } from "../../../multiplayer/models/room-model.js";
import { GenericRoomModel } from "../../../multiplayer/models/generic-room-model.js";

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

async function readJson(request, maxBytes = 384 * 1024) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    const error = new Error("Content-Type must be application/json");
    error.status = 415;
    throw error;
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error("Request body is too large");
    error.status = 413;
    throw error;
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    return JSON.parse(text);
  }
  catch (cause) {
    if (cause?.status) throw cause;
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

function arcadeRoomStub(env, code) {
  return env.ARCADE_ROOMS.get(env.ARCADE_ROOMS.idFromName(code));
}

function proxiedJson(response, cors) {
  return new Response(response.body, {
    status: response.status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "arcade-chess" });
    const cors = corsFor(request, env);
    if (!cors) return json({ ok: false, error: "Origin is not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/api/arcade/rooms" && request.method === "POST") {
        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "Request body must be an object" }, 400, cors);
        for (let attempt = 0; attempt < 8; attempt++) {
          const code = randomCode();
          const response = await arcadeRoomStub(env, code).fetch("https://room.internal/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              code,
              game: body.game,
              username: body.username,
              maxPlayers: body.maxPlayers,
              state: Object.hasOwn(body, "state") ? body.state : null
            })
          });
          if (response.status === 409) continue;
          return proxiedJson(response, cors);
        }
        return json({ ok: false, error: "Could not allocate a room code" }, 503, cors);
      }
      const arcadeMatch = /^\/api\/arcade\/rooms\/([^/]+)(?:\/(join|state|actions|ws))?$/.exec(url.pathname);
      if (arcadeMatch) {
        const code = normalizeCode(arcadeMatch[1]);
        if (!code) return json({ ok: false, error: "Invalid room code" }, 400, cors);
        const operation = arcadeMatch[2];
        const stub = arcadeRoomStub(env, code);
        if (operation === "join" && request.method === "POST") {
          const body = await readJson(request);
          if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "Request body must be an object" }, 400, cors);
          const response = await stub.fetch("https://room.internal/join", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username: body.username, reconnectToken: body.reconnectToken || null })
          });
          return proxiedJson(response, cors);
        }
        if (operation === "state" && request.method === "GET") {
          const response = await stub.fetch("https://room.internal/state", { headers: { authorization: `Bearer ${bearer(request) || ""}` } });
          return proxiedJson(response, cors);
        }
        if (operation === "actions" && request.method === "POST") {
          const body = await readJson(request);
          const response = await stub.fetch("https://room.internal/action", {
            method: "POST",
            headers: { authorization: `Bearer ${bearer(request) || ""}`, "content-type": "application/json" },
            body: JSON.stringify(body)
          });
          return proxiedJson(response, cors);
        }
        if (operation === "ws" && request.method === "GET") {
          if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return json({ ok: false, error: "WebSocket upgrade required" }, 426, cors);
          const internal = new URL("https://room.internal/ws");
          internal.searchParams.set("token", url.searchParams.get("token") || "");
          return await stub.fetch(new Request(internal, request));
        }
        return json({ ok: false, error: "Method not allowed" }, 405, cors);
      }
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

  closeSideSockets(side) {
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      if (attachment.side !== side) continue;
      try { socket.close(1000, "Left room"); } catch {}
    }
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
        const action = await request.json();
        const result = await this.model.act(bearer(request), action, this.connections());
        if (action.type === "leave") this.closeSideSockets(result.side);
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
      const source = typeof message === "string" ? message : new TextDecoder().decode(message);
      if (new TextEncoder().encode(source).byteLength > 384 * 1024) throw Object.assign(new Error("Action is too large"), { status: 413 });
      const action = JSON.parse(source);
      await this.model.actAsSide(attachment.side, action, this.connections());
      if (action.type === "leave") this.closeSideSockets(attachment.side);
      await this.broadcast();
    } catch (error) {
      try { socket.send(JSON.stringify({ type: "error", status: Number(error.status) || 400, error: error.message || "Invalid action" })); } catch {}
    }
  }

  async webSocketClose() { await this.broadcast(); }
  async webSocketError() { await this.broadcast(); }
}

export class ArcadeRoom {
  constructor(state) {
    this.state = state;
    this.model = new GenericRoomModel(state.storage);
  }

  connections() {
    const playerIds = new Set();
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      if (attachment.playerId) playerIds.add(attachment.playerId);
    }
    return playerIds;
  }

  closePlayerSockets(playerId) {
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      if (attachment.playerId !== playerId) continue;
      try { socket.close(1000, "Left room"); } catch {}
    }
  }

  async broadcast() {
    const room = await this.model.load();
    if (!room) return;
    const presence = this.connections();
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      try { socket.send(JSON.stringify({ type: "state", room: this.model.public(room, attachment.playerId || null, presence) })); }
      catch { try { socket.close(1011, "Delivery failed"); } catch {} }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/create" && request.method === "POST") {
        const result = await this.model.create(await request.json());
        return json({ ok: true, ...result });
      }
      if (url.pathname === "/join" && request.method === "POST") {
        const result = await this.model.join(await request.json());
        await this.broadcast();
        return json({ ok: true, ...result });
      }
      if (url.pathname === "/state" && request.method === "GET") {
        return json({ ok: true, room: await this.model.state(bearer(request), this.connections()) });
      }
      if (url.pathname === "/action" && request.method === "POST") {
        const action = await request.json();
        const room = await this.model.act(bearer(request), action, this.connections());
        if (action.type === "leave") this.closePlayerSockets(room.playerId);
        await this.broadcast();
        return json({ ok: true, room });
      }
      if (url.pathname === "/ws" && request.method === "GET") {
        const token = url.searchParams.get("token") || "";
        const { room, member } = await this.model.loadForToken(token);
        if (!member) return json({ ok: false, error: "Invalid room token" }, 401);
        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        server.serializeAttachment({ playerId: member.playerId });
        this.state.acceptWebSocket(server);
        server.send(JSON.stringify({ type: "state", room: this.model.public(room, member.playerId, this.connections()) }));
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
      const source = typeof message === "string" ? message : new TextDecoder().decode(message);
      if (new TextEncoder().encode(source).byteLength > 384 * 1024) throw Object.assign(new Error("Action is too large"), { status: 413 });
      const action = JSON.parse(source);
      const room = await this.model.actAsPlayer(attachment.playerId, action, this.connections());
      if (action.type === "leave") this.closePlayerSockets(attachment.playerId);
      await this.broadcast();
      if (action.type !== "leave") {
        try { socket.send(JSON.stringify({ type: "ack", version: room.version })); } catch {}
      }
    } catch (error) {
      try { socket.send(JSON.stringify({ type: "error", status: Number(error.status) || 400, error: error.message || "Invalid action" })); } catch {}
    }
  }

  async webSocketClose() { await this.broadcast(); }
  async webSocketError() { await this.broadcast(); }
}
