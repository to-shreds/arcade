import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  ARCADE_BRIDGE_SCOPE,
  ARCADE_BRIDGE_VERSION,
  MAX_NEARBY_IDENTITIES,
  MAX_NEARBY_PLAYERS,
  NearbyIdentityRegistry,
  ReactionRateLimiter,
  byteLength,
  offlineRuntimeReady,
  randomId,
  safeGameInvitation,
  surpriseGame,
  validReaction,
  validateFrameMessage
} from "../arcade-shell-core.mjs";

const proof = character => character.repeat(64);
const browserId = suffix => `browser_identity_${suffix.padEnd(24, "x")}`;

test("the frame bridge accepts only exact-origin, exact-source, shaped messages", () => {
  const source = {};
  const origin = "https://to-shreds.github.io";
  const message = {
    scope: ARCADE_BRIDGE_SCOPE,
    bridgeVersion: ARCADE_BRIDGE_VERSION,
    frameId: "frame_chess_1234",
    type: "rpc",
    requestId: "request_12345678",
    operation: "http",
    payload: { url: "/api/chess/rooms" }
  };

  assert.equal(validateFrameMessage({ origin, source, data: message }, { origin, source }), message);
  assert.equal(validateFrameMessage({ origin: "https://evil.example", source, data: message }, { origin, source }), null);
  assert.equal(validateFrameMessage({ origin, source: {}, data: message }, { origin, source }), null);
  assert.equal(validateFrameMessage({ origin, source, data: { ...message, bridgeVersion: 99 } }, { origin, source }), null);
  assert.equal(validateFrameMessage({ origin, source, data: { ...message, type: "run-javascript" } }, { origin, source }), null);
  assert.equal(validateFrameMessage({ origin, source, data: { ...message, operation: "eval" } }, { origin, source }), null);
  assert.equal(validateFrameMessage({ origin, source, data: { ...message, frameId: "tiny" } }, { origin, source }), null);

  const oversized = { ...message, payload: { data: "x".repeat(1024) } };
  assert.ok(byteLength(oversized) > 100);
  assert.equal(validateFrameMessage({ origin, source, data: oversized }, { origin, source, maxBytes: 100 }), null);
});

test("secure identifiers fail closed when Web Crypto is unavailable", () => {
  assert.throws(
    () => randomId("member", null),
    error => error?.code === "web_crypto_required"
  );
  const id = randomId("member", webcrypto);
  assert.match(id, /^member_[a-f0-9]{32}$/);
});

test("offline runtime readiness accepts only a complete PWA or validated native archive", () => {
  assert.equal(offlineRuntimeReady({ offlineReady: false, hostname: "to-shreds.github.io", nativeArchiveReady: false }), false);
  assert.equal(offlineRuntimeReady({ offlineReady: true, hostname: "to-shreds.github.io", nativeArchiveReady: false }), true);
  assert.equal(offlineRuntimeReady({ offlineReady: false, hostname: "to-shreds.github.io", nativeArchiveReady: true }), true);
  assert.equal(offlineRuntimeReady({ offlineReady: false, hostname: "arcade.local", nativeArchiveReady: false }), true);
});

test("Nearby identities lock names and avatars, normalize duplicates, and require reconnect proof", () => {
  let now = 100;
  const registry = new NearbyIdentityRegistry({ cryptoObject: webcrypto, now: () => now });
  const loganBrowser = browserId("logan");
  const loganProof = proof("a");
  const first = registry.join({
    browserId: loganBrowser,
    reconnectProof: loganProof,
    nickname: "Logan",
    avatar: "🦖",
    color: "#21dcff"
  }, { host: true });

  assert.equal(first.reconnected, false);
  assert.equal(first.member.nickname, "Logan");
  assert.equal("browserId" in first.member, false, "private browser identity is not broadcast");

  assert.throws(() => registry.join({
    browserId: browserId("duplicate"),
    reconnectProof: proof("b"),
    nickname: "  Ｌｏｇａｎ  ",
    avatar: "🚀",
    color: "#ff5ac8"
  }), error => error?.code === "nickname_taken");

  assert.throws(() => registry.join({
    browserId: loganBrowser,
    reconnectProof: proof("c"),
    nickname: "Logan",
    avatar: "🚀",
    color: "#ff5ac8"
  }), error => error?.code === "identity_proof_invalid");

  registry.setPresence(first.member.memberId, "disconnected");
  now = 200;
  const reconnect = registry.join({
    browserId: loganBrowser,
    reconnectProof: loganProof,
    nickname: "Definitely Not Logan",
    avatar: "👑",
    color: "#ffffff"
  });
  assert.equal(reconnect.reconnected, true);
  assert.equal(reconnect.nameLocked, true);
  assert.equal(reconnect.member.nickname, "Logan");
  assert.equal(reconnect.member.avatar, "🦖");
  assert.equal(reconnect.member.color, "#21dcff");
  assert.equal(reconnect.member.presence, "connected");
});

