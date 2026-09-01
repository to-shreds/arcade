/**
 * Shared, environment-neutral constants and validation for Nearby Arcade.
 * This module deliberately has no DOM, Worker, or Android dependencies.
 */

export const NEARBY_PROTOCOL_ID = 'arcade-nearby';
export const NEARBY_PROTOCOL_VERSION = 1;
export const NEARBY_WIRE_PREFIX = 'AN1';
export const NEARBY_QR_PREFIX = 'ANQ1';

export const SIGNAL_LIMITS = Object.freeze({
  maxSdpBytes: 64 * 1024,
  maxDecodedBytes: 96 * 1024,
  maxWireChars: 128 * 1024,
  maxFrames: 96,
  defaultFrameChars: 1200,
  minFrameChars: 220,
  maxFrameChars: 2200,
  defaultTtlMs: 3 * 60 * 1000,
  maxTtlMs: 10 * 60 * 1000,
  clockSkewMs: 60 * 1000,
});

export const MESSAGE_LIMITS = Object.freeze({
  maxBytes: 128 * 1024,
  maxTypeChars: 48,
  maxIdChars: 96,
});

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const MESSAGE_TYPE_RE = /^[a-z][a-z0-9._-]*$/;

export class NearbyProtocolError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'NearbyProtocolError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new NearbyProtocolError(code, message, details);
}

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function utf8ByteLength(value) {
  if (typeof value !== 'string') return 0;
  return new TextEncoder().encode(value).byteLength;
}

export function assertSafeId(value, field = 'id', { min = 8, max = MESSAGE_LIMITS.maxIdChars } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || !SAFE_ID_RE.test(value)) {
    fail('invalid_id', `${field} must be ${min}-${max} URL-safe characters.`);
  }
  return value;
}

export function assertPairingToken(value, field = 'pairingToken') {
  if (typeof value !== 'string' || value.length < 22 || value.length > 64 || !BASE64URL_RE.test(value)) {
    fail('invalid_pairing_token', `${field} must contain at least 128 bits of URL-safe random data.`);
  }
  return value;
}

export function randomBytes(length = 16, cryptoImpl = globalThis.crypto) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 1024) {
    fail('invalid_random_length', 'Random byte length is out of range.');
  }
  if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') {
    fail('crypto_unavailable', 'Secure random values are unavailable in this browser.');
  }
  const bytes = new Uint8Array(length);
  cryptoImpl.getRandomValues(bytes);
  return bytes;
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64UrlEncode(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const a = bytes[offset];
    const hasB = offset + 1 < bytes.length;
    const hasC = offset + 2 < bytes.length;
    const b = hasB ? bytes[offset + 1] : 0;
    const c = hasC ? bytes[offset + 2] : 0;
    result += BASE64URL_ALPHABET[a >> 2];
    result += BASE64URL_ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (hasB) result += BASE64URL_ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (hasC) result += BASE64URL_ALPHABET[c & 63];
  }
  return result;
}

export function base64UrlDecode(value, { maxBytes = SIGNAL_LIMITS.maxDecodedBytes } = {}) {
  if (typeof value !== 'string' || !value.length || !BASE64URL_RE.test(value) || value.length % 4 === 1) {
    fail('invalid_base64url', 'Pairing data is not valid URL-safe encoding.');
  }
  const estimatedBytes = Math.floor((value.length * 3) / 4);
  if (estimatedBytes > maxBytes) fail('payload_too_large', 'Pairing data is too large.');
  const output = new Uint8Array(estimatedBytes);
  let out = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    const remaining = Math.min(4, value.length - offset);
    let block = 0;
    for (let index = 0; index < 4; index += 1) {
      const code = index < remaining ? BASE64URL_ALPHABET.indexOf(value[offset + index]) : 0;
      if (code < 0) fail('invalid_base64url', 'Pairing data is not valid URL-safe encoding.');
      block = (block << 6) | code;
    }
    output[out++] = (block >>> 16) & 255;
    if (remaining > 2) output[out++] = (block >>> 8) & 255;
    if (remaining > 3) output[out++] = block & 255;
  }
  return output.subarray(0, out);
}

