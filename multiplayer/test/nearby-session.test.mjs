import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { NearbyArcadeSession } from "../nearby-session.mjs";
import { MemoryNearbyStorage } from "../nearby-storage.mjs";
import { makeNearbyEnvelope } from "../protocol.mjs";

const proof = character => character.repeat(64);
const browserId = suffix => `browser_identity_${suffix.padEnd(24, "x")}`;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function secretProof(secret){
  const digest = new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  return Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
}

async function hostSession({ now = () => 1000 } = {}){
  const session = new NearbyArcadeSession({
    storage: new MemoryNearbyStorage({ cryptoObject: webcrypto }),
    cryptoObject: webcrypto,
    now,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout
  });
  await session.initialize();
  await session.startHost({ nickname: "Logan", avatar: "🦖", color: "#21dcff" });
  return session;
}

test("session snapshots expose transport and canonical presence state", async() => {
  const session = await hostSession();
  let state = session.snapshot();
  assert.equal(state.active, true);
  assert.equal(state.nearby, true);
  assert.equal(state.role, "host");
  assert.equal(state.connected, 1);
  assert.equal(state.status, "Hosting Nearby Arcade");

  const guest = session.registry.join({
    browserId: browserId("scarlett"),
    reconnectProof: proof("a"),
    nickname: "Scarlett",
    avatar: "🦄",
    color: "#ff5ac8"
  }).member;
  state = session.snapshot();
  assert.equal(state.connected, 2);
  assert.equal(state.members.find(member => member.memberId === guest.memberId)?.presence, "connected");

  session.registry.setPresence(guest.memberId, "reconnecting");
  state = session.snapshot();
  assert.equal(state.connected, 1);
  assert.equal(state.members.find(member => member.memberId === guest.memberId)?.presence, "reconnecting");
  session.registry.setPresence(guest.memberId, "disconnected");
  assert.equal(session.snapshot().members.find(member => member.memberId === guest.memberId)?.presence, "disconnected");

  await session.leave({ preserveCheckpoint: false });
  state = session.snapshot();
  assert.equal(state.active, false);
  assert.equal(state.nearby, false);
  assert.equal(state.connected, 0);
  assert.equal(state.status, "Internet");
});

test("session reactions and invitations use locked authoritative identity", async() => {
  let clock = 5000;
  const session = await hostSession({ now: () => clock });
  const reactions = [];
  const invitations = [];
  session.on("reaction", value => reactions.push(value));
  session.on("invitation", value => invitations.push(value));

  assert.equal(session.sendReaction("🎉"), true);
  assert.equal(session.sendReaction("🎉"), false, "reaction spam is throttled");
  assert.equal(session.sendReaction("not-allowed"), false);
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0].memberId, session.identity.memberId);
  assert.equal(reactions[0].nickname, "Logan");
  clock += 1200;
  assert.equal(session.sendReaction("🚀"), true);

  assert.equal(session.announceInvitation({
    gameId: "chess",
    roomCode: "ab-c 234",
    label: "<b>Game Night</b>",
    senderId: "member_spoofed",
    senderName: "Definitely Not Logan"
  }), true);
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].senderId, session.identity.memberId);
  assert.equal(invitations[0].senderName, "Logan");
  assert.equal(invitations[0].roomCode, "ABC234");
  assert.equal(invitations[0].label.includes("<"), false);
  assert.equal(session.announceInvitation({ gameId: "../evil", roomCode: "ABCD" }), false);
  assert.equal(session.announceInvitation({ gameId: "chess", roomCode: "A" }), false);
});

