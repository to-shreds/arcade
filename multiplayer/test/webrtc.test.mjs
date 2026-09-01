import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRemoteAnswer,
  assertHostOnlyDescription,
  createLocalAnswer,
  createLocalOffer,
  createNearbyPeerConnection,
  descriptionHasHostCandidate,
  isLocalCandidateAddress,
} from '../webrtc.mjs';

const HOST_CANDIDATE = 'a=candidate:1 1 UDP 2122260223 192.168.4.2 51234 typ host\r\n';

class FakePeer extends EventTarget {
  constructor(config = {}) {
    super();
    this.config = config;
    this.iceGatheringState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.closed = false;
  }

  createDataChannel(label, options) {
    this.channel = { label, options };
    return this.channel;
  }

  async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\n' }; }

  async setLocalDescription(description) {
    this.localDescription = { type: description.type, sdp: `${description.sdp}${HOST_CANDIDATE}` };
    queueMicrotask(() => {
      this.iceGatheringState = 'complete';
      this.dispatchEvent(new Event('icegatheringstatechange'));
    });
  }

  async setRemoteDescription(description) { this.remoteDescription = description; }
  close() { this.closed = true; }
}

test('offer helper creates an ordered data channel and gathers host candidates', async () => {
  const result = await createLocalOffer({ RTCPeerConnection: FakePeer, timeoutMs: 1_000 });
  assert.equal(result.dataChannel.label, 'arcade-nearby-v1');
  assert.deepEqual(result.dataChannel.options, { ordered: true });
  assert.deepEqual(result.peerConnection.config.iceServers, []);
  assert.equal(result.description.type, 'offer');
  assert.equal(descriptionHasHostCandidate(result.description), true);
});

test('answer helper applies the offer before creating and gathering an answer', async () => {
  const remoteDescription = { type: 'offer', sdp: `v=0\r\n${HOST_CANDIDATE}` };
  const result = await createLocalAnswer({ remoteDescription, RTCPeerConnection: FakePeer, timeoutMs: 1_000 });
  assert.deepEqual(result.peerConnection.remoteDescription, remoteDescription);
  assert.equal(result.description.type, 'answer');
  await applyRemoteAnswer(result.peerConnection, { type: 'answer', sdp: `v=0\r\n${HOST_CANDIDATE}` });
  assert.equal(result.peerConnection.remoteDescription.type, 'answer');
});

test('remote descriptions require host-only candidates before ICE sees them', async () => {
  const relay = 'a=candidate:2 1 UDP 1686052607 203.0.113.7 3478 typ relay\r\n';
  const reflexive = 'a=candidate:3 1 UDP 1686052607 198.51.100.8 6000 typ srflx raddr 192.168.4.2 rport 51234\r\n';
  assert.throws(() => assertHostOnlyDescription({ type: 'offer', sdp: 'v=0\r\n' }), error => error.code === 'host_candidate_missing');
  const filtered = assertHostOnlyDescription({ type: 'offer', sdp: `v=0\r\n${HOST_CANDIDATE}${relay}` });
  assert.match(filtered.sdp, /typ host/);
  assert.doesNotMatch(filtered.sdp, /typ relay/);
  const peer = new FakePeer();
  await assert.rejects(
    createLocalAnswer({ remoteDescription: { type: 'offer', sdp: `v=0\r\n${reflexive}` }, peerConnection: peer }),
    error => error.code === 'non_local_candidate',
  );
  assert.equal(peer.remoteDescription, null);
  await assert.rejects(
    applyRemoteAnswer(peer, { type: 'answer', sdp: `v=0\r\n${relay}` }),
    error => error.code === 'non_local_candidate',
  );
  assert.equal(peer.remoteDescription, null);
});

test('host candidates accept only private, link-local, ULA, or mDNS addresses', () => {
  for (const address of ['10.0.0.2', '172.16.4.3', '172.31.255.9', '192.168.50.4', '169.254.1.8', '127.0.0.1', 'fe80::1234', 'fd12:3456::8', '4fef6a2c-1234.local']) {
    assert.equal(isLocalCandidateAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:4860:4860::8888', 'example.com', '999.1.1.1']) {
    assert.equal(isLocalCandidateAddress(address), false, address);
  }
  const publicHost = 'a=candidate:4 1 UDP 2122260223 8.8.8.8 51234 typ host\r\n';
  assert.throws(
    () => assertHostOnlyDescription({ type: 'offer', sdp: `v=0\r\n${publicHost}` }),
    error => error.code === 'non_local_candidate',
  );
  const mixed = assertHostOnlyDescription({ type: 'offer', sdp: `v=0\r\n${HOST_CANDIDATE}${publicHost}` });
  assert.match(mixed.sdp, /192\.168\.4\.2/);
  assert.doesNotMatch(mixed.sdp, /8\.8\.8\.8/);
});

test('Nearby peer connections reject configured STUN or TURN servers', () => {
  assert.throws(
    () => createNearbyPeerConnection({ RTCPeerConnection: FakePeer, rtcConfig: { iceServers: [{ urls: 'stun:example.invalid' }] } }),
    error => error.code === 'external_ice_server',
  );
});
