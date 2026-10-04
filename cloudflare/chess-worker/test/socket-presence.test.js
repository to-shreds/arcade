import test from "node:test";
import assert from "node:assert/strict";
import { ArcadeRoom, ChessRoom } from "../src/index.js";

function socket(identity, readyState = WebSocket.OPEN) {
  return {
    readyState, messages: [], closes: [],
    deserializeAttachment: () => identity,
    send(value) { assert.equal(this.readyState, WebSocket.OPEN); this.messages.push(JSON.parse(value)); },
    close(code, reason) { this.closes.push({ code, reason }); this.readyState = WebSocket.CLOSED; }
  };
}

for (const [Room, identity, otherIdentity, connected] of [
  [ChessRoom, { side: "w" }, { side: "b" }, presence => presence.w],
  [ArcadeRoom, { playerId: "p_host" }, { playerId: "p_guest" }, presence => presence.has("p_host")]
]) {
  function roomWith(sockets) {
    const room = new Room({ storage: {}, getWebSockets: () => sockets });
    room.model = { async load() { return {}; }, public(_room, _identity, presence) { return { presence: presence instanceof Set ? [...presence] : presence }; } };
    return room;
  }

  test(`${Room.name} presence excludes retained closing sockets and preserves another open connection for the same seat`, async () => {
    const closing = socket(identity, WebSocket.CLOSING), closed = socket(identity, WebSocket.CLOSED), connecting = socket(identity, WebSocket.CONNECTING);
    const observer = socket(otherIdentity), sockets = [closing, closed, connecting, observer], room = roomWith(sockets);
    assert.equal(connected(room.connections()), false);
    await room.broadcast();
    assert.equal(closing.messages.length + closed.messages.length + connecting.messages.length, 0);
    assert.equal(observer.messages.length, 1);
    const replacement = socket(identity); sockets.push(replacement);
    assert.equal(connected(room.connections()), true, "closing one tab cannot hide another open tab");
  });

  test(`${Room.name} completes an older runtime close handshake before broadcasting disconnected presence`, async () => {
    const closing = socket(identity, WebSocket.CLOSING), observer = socket(otherIdentity), room = roomWith([closing, observer]);
    await room.webSocketClose(closing);
    assert.equal(closing.closes.length, 1);
    assert.equal(closing.readyState, WebSocket.CLOSED);
    assert.equal(connected(room.connections()), false);
    assert.equal(observer.messages.length, 1);
    // Current runtimes may have completed the handshake and reject a second close.
    closing.close = () => { throw new Error("Already closed"); };
    await room.webSocketClose(closing);
    assert.equal(observer.messages.length, 2);
  });

  test(`${Room.name} closes an errored open socket before reporting presence`, async () => {
    const failed = socket(identity), observer = socket(otherIdentity), room = roomWith([failed, observer]);
    await room.webSocketError(failed);
    assert.equal(failed.closes[0].code, 1011);
    assert.equal(connected(room.connections()), false);
    assert.equal(observer.messages.length, 1);
    assert.equal(failed.messages.length, 0);
  });
}
