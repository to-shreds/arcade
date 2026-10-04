import test from "node:test";
import assert from "node:assert/strict";
import { GenericRoomModel, GENERIC_ROOM_LIMITS, normalizeChatImage } from "../src/generic-room-model.js";
import { MemoryStorage } from "../src/room-model.js";
import { NearbyRoomService } from "../../../multiplayer/nearby-room-service.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAABQAAAAMCAIAAADtbgqsAAAAGUlEQVR4nGMUOXGHgVzARLbOUc2jmmmuGQALXwHQpdKmfgAAAABJRU5ErkJggg==";
const image = { dataUrl: "data:image/png;base64," + png, width: 20, height: 12 };

async function chatRoom() {
  const model = new GenericRoomModel(new MemoryStorage());
  const host = await model.create({ code: "ABC234", game: "chat", username: "Alice" });
  const guest = await model.join({ username: "Bob" });
  return { model, host, guest };
}

test("chat image-only messages, captions, retries, and reconnect history share the room authority", async () => {
  const { model, host, guest } = await chatRoom();
  const action = { type: "chat", image, clientMessageId: "image_message_0001" };
  const sent = await model.act(host.token, action);
  assert.deepEqual(sent.chat[0].image, image);
  assert.equal(sent.chat[0].text, "");
  assert.equal(sent.chat[0].username, "Alice");
  const repeated = await model.act(host.token, action);
  assert.equal(repeated.chat.length, 1);
  assert.equal(repeated.revision, sent.revision, "a committed message retry is idempotent, including inside the throttle window");
  const captioned = await model.act(guest.token, { type: "chat", text: "Our next game", image, clientMessageId: "image_message_0002" });
  assert.equal(captioned.chat[1].text, "Our next game");
  const reconnect = await model.join({ reconnectToken: guest.token });
  assert.deepEqual(reconnect.room.chat, captioned.chat);
  assert.deepEqual((await model.state(host.token)).chat, reconnect.room.chat);
});

test("chat authority rejects external URLs, SVG/HTML, forged sizes, unsupported MIME, and oversized raster payloads", async () => {
  const { model, host } = await chatRoom();
  const invalidImages = [
    { ...image, dataUrl: "https://example.com/image.png" },
    { ...image, dataUrl: "data:image/svg+xml;base64," + btoa('<svg onload="alert(1)"></svg>') },
    { ...image, dataUrl: "data:text/html;base64," + btoa("<script>alert(1)</script>") },
    { ...image, width: 999 },
    { ...image, height: 0 },
    { ...image, dataUrl: "data:image/jpeg;base64," + png },
    { ...image, dataUrl: "data:image/png;base64,%%%%" },
    { ...image, dataUrl: "data:image/png;base64," + "A".repeat(GENERIC_ROOM_LIMITS.MAX_CHAT_IMAGE_BYTES) }
  ];
  for (const invalid of invalidImages) await assert.rejects(model.act(host.token, { type: "chat", image: invalid }), error => [400,413].includes(error.status));
  assert.equal((await model.state(host.token)).chat.length, 0);
  const game = new GenericRoomModel(new MemoryStorage());
  const gameHost = await game.create({ code: "XYZ234", game: "checkers", username: "Alice" });
  await assert.rejects(game.act(gameHost.token, { type: "chat", image }), error => error.status === 400);
  assert.deepEqual(normalizeChatImage(image), image);
});

test("large image and Unicode text history stays within the Nearby room frame, including 32 members", async () => {
  const { model, host } = await chatRoom();
  for (let index = 2; index < 32; index++) await model.join({ username: "Player " + index });
  const largeImage = { ...image, dataUrl: "data:image/png;base64," + Buffer.concat([Buffer.from(png, "base64"), Buffer.alloc(17_500)]).toString("base64") };
  for (let index = 0; index < 20; index++) {
    const stored = await model.load();
    const member = stored.members[0];
    member.lastChatAt = 0; member.chatWindowStartedAt = 0; member.chatWindowCount = 0;
    await model.save(stored);
    await model.act(host.token, { type: "chat", text: "界".repeat(500), image: largeImage, clientMessageId: "history_image_" + String(index).padStart(3,"0") });
  }
  const latest = await model.state(host.token);
  assert.ok(latest.chat.length >= 1);
  assert.equal(latest.chat.at(-1).clientMessageId, "history_image_019");
  assert.ok(Buffer.byteLength(JSON.stringify(latest.chat)) <= GENERIC_ROOM_LIMITS.MAX_CHAT_HISTORY_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify({ type: "state", room: latest })) < 64 * 1024);
});

test("Nearby image messages broadcast identically to every viewer and survive a checkpoint/reconnect", async () => {
  const events = [];
  const service = new NearbyRoomService({ onEvent: event => events.push(event) });
  const members = [
    { memberId: "member_alice", nickname: "Alice", avatar: "🚀", color: "#AA3355" },
    { memberId: "member_bob", nickname: "Bob", avatar: "🦖", color: "#33AA55" }
  ];
  for (const member of members) await service.registerMember(member);
  const http = (memberId, path, body, token) => service.handleHttp(memberId, { url: path, method: "POST", headers: token ? { authorization: "Bearer " + token } : {}, body: JSON.stringify(body) });
  const host = await http(members[0].memberId, "/api/arcade/rooms", { game: "chat" });
  const code = host.body.code;
  const guest = await http(members[1].memberId, `/api/arcade/rooms/${code}/join`, {});
  for (const [index, result] of [host,guest].entries()) await service.openSocket(members[index].memberId, { socketId: "chat_socket_" + index, url: `/api/arcade/rooms/${code}/ws?token=${result.body.token}` });
  events.length = 0;
  const sent = await http(members[0].memberId, `/api/arcade/rooms/${code}/actions`, { type: "chat", image, text: "Look!", clientMessageId: "nearby_image_0001" }, host.body.token);
  assert.equal(sent.status, 200);
  const broadcasts = events.filter(event => event.type === "socket-message" && JSON.parse(event.data).room?.chat?.length);
  assert.equal(broadcasts.length, 2);
  assert.deepEqual(JSON.parse(broadcasts[0].data).room.chat, JSON.parse(broadcasts[1].data).room.chat);
  assert.deepEqual(JSON.parse(broadcasts[1].data).room.chat[0].image, image);
  const checkpoint = await service.exportCheckpoint();
  const restored = new NearbyRoomService();
  await restored.importCheckpoint(checkpoint);
  const resumed = await restored.openSocket(members[1].memberId, { socketId: "chat_restored", url: `/api/arcade/rooms/${code}/ws?token=${guest.body.token}` });
  assert.deepEqual(JSON.parse(resumed.initialData).room.chat, sent.body.room.chat);
});
