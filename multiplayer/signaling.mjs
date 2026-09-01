import {
  NEARBY_PROTOCOL_ID,
  NEARBY_PROTOCOL_VERSION,
  NEARBY_QR_PREFIX,
  NEARBY_WIRE_PREFIX,
  NearbyProtocolError,
  SIGNAL_LIMITS,
  assertPairingToken,
  assertSafeId,
  base64UrlDecode,
  base64UrlEncode,
  isPlainObject,
  utf8ByteLength,
  validatePairingWindow,
  validateProtocolVersion,
} from './protocol.mjs';
import { assertHostOnlyDescription } from './webrtc.mjs';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const SIGNAL_KIND_TO_CODE = Object.freeze({ offer: 0, answer: 1 });
const SIGNAL_CODE_TO_KIND = Object.freeze(['offer', 'answer']);
const COMPACT_SIGNAL_FIELDS = 9;
const QR_FRAME_RE = /^ANQ1:([a-f0-9]{8}-[0-9a-z]+):([0-9a-z]+)\/([0-9a-z]+):([a-f0-9]{8}):([a-f0-9]{8}):([A-Za-z0-9_.-]+)$/;

function fail(code, message, details) {
  throw new NearbyProtocolError(code, message, details);
}

function exactOptionalSafeId(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return assertSafeId(value, field);
}

export function createSignal({
  kind,
  sessionId,
  pairingId,
  pairingToken,
  createdAt = Date.now(),
  expiresAt = createdAt + SIGNAL_LIMITS.defaultTtlMs,
  description,
  peerId = null,
} = {}) {
  return validateSignal({
    protocol: NEARBY_PROTOCOL_ID,
    version: NEARBY_PROTOCOL_VERSION,
    kind,
    sessionId,
    pairingId,
    pairingToken,
    createdAt,
    expiresAt,
    description,
    peerId,
  }, { now: createdAt });
}

export function validateSignal(value, {
  now = Date.now(),
  expectedKind,
  expectedSessionId,
  expectedPairingId,
  expectedPairingToken,
} = {}) {
  if (!isPlainObject(value)) fail('invalid_signal', 'Pairing data must be an object.');
  validateProtocolVersion(value.protocol, value.version);
  if (!Object.hasOwn(SIGNAL_KIND_TO_CODE, value.kind)) fail('invalid_signal_kind', 'Pairing data must contain an offer or answer.');
  if (expectedKind && value.kind !== expectedKind) fail('unexpected_signal_kind', `Expected a ${expectedKind} pairing code.`);
  assertSafeId(value.sessionId, 'sessionId');
  assertSafeId(value.pairingId, 'pairingId');
  assertPairingToken(value.pairingToken);
  const peerId = exactOptionalSafeId(value.peerId, 'peerId');
  if (expectedSessionId && value.sessionId !== expectedSessionId) fail('session_mismatch', 'This response is for a different Nearby Arcade.');
  if (expectedPairingId && value.pairingId !== expectedPairingId) fail('pairing_mismatch', 'This response is for a different player invitation.');
  if (expectedPairingToken && value.pairingToken !== expectedPairingToken) fail('token_mismatch', 'This response does not match the invitation.');
  validatePairingWindow(value, now);
  if (!isPlainObject(value.description) || value.description.type !== value.kind || typeof value.description.sdp !== 'string') {
    fail('invalid_description', `Pairing data must contain a valid WebRTC ${value.kind}.`);
  }
  const sdpBytes = utf8ByteLength(value.description.sdp);
  if (!sdpBytes || sdpBytes > SIGNAL_LIMITS.maxSdpBytes) fail('sdp_too_large', 'WebRTC pairing data is empty or too large.');
  const checkedDescription = assertHostOnlyDescription({ type: value.kind, sdp: value.description.sdp });
  return Object.freeze({
    protocol: NEARBY_PROTOCOL_ID,
    version: NEARBY_PROTOCOL_VERSION,
    kind: value.kind,
    sessionId: value.sessionId,
    pairingId: value.pairingId,
    pairingToken: value.pairingToken,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    description: checkedDescription,
    peerId,
  });
}