test("removed and disconnected identities keep their normalized names reserved", () => {
  const registry = new NearbyIdentityRegistry({ cryptoObject: webcrypto });
  const host = registry.join({ browserId: browserId("host"), reconnectProof: proof("d"), nickname: "Host", avatar: "😎" }, { host: true }).member;
  const guestProfile = { browserId: browserId("guest"), reconnectProof: proof("e"), nickname: "Cosmic Banana", avatar: "🚀" };
  const guest = registry.join(guestProfile).member;

  registry.setPresence(guest.memberId, "disconnected");
  assert.throws(() => registry.join({ browserId: browserId("imposter"), reconnectProof: proof("f"), nickname: "cosmic   banana", avatar: "🐼" }), error => error?.code === "nickname_taken");
  assert.equal(registry.remove(guest.memberId), true);
  assert.throws(() => registry.join(guestProfile), error => error?.code === "identity_removed");
  assert.throws(() => registry.join({ browserId: browserId("newcomer"), reconnectProof: proof("1"), nickname: "COSMIC BANANA", avatar: "🐯" }), error => error?.code === "nickname_taken");
  assert.equal(registry.remove(host.memberId), false, "the host cannot remove itself");
  assert.equal(registry.list().some(member => "browserId" in member), false);
});

test("removed identities retain reservations without permanently consuming live seats", () => {
  const registry = new NearbyIdentityRegistry({ cryptoObject: webcrypto });
  const makeProfile = index => ({
    browserId: browserId(`capacity_${index}`),
    reconnectProof: String(index % 10).repeat(64),
    nickname: `Player ${index}`,
    avatar: "🚀"
  });
  registry.join(makeProfile(0), { host: true });
  const guests = [];
  for(let index = 1; index < MAX_NEARBY_PLAYERS; index++) guests.push(registry.join(makeProfile(index)).member);
  assert.equal(registry.list().length, MAX_NEARBY_PLAYERS);
  assert.throws(() => registry.join(makeProfile(8)), error => error?.code === "session_full");

  assert.equal(registry.remove(guests[0].memberId), true);
  const replacement = registry.join(makeProfile(8)).member;
  assert.equal(registry.list().length, MAX_NEARBY_PLAYERS, "a replacement occupies the removed live seat");
  assert.equal(registry.serialize().length, MAX_NEARBY_PLAYERS + 1, "the removed identity remains a private reservation");
  assert.throws(() => registry.join(makeProfile(1)), error => error?.code === "identity_removed");
  assert.throws(() => registry.join({ ...makeProfile(9), nickname: "Player 1" }), error => error?.code === "nickname_taken");

  let newest = replacement;
  for(let index = 9; registry.serialize().length < MAX_NEARBY_IDENTITIES; index++){
    assert.equal(registry.remove(newest.memberId), true);
    newest = registry.join(makeProfile(index)).member;
  }
  assert.equal(registry.list().length, MAX_NEARBY_PLAYERS);
  assert.equal(registry.serialize().length, MAX_NEARBY_IDENTITIES);
  assert.equal(registry.remove(newest.memberId), true);
  assert.throws(() => registry.join(makeProfile(99)), error => error?.code === "session_history_full");
  assert.equal(registry.serialize().length, MAX_NEARBY_IDENTITIES, "historical reservations remain bounded");
});

test("reaction and invitation helpers enforce allowlists, limits, and safe catalog entries", () => {
  let now = 0;
  const limiter = new ReactionRateLimiter({ intervalMs: 1000, burst: 3, windowMs: 8000, now: () => now });
  assert.equal(validReaction("🎉"), true);
  assert.equal(validReaction("<script>"), false);
  assert.equal(limiter.accept("member_1"), true);
  assert.equal(limiter.accept("member_1"), false, "back-to-back reactions are throttled");
  now = 1000;
  assert.equal(limiter.accept("member_1"), true);
  now = 2000;
  assert.equal(limiter.accept("member_1"), true);
  now = 3000;
  assert.equal(limiter.accept("member_1"), false, "the rolling burst cap is enforced");
  assert.equal(limiter.accept("member_2"), true, "limits are per member");

  const catalog = [{ folder: "chess", enabled: true, title: "Chess" }, { folder: "hidden", enabled: false, title: "Hidden" }];
  const invitation = safeGameInvitation({
    invitationId: "invite_1",
    gameId: "chess",
    roomCode: "ab-c 234",
    label: "<b>Jon's Chess</b>",
    senderId: "member_1",
    senderName: "<Jon>"
  }, catalog);
  assert.equal(invitation.gameId, "chess");
  assert.equal(invitation.roomCode, "ABC234");
  assert.equal(invitation.label.includes("<"), false);
  assert.equal(invitation.senderName.includes("<"), false);
  assert.equal(safeGameInvitation({ gameId: "hidden", roomCode: "ABCD" }, catalog), null);
  assert.equal(safeGameInvitation({ gameId: "chess", roomCode: "A" }, catalog), null);
});

test("Surprise Me uses actual multiplayer room capacities instead of broad catalog counts", () => {
  const catalog = [
    { folder: "memory", enabled: true, playersMin: 1, playersMax: 8 },
    { folder: "dots", enabled: true, playersMin: 2, playersMax: 8 },
    { folder: "monopoly", enabled: true, playersMin: 2, playersMax: 6 },
    { folder: "chess", enabled: true, playersMin: 1, playersMax: 2 }
  ];
  assert.equal(surpriseGame(catalog.filter(item => item.folder === "memory"), 5), null);
  assert.equal(surpriseGame(catalog.filter(item => item.folder === "dots"), 5), null);
  assert.equal(surpriseGame(catalog, 5, () => 0).folder, "monopoly");
  assert.equal(surpriseGame(catalog, 7), null);
});