test("joining lock permits proof-bound reconnects but rejects new identities", async() => {
  const session = await hostSession();
  const reconnectSecret = "reserved-player-secret";
  const reservedBrowser = browserId("reserved");
  const reserved = session.registry.join({
    browserId: reservedBrowser,
    reconnectProof: await secretProof(reconnectSecret),
    nickname: "Scarlett",
    avatar: "🦄",
    color: "#ff5ac8"
  }).member;
  session.registry.setPresence(reserved.memberId, "disconnected");
  await session.setJoiningLocked(true);

  const messages = [];
  const record = {
    peerKey: "peer_reserved_reconnect",
    pairingId: "pair_reserved",
    pairingToken: "token_reserved",
    expiresAt: 5000,
    memberId: null,
    status: "pairing",
    channel: { readyState: "open", send: value => messages.push(JSON.parse(value)), close(){} },
    pc: { close(){} },
    lastSeen: 1000
  };
  session.pendingPairings.set(record.pairingId, record);
  session.peers.set(record.peerKey, record);
  await session._acceptJoinRequest(record, {
    pairingId: record.pairingId,
    pairingToken: record.pairingToken,
    profile: { browserId: reservedBrowser, reconnectSecret, nickname: "Rename Attempt", avatar: "👑" }
  });
  assert.equal(record.memberId, reserved.memberId);
  assert.equal(session.registry.get(reserved.memberId).nickname, "Scarlett");
  assert.ok(messages.some(message => message.type === "welcome"));

  const rejected = [];
  const stranger = {
    ...record,
    peerKey: "peer_stranger_attempt",
    pairingId: "pair_stranger",
    pairingToken: "token_stranger",
    memberId: null,
    channel: { readyState: "open", send: value => rejected.push(JSON.parse(value)), close(){} }
  };
  session.pendingPairings.set(stranger.pairingId, stranger);
  session.peers.set(stranger.peerKey, stranger);
  await session._acceptJoinRequest(stranger, {
    pairingId: stranger.pairingId,
    pairingToken: stranger.pairingToken,
    profile: { browserId: browserId("stranger"), reconnectSecret: "new-player-secret", nickname: "New Player", avatar: "🚀" }
  });
  assert.ok(rejected.some(message => message.type === "join-rejected"));
  assert.equal(session.registry.getByBrowser(browserId("stranger")), null);
});

test("a pairing credential is one-shot on its DataChannel", async() => {
  const session = await hostSession();
  const sent = [];
  let closed = 0;
  const record = {
    peerKey: "peer_one_shot_join",
    pairingId: "pair_one_shot_join",
    pairingToken: "token_one_shot_join",
    expiresAt: 5000,
    memberId: null,
    status: "pairing",
    lostTimer: 0,
    expiryTimer: 0,
    channel: { readyState: "open", bufferedAmount: 0, send: value => sent.push(JSON.parse(value)), close(){ closed += 1; } },
    pc: { close(){ closed += 1; } },
    lastSeen: 1000
  };
  session.pendingPairings.set(record.pairingId, record);
  session.peers.set(record.peerKey, record);
  const payload = {
    pairingId: record.pairingId,
    pairingToken: record.pairingToken,
    profile: { browserId: browserId("one-shot"), reconnectSecret: "one-shot-secret", nickname: "One Shot", avatar: "🚀" }
  };
  session._receiveFromGuest(record, { type: "join-request", payload });
  session._receiveFromGuest(record, { type: "join-request", payload });
  await flush();
  await flush();
  assert.ok(session.registry.list().filter(member => member.nickname === "One Shot").length <= 1);
  assert.equal(session.pendingPairings.has("pair_one_shot_join"), false);
  assert.ok(closed >= 1, "the replayed channel is closed");
});

test("Nearby messages enforce size and DataChannel backpressure limits", async() => {
  const session = await hostSession();
  const guest = session.registry.join({
    browserId: browserId("backpressure"),
    reconnectProof: proof("8"),
    nickname: "Buffer Guest",
    avatar: "🚀"
  }).member;
  let sends = 0;
  let closes = 0;
  const record = {
    peerKey: "peer_backpressure",
    pairingId: null,
    memberId: guest.memberId,
    status: "connected",
    lostTimer: 0,
    expiryTimer: 0,
    channel: { readyState: "open", bufferedAmount: 0, send(){ sends += 1; }, close(){ closes += 1; } },
    pc: { close(){ closes += 1; } }
  };
  session.peers.set(record.peerKey, record);
  assert.throws(() => session._sendRecord(record, "room-rpc", { data: "x".repeat(140 * 1024) }), error => error?.code === "message_too_large");
  assert.equal(sends, 0);

  record.channel.bufferedAmount = 600 * 1024;
  assert.throws(() => session._sendRecord(record, "room-rpc", { operation: "http" }), error => error?.code === "peer_backpressure");
  assert.ok(closes >= 2);
  assert.equal(session.registry.get(guest.memberId).presence, "disconnected");
  assert.equal(session.peers.has(record.peerKey), false);
});