function toCompactSignal(signal) {
  return [
    NEARBY_PROTOCOL_VERSION,
    SIGNAL_KIND_TO_CODE[signal.kind],
    signal.sessionId,
    signal.pairingId,
    signal.pairingToken,
    signal.createdAt,
    signal.expiresAt,
    signal.description.sdp,
    signal.peerId,
  ];
}

function fromCompactSignal(value) {
  if (!Array.isArray(value) || value.length !== COMPACT_SIGNAL_FIELDS) fail('invalid_signal', 'Pairing data has an invalid structure.');
  if (!Number.isSafeInteger(value[1]) || !Object.hasOwn(SIGNAL_CODE_TO_KIND, value[1])) {
    fail('invalid_signal_kind', 'Pairing data must contain an offer or answer.');
  }
  const kind = SIGNAL_CODE_TO_KIND[value[1]];
  return {
    protocol: NEARBY_PROTOCOL_ID,
    version: value[0],
    kind,
    sessionId: value[2],
    pairingId: value[3],
    pairingToken: value[4],
    createdAt: value[5],
    expiresAt: value[6],
    description: { type: kind, sdp: value[7] },
    peerId: value[8],
  };
}

async function transformBytes(bytes, StreamConstructor, format, maxBytes) {
  const transform = new StreamConstructor(format);
  const writer = transform.writable.getWriter();
  const writing = (async () => {
    await writer.write(bytes);
    await writer.close();
  })();
  const reader = transform.readable.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      length += chunk.byteLength;
      if (length > maxBytes) {
        await reader.cancel('Pairing payload is too large.');
        fail('payload_too_large', 'Pairing data expands beyond the safe limit.');
      }
      chunks.push(chunk);
    }
    await writing;
  } catch (error) {
    if (error instanceof NearbyProtocolError) throw error;
    fail('compression_failed', 'Pairing data could not be compressed or decompressed.');
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function streamConstructors(streams = globalThis) {
  return {
    CompressionStream: streams && streams.CompressionStream,
    DecompressionStream: streams && streams.DecompressionStream,
  };
}

/**
 * Serialize signaling data into ASCII suitable for QR, copy/paste, or sharing.
 * `auto` uses DEFLATE only when the platform supports it and it is smaller;
 * otherwise the compact JSON representation remains fully interoperable.
 */
export async function serializeSignal(signal, {
  compression = 'identity',
  streams = globalThis,
  now = Date.now(),
} = {}) {
  const checked = validateSignal(signal, { now });
  const raw = textEncoder.encode(JSON.stringify(toCompactSignal(checked)));
  if (raw.byteLength > SIGNAL_LIMITS.maxDecodedBytes) fail('payload_too_large', 'Pairing data is too large.');
  if (!['auto', 'deflate', 'identity'].includes(compression)) fail('invalid_compression', 'Unknown pairing compression mode.');
  const { CompressionStream } = streamConstructors(streams);
  let codec = 'j';
  let bytes = raw;
  if (compression !== 'identity' && typeof CompressionStream === 'function') {
    try {
      const compressed = await transformBytes(raw, CompressionStream, 'deflate-raw', SIGNAL_LIMITS.maxDecodedBytes);
      if (compression === 'deflate' || compressed.byteLength + 8 < raw.byteLength) {
        codec = 'd';
        bytes = compressed;
      }
    } catch (error) {
      // Some browsers expose CompressionStream but reject `deflate-raw`.
      // Automatic mode remains universally interoperable by using compact JSON.
      if (compression === 'deflate') throw error;
    }
  } else if (compression === 'deflate') {
    fail('compression_unavailable', 'This browser cannot compress pairing data.');
  }
  const wire = `${NEARBY_WIRE_PREFIX}.${codec}.${base64UrlEncode(bytes)}`;
  if (wire.length > SIGNAL_LIMITS.maxWireChars) fail('payload_too_large', 'Pairing data is too large.');
  return wire;
}

export async function deserializeSignal(wire, {
  streams = globalThis,
  now = Date.now(),
  expectedKind,
  expectedSessionId,
  expectedPairingId,
  expectedPairingToken,
} = {}) {
  if (typeof wire !== 'string' || !wire.length || wire.length > SIGNAL_LIMITS.maxWireChars) {
    fail('payload_too_large', 'Pairing data is empty or too large.');
  }
  const match = /^AN1\.([jd])\.([A-Za-z0-9_-]+)$/.exec(wire);
  if (!match) fail('invalid_wire_format', 'Pairing data format is not recognized.');
  const [, codec, encoded] = match;
  let bytes = base64UrlDecode(encoded, { maxBytes: SIGNAL_LIMITS.maxDecodedBytes });
  if (codec === 'd') {
    const { DecompressionStream } = streamConstructors(streams);
    if (typeof DecompressionStream !== 'function') {
      fail('decompression_unavailable', 'This browser cannot read the compressed pairing code.');
    }
    bytes = await transformBytes(bytes, DecompressionStream, 'deflate-raw', SIGNAL_LIMITS.maxDecodedBytes);
  }
  let compact;
  try {
    compact = JSON.parse(textDecoder.decode(bytes));
  } catch {
    fail('invalid_json', 'Pairing data is damaged or incomplete.');
  }
  return validateSignal(fromCompactSignal(compact), {
    now,
    expectedKind,
    expectedSessionId,
    expectedPairingId,
    expectedPairingToken,
  });
}

let crcTable;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

export function crc32(value) {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : value;
  let crc = 0xffffffff;
  const table = getCrcTable();
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function crcHex(value) {
  return crc32(value).toString(16).padStart(8, '0');
}

function parseBase36(value, field) {
  if (!/^[0-9a-z]+$/.test(value)) fail('invalid_qr_frame', `${field} is invalid.`);
  const number = Number.parseInt(value, 36);
  if (!Number.isSafeInteger(number)) fail('invalid_qr_frame', `${field} is invalid.`);
  return number;
}

function frameHeader(transferId, index, total, frameChecksum, payloadChecksum) {
  return `${NEARBY_QR_PREFIX}:${transferId}:${index.toString(36)}/${total.toString(36)}:${frameChecksum}:${payloadChecksum}:`;
}

export function createQrFrames(payload, {
  maxFrameChars = SIGNAL_LIMITS.defaultFrameChars,
} = {}) {
  if (typeof payload !== 'string' || !payload.length || payload.length > SIGNAL_LIMITS.maxWireChars) {
    fail('payload_too_large', 'Pairing data is empty or too large.');
  }
  if (!Number.isSafeInteger(maxFrameChars) || maxFrameChars < SIGNAL_LIMITS.minFrameChars || maxFrameChars > SIGNAL_LIMITS.maxFrameChars) {
    fail('invalid_frame_size', `QR frame size must be ${SIGNAL_LIMITS.minFrameChars}-${SIGNAL_LIMITS.maxFrameChars} characters.`);
  }
  const payloadChecksum = crcHex(payload);
  const transferId = `${payloadChecksum}-${payload.length.toString(36)}`;
  let total = 1;
  let chunkSize = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const headerLength = frameHeader(transferId, Math.max(0, total - 1), total, '00000000', payloadChecksum).length;
    chunkSize = maxFrameChars - headerLength;
    if (chunkSize < 32) fail('invalid_frame_size', 'QR frame has no room for pairing data.');
    const nextTotal = Math.ceil(payload.length / chunkSize);
    if (nextTotal === total) break;
    total = nextTotal;
  }
  if (total > SIGNAL_LIMITS.maxFrames) fail('too_many_frames', 'Pairing data needs too many QR frames.');
  const frames = [];
  for (let index = 0; index < total; index += 1) {
    const chunk = payload.slice(index * chunkSize, (index + 1) * chunkSize);
    const frame = `${frameHeader(transferId, index, total, crcHex(chunk), payloadChecksum)}${chunk}`;
    if (frame.length > maxFrameChars) fail('frame_overflow', 'QR frame exceeded its configured size.');
    frames.push(frame);
  }
  return Object.freeze(frames);
}

export function parseQrFrame(frame) {
  if (typeof frame !== 'string' || frame.length > SIGNAL_LIMITS.maxFrameChars) fail('invalid_qr_frame', 'QR frame is invalid or too large.');
  const match = QR_FRAME_RE.exec(frame);
  if (!match) fail('invalid_qr_frame', 'This QR code is not a valid Nearby Arcade pairing frame.');
  const [, transferId, rawIndex, rawTotal, frameChecksum, payloadChecksum, chunk] = match;
  const index = parseBase36(rawIndex, 'Frame number');
  const total = parseBase36(rawTotal, 'Frame total');
  if (total < 1 || total > SIGNAL_LIMITS.maxFrames || index < 0 || index >= total) fail('invalid_qr_frame', 'QR frame number is out of range.');
  if (crcHex(chunk) !== frameChecksum) fail('frame_checksum_mismatch', 'This QR frame is damaged.');
  const expectedTransferId = `${payloadChecksum}-`;
  if (!transferId.startsWith(expectedTransferId)) fail('invalid_qr_frame', 'QR transfer identifier is invalid.');
  return Object.freeze({ transferId, index, total, frameChecksum, payloadChecksum, chunk });
}

export class QrFrameCollector {
  constructor({ maxPayloadChars = SIGNAL_LIMITS.maxWireChars } = {}) {
    if (!Number.isSafeInteger(maxPayloadChars) || maxPayloadChars < 1 || maxPayloadChars > SIGNAL_LIMITS.maxWireChars) {
      fail('invalid_payload_limit', 'QR collector payload limit is invalid.');
    }
    this.maxPayloadChars = maxPayloadChars;
    this.reset();
  }

  reset() {
    this.transferId = null;
    this.payloadChecksum = null;
    this.total = 0;
    this.frames = new Map();
    this.receivedChars = 0;
    this.payload = null;
  }

  get progress() {
    return Object.freeze({ received: this.frames.size, total: this.total, complete: this.payload !== null });
  }

  add(rawFrame) {
    const frame = parseQrFrame(rawFrame);
    if (this.transferId === null) {
      this.transferId = frame.transferId;
      this.payloadChecksum = frame.payloadChecksum;
      this.total = frame.total;
    } else if (frame.transferId !== this.transferId || frame.payloadChecksum !== this.payloadChecksum || frame.total !== this.total) {
      fail('mixed_qr_transfers', 'This QR frame belongs to a different pairing code.');
    }
    const existing = this.frames.get(frame.index);
    if (existing !== undefined && existing !== frame.chunk) fail('conflicting_qr_frame', 'Two different QR frames claim the same position.');
    if (existing === undefined) {
      this.receivedChars += frame.chunk.length;
      if (this.receivedChars > this.maxPayloadChars) fail('payload_too_large', 'Pairing data is too large.');
      this.frames.set(frame.index, frame.chunk);
    }
    if (this.frames.size === this.total && this.payload === null) {
      let payload = '';
      for (let index = 0; index < this.total; index += 1) {
        const chunk = this.frames.get(index);
        if (chunk === undefined) fail('missing_qr_frame', 'A QR frame is missing.');
        payload += chunk;
      }
      if (crcHex(payload) !== this.payloadChecksum || this.transferId !== `${this.payloadChecksum}-${payload.length.toString(36)}`) {
        fail('payload_checksum_mismatch', 'The collected pairing code is damaged or incomplete.');
      }
      this.payload = payload;
    }
    return Object.freeze({ ...this.progress, payload: this.payload });
  }
}

export function reassembleQrFrames(frames, options) {
  if (!frames || typeof frames[Symbol.iterator] !== 'function') fail('invalid_qr_frames', 'QR frames must be iterable.');
  const collector = new QrFrameCollector(options);
  for (const frame of frames) collector.add(frame);
  if (collector.payload === null) fail('missing_qr_frame', 'Pairing QR sequence is incomplete.');
  return collector.payload;
}
