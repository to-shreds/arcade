import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NearbyProtocolError,
  SIGNAL_LIMITS,
  base64UrlDecode,
  base64UrlEncode,
  createPairingCredentials,
} from '../protocol.mjs';
import {
  QrFrameCollector,
  createQrFrames,
  createSignal,
  crc32,
  deserializeSignal,
  parseQrFrame,
  reassembleQrFrames,
  serializeSignal,
} from '../signaling.mjs';

const NOW = 1_788_220_800_000;
const SESSION_ID = 'session_a1b2c3d4e5f6';
const PAIRING_ID = 'p1_a1b2c3d4e5f6g7h8';
const PAIRING_TOKEN = 'abcdefghijklmnopqrstuvwxYZ012345';

function sdp(kind = 'offer', repeats = 12) {
  return [
    'v=0',
    `o=- 123 2 IN IP4 127.0.0.1`,
    's=Nearby Arcade',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=setup:${kind === 'offer' ? 'actpass' : 'active'}`,
    ...Array.from({ length: repeats }, (_, index) => `a=candidate:${index + 1} 1 UDP 2122260223 192.168.4.${index + 2} ${5000 + index} typ host generation 0 network-cost 999`),
    'a=end-of-candidates',
    '',
  ].join('\r\n');
}

function signal(kind = 'offer', overrides = {}) {
  return createSignal({
    kind,
    sessionId: SESSION_ID,
    pairingId: PAIRING_ID,
    pairingToken: PAIRING_TOKEN,
    createdAt: NOW,
    expiresAt: NOW + 180_000,
    description: { type: kind, sdp: sdp(kind) },
    peerId: kind === 'answer' ? 'peer_a1b2c3d4e5f6' : null,
    ...overrides,
  });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error instanceof NearbyProtocolError && error.code === code);
}

test('URL-safe codec round-trips arbitrary bytes without Buffer', () => {
  const bytes = Uint8Array.from({ length: 257 }, (_, index) => (index * 61) & 255);
  assert.deepEqual(base64UrlDecode(base64UrlEncode(bytes)), bytes);
});

test('identity signaling is the interoperable default and round-trips', async () => {
  const original = signal();
  const wire = await serializeSignal(original, { now: NOW });
  assert.match(wire, /^AN1\.j\./);
  const decoded = await deserializeSignal(wire, {
    now: NOW + 1_000,
    expectedKind: 'offer',
    expectedSessionId: SESSION_ID,
    expectedPairingId: PAIRING_ID,
    expectedPairingToken: PAIRING_TOKEN,
  });
  assert.deepEqual(decoded, original);
});

test('explicit DEFLATE round-trips and materially compacts SDP', async () => {
  const original = signal('offer', { description: { type: 'offer', sdp: sdp('offer', 80) } });
  const identity = await serializeSignal(original, { compression: 'identity', now: NOW });
  const compressed = await serializeSignal(original, { compression: 'deflate', now: NOW });
  assert.match(compressed, /^AN1\.d\./);
  assert.ok(compressed.length < identity.length / 2);
  assert.deepEqual(await deserializeSignal(compressed, { now: NOW }), original);
});

test('automatic compression falls back when streams are missing or reject deflate-raw', async () => {
  const original = signal();
  const missing = await serializeSignal(original, { compression: 'auto', streams: {}, now: NOW });
  assert.match(missing, /^AN1\.j\./);
  class RejectingCompressionStream {
    constructor() { throw new TypeError('format not supported'); }
  }
  const rejecting = await serializeSignal(original, {
    compression: 'auto',
    streams: { CompressionStream: RejectingCompressionStream },
    now: NOW,
  });
  assert.match(rejecting, /^AN1\.j\./);
  await expectCode(
    serializeSignal(original, { compression: 'deflate', streams: {}, now: NOW }),
    'compression_unavailable',
  );
});

test('compressed input is rejected cleanly when decompression is unavailable', async () => {
  const wire = await serializeSignal(signal(), { compression: 'deflate', now: NOW });
  await expectCode(deserializeSignal(wire, { streams: {}, now: NOW }), 'decompression_unavailable');
});

test('answer validation binds session, invitation id, and secret token', async () => {
  const answer = signal('answer');
  const wire = await serializeSignal(answer, { now: NOW });
  const decoded = await deserializeSignal(wire, {
    now: NOW,
    expectedKind: 'answer',
    expectedSessionId: SESSION_ID,
    expectedPairingId: PAIRING_ID,
    expectedPairingToken: PAIRING_TOKEN,
  });
  assert.equal(decoded.peerId, 'peer_a1b2c3d4e5f6');
  await expectCode(deserializeSignal(wire, { now: NOW, expectedPairingToken: `${PAIRING_TOKEN}x` }), 'token_mismatch');
  await expectCode(deserializeSignal(wire, { now: NOW, expectedPairingId: 'p9_wronginvitation' }), 'pairing_mismatch');
  await expectCode(deserializeSignal(wire, { now: NOW, expectedSessionId: 'session_wrong12345' }), 'session_mismatch');
});

test('expired, version-mismatched, malformed, and oversized payloads are rejected', async () => {
  const wire = await serializeSignal(signal(), { now: NOW });
  await expectCode(deserializeSignal(wire, { now: NOW + 300_001 }), 'pairing_expired');
  await expectCode(deserializeSignal('garbage', { now: NOW }), 'invalid_wire_format');
  await expectCode(deserializeSignal(`AN1.j.${'A'.repeat(SIGNAL_LIMITS.maxWireChars)}`, { now: NOW }), 'payload_too_large');

  const compact = JSON.parse(new TextDecoder().decode(base64UrlDecode(wire.split('.')[2])));
  compact[0] = 99;
  const wrongVersion = `AN1.j.${base64UrlEncode(new TextEncoder().encode(JSON.stringify(compact)))}`;
  await expectCode(deserializeSignal(wrongVersion, { now: NOW }), 'version_mismatch');

  assert.throws(() => signal('offer', {
    description: { type: 'offer', sdp: 'x'.repeat(SIGNAL_LIMITS.maxSdpBytes + 1) },
  }), error => error.code === 'sdp_too_large');
});

test('pairing payloads reject unsafe-only candidates and strip unsafe mixed candidates', () => {
  const relay = sdp().replace('typ host', 'typ relay');
  const reflexive = sdp().replace('typ host', 'typ srflx raddr 192.168.4.2 rport 5000');
  const unsafeOnly = sdp('offer', 1).replace('typ host', 'typ relay');
  assert.throws(() => signal('offer', { description: { type: 'offer', sdp: unsafeOnly } }), error => error.code === 'non_local_candidate');
  const relayFiltered = signal('offer', { description: { type: 'offer', sdp: relay } });
  const reflexiveFiltered = signal('offer', { description: { type: 'offer', sdp: reflexive } });
  assert.doesNotMatch(relayFiltered.description.sdp, /typ relay/);
  assert.doesNotMatch(reflexiveFiltered.description.sdp, /typ srflx/);
  assert.match(relayFiltered.description.sdp, /typ host/);
});

test('QR frames are deterministic, bounded, and reassemble out of order with duplicates', async () => {
  const wire = await serializeSignal(signal('offer', { description: { type: 'offer', sdp: sdp('offer', 70) } }), {
    compression: 'identity',
    now: NOW,
  });
  const frames = createQrFrames(wire, { maxFrameChars: 300 });
  assert.ok(frames.length > 3);
  assert.deepEqual(createQrFrames(wire, { maxFrameChars: 300 }), frames);
  assert.ok(frames.every(frame => frame.length <= 300));
  const input = [...frames].reverse();
  input.splice(2, 0, input[2]);
  assert.equal(reassembleQrFrames(input), wire);

  const collector = new QrFrameCollector();
  let final;
  for (const frame of input) final = collector.add(frame);
  assert.equal(final.complete, true);
  assert.equal(final.received, frames.length);
  assert.equal(final.payload, wire);
});

test('QR collector rejects damage, mixed transfers, bad indices, and incomplete sequences', async () => {
  const firstWire = await serializeSignal(signal(), { now: NOW });
  const secondWire = await serializeSignal(signal('answer'), { now: NOW });
  const first = createQrFrames(firstWire, { maxFrameChars: 260 });
  const second = createQrFrames(secondWire, { maxFrameChars: 260 });
  const damaged = `${first[0].slice(0, -1)}${first[0].endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => parseQrFrame(damaged), error => error.code === 'frame_checksum_mismatch');
  const collector = new QrFrameCollector();
  collector.add(first[0]);
  assert.throws(() => collector.add(second[0]), error => error.code === 'mixed_qr_transfers');
  assert.throws(() => reassembleQrFrames(first.slice(1)), error => error.code === 'missing_qr_frame');
  assert.throws(() => parseQrFrame(first[0].replace(/:0\//, ':z/')), error => error.code === 'invalid_qr_frame');
});

test('conflicting duplicate QR frames are rejected even with a valid chunk checksum', async () => {
  const wire = await serializeSignal(signal(), { now: NOW });
  const frames = createQrFrames(wire, { maxFrameChars: 260 });
  assert.ok(frames.length > 1);
  const parsed = parseQrFrame(frames[0]);
  const changedChunk = `${parsed.chunk.slice(0, -1)}${parsed.chunk.endsWith('A') ? 'B' : 'A'}`;
  const changedChecksum = crc32(changedChunk).toString(16).padStart(8, '0');
  const conflicting = frames[0].replace(`:${parsed.frameChecksum}:${parsed.payloadChecksum}:${parsed.chunk}`, `:${changedChecksum}:${parsed.payloadChecksum}:${changedChunk}`);
  const collector = new QrFrameCollector();
  collector.add(frames[0]);
  assert.throws(() => collector.add(conflicting), error => error.code === 'conflicting_qr_frame');
});

test('independent second and third guest credentials receive distinct identifiers', () => {
  const second = createPairingCredentials({ guestOrdinal: 2, now: NOW });
  const third = createPairingCredentials({ guestOrdinal: 3, now: NOW });
  assert.match(second.pairingId, /^p2_/);
  assert.match(third.pairingId, /^p3_/);
  assert.notEqual(second.pairingId, third.pairingId);
  assert.notEqual(second.pairingToken, third.pairingToken);
});