test("inbound DataChannel traffic is directional, bounded, and closes sustained abuse", async(t) => {
  const createPeer = async suffix => {
    const session = await hostSession();
    const guest = session.registry.join({
      browserId: browserId(`inbound-${suffix}`),
      reconnectProof: proof("6"),
      nickname: `Inbound ${suffix}`,
      avatar: "🚀"
    }).member;
    let closes = 0;
    const record = {
      peerKey: `peer_inbound_${suffix}`,
      pairingId: null,
      memberId: guest.memberId,
      status: "connected",
      lostTimer: 0,
      expiryTimer: 0,
      channel: { readyState: "open", bufferedAmount: 0, send(){}, close(){ closes += 1; } },
      pc: { close(){ closes += 1; } }
    };
    session.peers.set(record.peerKey, record);
    const wire = (type, index, payload = {}) => JSON.stringify(makeNearbyEnvelope(type, {
      sessionId: session.sessionId,
      payload
    }, { messageId: `message_${suffix}_${String(index).padStart(4, "0")}`, sentAt: 1000 }));
    return { session, guest, record, wire, closes: () => closes };
  };

  await t.test("host-only message types are rejected from a guest", async() => {
    const peer = await createPeer("direction");
    peer.session._receiveRecord(peer.record, peer.wire("pong", 0), "host");
    assert.equal(peer.record.closed, undefined, "a valid guest-to-host envelope stays connected");
    for(let index = 1; index <= 6; index += 1){
      peer.session._receiveRecord(peer.record, peer.wire("welcome", index, { identity: {} }), "host");
    }
    assert.equal(peer.record.closed, true);
    assert.equal(peer.session.peers.has(peer.record.peerKey), false);
    assert.equal(peer.session.registry.get(peer.guest.memberId).presence, "disconnected");
    assert.equal(peer.closes(), 2);
  });

  await t.test("guest-only message types are rejected from a host", async() => {
    const session = new NearbyArcadeSession({
      storage: new MemoryNearbyStorage({ cryptoObject: webcrypto }),
      cryptoObject: webcrypto,
      now: () => 1000,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout
    });
    await session.initialize();
    session.role = "guest";
    session.sessionId = "session_guest_direction";
    session.status = "Connected";
    let closes = 0;
    const record = {
      peerKey: "peer_guest_direction",
      memberId: "member_guest_direction",
      status: "connected",
      lostTimer: 0,
      expiryTimer: 0,
      channel: { readyState: "open", bufferedAmount: 0, send(){}, close(){ closes += 1; } },
      pc: { close(){ closes += 1; } }
    };
    session.hostPeer = record;
    const wire = (type, index) => JSON.stringify(makeNearbyEnvelope(type, {
      sessionId: session.sessionId,
      payload: {}
    }, { messageId: `message_guest_direction_${index}`, sentAt: 1000 }));
    session._receiveRecord(record, wire("pong", 0), "guest");
    assert.equal(record.closed, undefined);
    for(let index = 1; index <= 6; index += 1) session._receiveRecord(record, wire("room-rpc", index), "guest");
    assert.equal(record.closed, true);
    assert.equal(session.hostPeer, null);
    assert.equal(closes, 2);
    assert.match(session.status, /Reconnect to Nearby Arcade/i);
  });

  await t.test("aggregate byte volume is capped before repeated JSON parsing", async() => {
    const peer = await createPeer("bytes");
    const padding = "x".repeat(110 * 1024);
    let sent = 0;
    while(!peer.record.closed && sent < 30){
      peer.session._receiveRecord(peer.record, peer.wire("pong", sent, { padding }), "host");
      sent += 1;
    }
    assert.equal(peer.record.closed, true);
    assert.ok(sent < 30, "a sustained multi-megabyte burst is cut off");
    assert.equal(peer.session.registry.get(peer.guest.memberId).presence, "disconnected");
  });

  await t.test("aggregate envelope count is capped even for tiny valid messages", async() => {
    const peer = await createPeer("count");
    for(let index = 0; index < 160; index += 1){
      peer.session._receiveRecord(peer.record, peer.wire("pong", index), "host");
    }
    assert.equal(peer.record.closed, undefined, "the generous normal-traffic allowance remains connected");
    peer.session._receiveRecord(peer.record, peer.wire("pong", 160), "host");
    assert.equal(peer.record.closed, true);
    assert.equal(peer.session.peers.has(peer.record.peerKey), false);
  });
});

test("completion lookup requests are rate limited per member", async() => {
  let clock = 9000;
  const session = await hostSession({ now: () => clock });
  const guest = session.registry.join({
    browserId: browserId("completion-spam"),
    reconnectProof: proof("7"),
    nickname: "Completion Guest",
    avatar: "🦄"
  }).member;
  let lookups = 0;
  session.setCompletionHandler(async() => { lookups += 1; return null; });
  const record = { memberId: guest.memberId };
  for(let index = 0; index < 30; index += 1){
    session._receiveFromGuest(record, { type: "game-completed-request", payload: { gameId: "chess", roomCode: "ABC234", version: index } });
  }
  await flush();
  assert.equal(lookups, 1);
  clock += 500;
  session._receiveFromGuest(record, { type: "game-completed-request", payload: { gameId: "chess", roomCode: "ABC234", version: 31 } });
  await flush();
  assert.equal(lookups, 2);
});