export function randomUrlSafeId(byteLength = 16, cryptoImpl = globalThis.crypto) {
  return base64UrlEncode(randomBytes(byteLength, cryptoImpl));
}

export function createPairingCredentials({
  guestOrdinal = 1,
  now = Date.now(),
  ttlMs = SIGNAL_LIMITS.defaultTtlMs,
  cryptoImpl = globalThis.crypto,
} = {}) {
  if (!Number.isSafeInteger(guestOrdinal) || guestOrdinal < 1 || guestOrdinal > 999) {
    fail('invalid_guest_ordinal', 'Guest number must be between 1 and 999.');
  }
  if (!Number.isSafeInteger(now) || now < 0) fail('invalid_time', 'Pairing creation time is invalid.');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 10_000 || ttlMs > SIGNAL_LIMITS.maxTtlMs) {
    fail('invalid_ttl', 'Pairing lifetime is out of range.');
  }
  return Object.freeze({
    pairingId: `p${guestOrdinal}_${randomUrlSafeId(12, cryptoImpl)}`,
    pairingToken: randomUrlSafeId(24, cryptoImpl),
    createdAt: now,
    expiresAt: now + ttlMs,
  });
}

export function validateProtocolVersion(protocol, version) {
  if (protocol !== NEARBY_PROTOCOL_ID) {
    fail('protocol_mismatch', 'This pairing code is not for Nearby Arcade.');
  }
  if (version !== NEARBY_PROTOCOL_VERSION) {
    fail('version_mismatch', 'These devices have different Arcade versions. Update both devices and try again.', {
      expected: NEARBY_PROTOCOL_VERSION,
      received: version,
    });
  }
}

export function validatePairingWindow({ createdAt, expiresAt }, now = Date.now()) {
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) {
    fail('invalid_expiry', 'Pairing timing information is invalid.');
  }
  if (expiresAt - createdAt > SIGNAL_LIMITS.maxTtlMs) {
    fail('invalid_expiry', 'Pairing code lifetime is too long.');
  }
  if (createdAt > now + SIGNAL_LIMITS.clockSkewMs) {
    fail('created_in_future', 'The devices disagree about the current time.');
  }
  if (expiresAt < now - SIGNAL_LIMITS.clockSkewMs) {
    fail('pairing_expired', 'This pairing code has expired. Create a new code and try again.');
  }
  return true;
}

function encodedJsonSize(value) {
  try {
    return utf8ByteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Validate the common Nearby data-channel envelope. Game payload validators remain
 * responsible for validating `body`; this guard only permits bounded JSON data.
 */
export function validateNearbyMessage(value, {
  allowedTypes,
  maxBytes = MESSAGE_LIMITS.maxBytes,
} = {}) {
  if (!isPlainObject(value)) fail('invalid_message', 'Nearby message must be an object.');
  validateProtocolVersion(value.protocol, value.version);
  if (typeof value.type !== 'string' || value.type.length > MESSAGE_LIMITS.maxTypeChars || !MESSAGE_TYPE_RE.test(value.type)) {
    fail('invalid_message_type', 'Nearby message type is invalid.');
  }
  if (allowedTypes && !allowedTypes.includes(value.type)) {
    fail('unexpected_message_type', 'Nearby message type is not allowed here.');
  }
  assertSafeId(value.messageId, 'messageId');
  if (!Number.isSafeInteger(value.sentAt) || value.sentAt < 0) fail('invalid_message_time', 'Nearby message time is invalid.');
  if (encodedJsonSize(value) > maxBytes) fail('message_too_large', 'Nearby message is too large.');
  return value;
}

export function makeNearbyEnvelope(type, body, {
  messageId = randomUrlSafeId(12),
  sentAt = Date.now(),
} = {}) {
  const envelope = {
    protocol: NEARBY_PROTOCOL_ID,
    version: NEARBY_PROTOCOL_VERSION,
    type,
    messageId,
    sentAt,
    body,
  };
  return validateNearbyMessage(envelope);
}