test("an explicit guest leave closes its authenticated channel", async() => {
  const session = await hostSession();
  const guest = session.registry.join({
    browserId: browserId("explicit-leave"),
    reconnectProof: proof("d"),
    nickname: "Leaving Guest",
    avatar: "🚀"
  }).member;
  let closes = 0;
  const record = {
    peerKey: "peer_explicit_leave",
    memberId: guest.memberId,
    status: "connected",
    lostTimer: 0,
    expiryTimer: 0,
    channel: { readyState: "open", close(){ closes += 1; } },
    pc: { close(){ closes += 1; } }
  };
  session.peers.set(record.peerKey, record);

  session._receiveFromGuest(record, { type: "member-leave", payload: {} });

  assert.equal(session.registry.get(guest.memberId).presence, "disconnected");
  assert.equal(record.closed, true);
  assert.equal(session.peers.has(record.peerKey), false);
  assert.equal(closes, 2);
});

test("cancelled player invitations close peer connections and release pairing slots", async() => {
  const session = await hostSession();
  let closed = 0;
  for(let index = 0; index < 10; index += 1){
    const record = {
      peerKey: `peer_cancel_${index}`,
      pairingId: `pair_cancel_${index}`,
      memberId: null,
      lostTimer: 0,
      expiryTimer: 0,
      channel: { close(){ closed += 1; } },
      pc: { close(){ closed += 1; } }
    };
    session.pendingPairings.set(record.pairingId, record);
    session.peers.set(record.peerKey, record);
    assert.equal(session.cancelPairing(record.pairingId), true);
    assert.equal(session.pendingPairings.size, 0);
    assert.equal(session.peers.size, 0);
  }
  assert.equal(closed, 20);
  assert.equal(session.cancelPairing("pair_missing"), false);
});

test("leaving while a host offer is gathering cannot resurrect a pairing", async() => {
  const session = await hostSession();
  let offerStartedResolve;
  const offerStarted = new Promise(resolve => { offerStartedResolve = resolve; });
  let closed = 0;
  const peer = { close(){ closed += 1; } };
  session.rtcFactory = () => peer;
  session.configureSignaling({
    createPairingCredentials: () => ({ pairingId: "pair_late_host_offer", pairingToken: "token_late_host_offer_1234", createdAt: 1000, expiresAt: 301000 }),
    createSignal: value => value,
    serializeSignal: async() => "AN1.j.offer",
    deserializeSignal: async() => ({}),
    createQrFrames: value => [value],
    createLocalAnswer(){},
    createLocalOffer({ signal }){
      offerStartedResolve();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
  });
  const creating = session.createHostInvitation();
  await offerStarted;
  await session.leave({ preserveCheckpoint: true, quiet: true });

  await assert.rejects(creating, error => error?.name === "AbortError");
  assert.equal(closed, 1);
  assert.equal(session.snapshot().active, false);
  assert.equal(session.peers.size, 0);
  assert.equal(session.pendingPairings.size, 0);
});

test("cancelling guest QR setup aborts ICE and cannot create a late guest session", async() => {
  let closed = 0;
  let answerStartedResolve;
  const answerStarted = new Promise(resolve => { answerStartedResolve = resolve; });
  const peer = {
    ondatachannel: null,
    close(){ closed += 1; }
  };
  const session = new NearbyArcadeSession({
    storage: new MemoryNearbyStorage({ cryptoObject: webcrypto }),
    cryptoObject: webcrypto,
    rtcFactory: () => peer,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout
  });
  await session.initialize();
  session.configureSignaling({
    createPairingCredentials(){},
    createSignal(value){ return value; },
    serializeSignal: async() => "AN1.j.response",
    deserializeSignal: async() => ({
      sessionId: "session_cancelled_guest",
      pairingId: "pair_cancelled_guest",
      pairingToken: "token_cancelled_guest_1234",
      createdAt: 1000,
      expiresAt: 301000,
      peerId: "peer_cancelled_host",
      description: { type: "offer", sdp: "local offer" }
    }),
    createQrFrames: value => [value],
    createLocalOffer(){},
    createLocalAnswer({ signal }){
      answerStartedResolve();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
  });
  const controller = new AbortController();
  const joining = session.joinFromInvitation({ nickname: "Scarlett", avatar: "🦄", color: "#ff5ac8" }, "wire", { signal: controller.signal });
  await answerStarted;
  controller.abort();

  await assert.rejects(joining, error => error?.name === "AbortError");
  assert.equal(closed, 1);
  assert.equal(session.snapshot().active, false);
  assert.equal(session.hostPeer, null);
  assert.equal(session.peers.size, 0);
});

test("remote end and removal physically close the guest transport", async(t) => {
  for(const kind of ["ended", "removed"]){
    await t.test(kind, async() => {
      const session = new NearbyArcadeSession({
        storage: new MemoryNearbyStorage({ cryptoObject: webcrypto }),
        cryptoObject: webcrypto,
        setIntervalFn: () => 1,
        clearIntervalFn: () => {},
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout
      });
      await session.initialize();
      session.role = "guest";
      session.sessionId = "session_remote_cleanup";
      let closes = 0;
      const record = {
        peerKey: "peer_remote_cleanup",
        memberId: "member_remote_cleanup",
        lostTimer: 0,
        expiryTimer: 0,
        channel: { close(){ closes += 1; } },
        pc: { close(){ closes += 1; } }
      };
      session.hostPeer = record;
      if(kind === "ended") session._remoteEnded("Done");
      else session._remoteRemoved();
      assert.equal(closes, 2);
      assert.equal(record.closed, true);
      assert.equal(session.hostPeer, null);
      assert.equal(session.snapshot().active, false);
    });
  }
});

test("late peer close callbacks cannot resurrect state after the host ends", async() => {
  const session = await hostSession();
  const guest = session.registry.join({
    browserId: browserId("late-close"),
    reconnectProof: proof("9"),
    nickname: "Late Guest",
    avatar: "🚀"
  }).member;
  const record = {
    peerKey: "peer_late_close",
    pairingId: null,
    memberId: guest.memberId,
    status: "connected",
    lostTimer: 0,
    expiryTimer: 0,
    channel: { readyState: "open", onclose: null, close(){ const callback = this.onclose; setTimeout(() => callback?.(), 0); } },
    pc: { connectionState: "connected", onconnectionstatechange: null, oniceconnectionstatechange: null, close(){ const callback = this.onconnectionstatechange; setTimeout(() => callback?.(), 0); } }
  };
  session.peers.set(record.peerKey, record);
  session._wirePeer(record, "host");
  await session.end();
  await flush();
  assert.equal(session.snapshot().active, false);
  assert.equal(session.snapshot().status, "Internet");
  assert.equal(session.peers.size, 0);
});

test("child completion reports cannot award stars without canonical verification", async() => {
  const session = await hostSession();
  const hostId = session.identity.memberId;
  const fabricated = {
    gameId: "chess",
    roomCode: "ABC234",
    version: 9,
    winnerMemberId: hostId,
    winnerName: "Spoofed Winner"
  };

  session.setCompletionHandler(async () => ({ ...fabricated, canonical: false }));
  assert.equal(session.reportGameCompleted(fabricated), true);
  await flush();
  assert.equal(session.registry.get(hostId).stars, 0);

  let verifiedMember = null;
  session.setCompletionHandler(async ({ member }) => {
    verifiedMember = member;
    return { canonical: true, verifiedRules: true, gameId: "chess", roomCode: "ABC234", version: 9, winnerMemberId: hostId, tie: false };
  });
  session.reportGameCompleted({ ...fabricated, winnerMemberId: "member_attacker_selected" });
  await flush();
  assert.equal(verifiedMember.memberId, hostId, "the completion verifier receives the authoritative sender");
  assert.equal(session.registry.get(hostId).stars, 1);

  session.reportGameCompleted(fabricated);
  await flush();
  assert.equal(session.registry.get(hostId).stars, 1, "the same canonical game completion awards only one star");
  assert.equal(await session.acceptCanonicalCompletion({ ...fabricated, canonical: false, version: 10 }), false);
  assert.equal(await session.acceptCanonicalCompletion({ ...fabricated, canonical: true, verifiedRules: false, version: 11 }), false, "generic snapshot completion cannot award a Star");
  assert.equal(session.registry.get(hostId).stars, 1);
});

test("canonical completion keys are idempotent and ties never award a star", async() => {
  const session = await hostSession();
  const hostId = session.identity.memberId;
  const win = { canonical: true, verifiedRules: true, completionId: "terminal:arcade:ROOM22:12", gameId: "memory", roomCode: "ROOM22", version: 12, winnerMemberId: hostId, tie: false };
  assert.equal(await session.acceptCanonicalCompletion(win), true);
  assert.equal(await session.acceptCanonicalCompletion(win), false);
  assert.equal(await session.acceptCanonicalCompletion({ ...win, version: 13 }), false, "post-finish version drift cannot award the same terminal event twice");
  assert.equal(session.registry.get(hostId).stars, 1);

  const tie = { canonical: true, verifiedRules: true, gameId: "dots", roomCode: "ROOM23", version: 7, tie: true, winnerMemberId: hostId };
  assert.equal(await session.acceptCanonicalCompletion(tie), true);
  assert.equal(session.registry.get(hostId).stars, 1);
});

test("verified completion dedupe survives a host checkpoint resume", async() => {
  const storage = new MemoryNearbyStorage({ cryptoObject: webcrypto });
  const createSession = async() => {
    const value = new NearbyArcadeSession({
      storage,
      cryptoObject: webcrypto,
      now: () => 2000,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout
    });
    await value.initialize();
    return value;
  };
  const first = await createSession();
  await first.startHost({ nickname: "Logan", avatar: "🦖", color: "#21dcff" });
  const completion = {
    canonical: true,
    verifiedRules: true,
    gameId: "chess",
    roomCode: "SAVE22",
    version: 33,
    winnerMemberId: first.identity.memberId,
    tie: false
  };
  assert.equal(await first.acceptCanonicalCompletion(completion), true);
  await first.checkpointNow();
  assert.equal(first.registry.get(first.identity.memberId).stars, 1);

  const resumed = await createSession();
  await resumed.startHost(resumed.draftProfile(), { resume: true });
  assert.equal(resumed.registry.get(resumed.identity.memberId).stars, 1);
  assert.equal(await resumed.acceptCanonicalCompletion(completion), false);
  assert.equal(resumed.registry.get(resumed.identity.memberId).stars, 1);
});

test("host resume does not restore phantom connected guests", async() => {
  const storage = new MemoryNearbyStorage({ cryptoObject: webcrypto });
  const makeSession = async() => {
    const value = new NearbyArcadeSession({
      storage,
      cryptoObject: webcrypto,
      now: () => 2500,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout
    });
    await value.initialize();
    return value;
  };

  const first = await makeSession();
  await first.startHost({ nickname: "Logan", avatar: "🦖", color: "#21dcff" });
  const reconnectSecret = "guest-checkpoint-reconnect-secret";
  const guestProfile = {
    browserId: browserId("checkpoint-guest"),
    reconnectProof: await secretProof(reconnectSecret),
    nickname: "Scarlett",
    avatar: "🦄",
    color: "#ff5ac8"
  };
  const guest = first.registry.join(guestProfile).member;
  assert.equal(first.snapshot().connected, 2);
  await first.checkpointNow();

  const resumed = await makeSession();
  await resumed.startHost(resumed.draftProfile(), { resume: true });
  assert.equal(resumed.peers.size, 0);
  assert.equal(resumed.snapshot().connected, 1, "only the local host has a live transport after reload");
  assert.equal(resumed.registry.get(guest.memberId).presence, "disconnected");
  assert.throws(() => resumed.registry.join({ ...guestProfile, reconnectProof: proof("f") }), /prove|proof/i);
  assert.equal(resumed.registry.get(guest.memberId).presence, "disconnected", "an unproved reclaim cannot become present");

  const reconnected = resumed.registry.join(guestProfile);
  assert.equal(reconnected.reconnected, true);
  assert.equal(resumed.registry.get(guest.memberId).presence, "connected", "the reserved seat returns only after proof succeeds");
  assert.equal(resumed.snapshot().connected, 2);
});

test("checkpoint writes stay ordered when an older storage write is delayed", async() => {
  class DelayedStorage extends MemoryNearbyStorage {
    delayNext = false;
    started = null;
    release = null;
    async saveCheckpoint(value){
      if(this.delayNext){
        this.delayNext = false;
        await new Promise(resolve => {
          this.release = resolve;
          this.started?.();
        });
      }
      return super.saveCheckpoint(value);
    }
  }
  const storage = new DelayedStorage({ cryptoObject: webcrypto });
  const session = new NearbyArcadeSession({
    storage,
    cryptoObject: webcrypto,
    now: () => 3000,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout
  });
  await session.initialize();
  await session.startHost({ nickname: "Logan", avatar: "🦖", color: "#21dcff" });
  storage.delayNext = true;
  const started = new Promise(resolve => { storage.started = resolve; });
  session.sessionName = "OLDER CHECKPOINT";
  const older = session.checkpointNow();
  await started;
  session.sessionName = "NEWEST CHECKPOINT";
  const newest = session.checkpointNow();
  storage.release();
  await Promise.all([older, newest]);
  assert.equal((await storage.loadCheckpoint()).sessionName, "NEWEST CHECKPOINT");
});

test("incompatible saved sessions are quarantined and require re-pairing", async() => {
  const storage = new MemoryNearbyStorage({ cryptoObject: webcrypto });
  await storage.saveCheckpoint({
    schema: 1,
    protocolVersion: 999,
    role: "host",
    sessionId: "session_incompatible_checkpoint",
    sessionName: "OLD ARCADE",
    mascot: "🐉",
    identity: { memberId: "member_incompatible_checkpoint" },
    members: []
  });
  const session = new NearbyArcadeSession({
    storage,
    cryptoObject: webcrypto,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout
  });
  let recovery = null;
  session.on("recovery-required", value => { recovery = value; });
  const state = await session.initialize();
  assert.equal(state.checkpoint, null);
  assert.equal(await storage.loadCheckpoint(), null);
  assert.equal(recovery.code, "checkpoint_version");
  assert.match(recovery.message, /different version|reconnect/i);
});

test("host resume rejects a checkpoint owned by a different browser or containing two hosts", async(t) => {
  const makeSession = storage => new NearbyArcadeSession({
    storage,
    cryptoObject: webcrypto,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout
  });

  await t.test("different browser", async() => {
    const storage = new MemoryNearbyStorage({ cryptoObject: webcrypto });
    const first = makeSession(storage);
    await first.initialize();
    await first.startHost({ nickname: "Logan", avatar: "🦖", color: "#21dcff" });
    await first.checkpointNow();
    await storage.set("browser-identity", {
      browserId: browserId("replacement-host"),
      reconnectSecret: "replacement-host-secret",
      createdAt: 2000
    });
    const resumed = makeSession(storage);
    let recovery = null;
    resumed.on("recovery-required", value => { recovery = value; });
    assert.equal((await resumed.initialize()).checkpoint, null);
    assert.equal(recovery?.code, "checkpoint_invalid");
    assert.match(recovery?.message || "", /host identity|browser|reconnect/i);
  });

  await t.test("multiple hosts", async() => {
    const storage = new MemoryNearbyStorage({ cryptoObject: webcrypto });
    const first = makeSession(storage);
    await first.initialize();
    await first.startHost({ nickname: "Logan", avatar: "🦖", color: "#21dcff" });
    await first.checkpointNow();
    const corrupt = structuredClone(await storage.loadCheckpoint());
    corrupt.members.push({
      ...corrupt.members[0],
      memberId: "member_second_checkpoint_host",
      browserId: browserId("second-checkpoint-host"),
      reconnectProof: proof("f"),
      nickname: "Second Host",
      joinedAt: 2001,
      host: true,
      removed: false
    });
    await storage.saveCheckpoint(corrupt);
    const resumed = makeSession(storage);
    let recovery = null;
    resumed.on("recovery-required", value => { recovery = value; });
    assert.equal((await resumed.initialize()).checkpoint, null);
    assert.equal(recovery?.code, "checkpoint_invalid");
  });
});

test("concurrent first identity reads share one proof-bound browser identity", async() => {
  const storage = new MemoryNearbyStorage({ cryptoObject: webcrypto });
  const identities = await Promise.all(Array.from({ length: 24 }, () => storage.browserIdentity()));
  assert.equal(new Set(identities.map(value => value.browserId)).size, 1);
  assert.equal(new Set(identities.map(value => value.reconnectSecret)).size, 1);
  assert.deepEqual(await storage.browserIdentity(), identities[0]);
});

test("host checkpoints retain bounded removed identity reservations beyond eight live seats", async() => {
  const storage = new MemoryNearbyStorage({ cryptoObject: webcrypto });
  const makeSession = () => new NearbyArcadeSession({
    storage,
    cryptoObject: webcrypto,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout
  });
  const session = makeSession();
  await session.initialize();
  await session.startHost({ nickname: "Logan", avatar: "🦖", color: "#21dcff" });
  const profile = index => ({
    browserId: browserId(`history_${index}`),
    reconnectProof: String(index % 10).repeat(64),
    nickname: `History ${index}`,
    avatar: "🚀",
    color: "#ff5ac8"
  });
  let newest;
  for(let index = 1; index < 8; index++) newest = session.registry.join(profile(index)).member;
  for(let index = 8; index < 32; index++){
    assert.equal(session.registry.remove(newest.memberId), true);
    newest = session.registry.join(profile(index)).member;
  }
  assert.equal(session.registry.list().length, 8);
  assert.equal(session.registry.serialize().length, 32);
  await session.checkpointNow();

  const resumed = makeSession();
  const initialized = await resumed.initialize();
  assert.equal(initialized.checkpoint.role, "host");
  await resumed.startHost({ nickname: "Logan", avatar: "🦖", color: "#21dcff" }, { resume: true });
  assert.equal(resumed.registry.list().length, 8);
  assert.equal(resumed.registry.serialize().length, 32, "removed identities survive a host checkpoint resume");

  const invalid = structuredClone(await storage.loadCheckpoint());
  invalid.members.find(member => member.removed === true).removed = false;
  await storage.saveCheckpoint(invalid);
  const rejected = makeSession();
  let recovery = null;
  rejected.on("recovery-required", value => { recovery = value; });
  assert.equal((await rejected.initialize()).checkpoint, null);
  assert.equal(recovery?.code, "checkpoint_invalid", "a checkpoint may not restore more than eight current players");
});

test("guests reject malformed canonical host membership and close the peer", async(t) => {
  const hostMember = {
    memberId: "member_host_canonical",
    nickname: "Logan",
    avatar: "🦖",
    color: "#21dcff",
    host: true,
    presence: "connected",
    stars: 0,
    joinedAt: 1000,
    removed: false
  };
  const guestMember = {
    memberId: "member_guest_canonical",
    nickname: "Scarlett",
    avatar: "🦄",
    color: "#ff5ac8",
    host: false,
    presence: "connected",
    stars: 0,
    joinedAt: 1001,
    removed: false
  };
  const baseState = {
    sessionId: "session_canonical_validation",
    sessionName: "ROCKET PANDA",
    mascot: "🐼",
    joiningLocked: false,
    members: [hostMember, guestMember]
  };
  const cases = [
    ["more than eight members", state => { state.members = [hostMember, ...Array.from({ length: 8 }, (_, index) => ({ ...guestMember, memberId: `member_guest_extra_${index}`, nickname: `Guest ${index}` }))]; }],
    ["duplicate member ids", state => { state.members[1].memberId = state.members[0].memberId; }],
    ["duplicate normalized names", state => { state.members[1].nickname = "LOGAN"; }],
    ["invalid member ids", state => { state.members[1].memberId = "bad!"; }],
    ["no authoritative host", state => { state.members[0].host = false; }],
    ["multiple authoritative hosts", state => { state.members[1].host = true; }],
    ["unsanitized names", state => { state.members[1].nickname = " Scarlett "; }],
    ["unapproved avatars", state => { state.members[1].avatar = "👾"; }],
    ["invalid colors", state => { state.members[1].color = "red"; }]
  ];

  for(const [label, mutate] of cases){
    await t.test(label, async() => {
      const session = new NearbyArcadeSession({
        storage: new MemoryNearbyStorage({ cryptoObject: webcrypto }),
        cryptoObject: webcrypto,
        setIntervalFn: () => 1,
        clearIntervalFn: () => {},
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout
      });
      await session.initialize();
      session.role = "guest";
      session.sessionId = baseState.sessionId;
      session.identity = structuredClone(guestMember);
      session.status = "Connected";
      let closes = 0;
      const record = {
        peerKey: `peer_${label.replace(/\W/g, "_")}`,
        memberId: guestMember.memberId,
        status: "connected",
        lostTimer: 0,
        expiryTimer: 0,
        channel: { readyState: "open", close(){ closes += 1; } },
        pc: { close(){ closes += 1; } }
      };
      session.hostPeer = record;
      const errors = [];
      session.on("error", value => errors.push(value));
      const state = structuredClone(baseState);
      mutate(state);
      session._receiveFromHost(record, { type: "session-state", payload: state });
      assert.equal(session.hostPeer, null);
      assert.equal(record.closed, true);
      assert.equal(closes, 2);
      assert.equal(errors[0]?.code, "canonical_state_invalid");
      assert.match(session.status, /Reconnect to Nearby Arcade/i);
    });
  }
});

test("room RPC result send failures close the guest without throwing a second response", async() => {
  for(const bufferedAmount of [600 * 1024, 0]){
    const session = await hostSession();
    const guest = session.registry.join({
      browserId: browserId(`rpc-result-${bufferedAmount}`),
      reconnectProof: proof("c"),
      nickname: bufferedAmount ? "Slow Guest" : "Closed Guest",
      avatar: "🦄"
    }).member;
    let closes = 0;
    const record = {
      peerKey: `peer_rpc_${bufferedAmount}`,
      pairingId: null,
      memberId: guest.memberId,
      status: "connected",
      lostTimer: 0,
      expiryTimer: 0,
      channel: { readyState: bufferedAmount ? "open" : "closed", bufferedAmount, send(){ throw new Error("send should not complete"); }, close(){ closes += 1; } },
      pc: { close(){ closes += 1; } }
    };
    session.peers.set(record.peerKey, record);
    session.setRpcHandler(async() => ({ status: 200, body: { ok: true } }));
    await assert.doesNotReject(session._handleRemoteRpc(record, guest, {
      requestId: `request_rpc_result_${String(bufferedAmount).padEnd(8, "0")}`,
      operation: "http",
      payload: { url: "/api/rooms/ABC234", method: "GET" }
    }));
    assert.equal(record.closed, true);
    assert.equal(session.peers.has(record.peerKey), false);
    assert.equal(session.registry.get(guest.memberId).presence, "disconnected");
    assert.equal(closes, 2);
  }
});
