import { NearbyProtocolError } from './protocol.mjs';

export const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 15_000;
export const DEFAULT_DATA_CHANNEL_LABEL = 'arcade-nearby-v1';

function fail(code, message, details) {
  throw new NearbyProtocolError(code, message, details);
}

function assertRtcConfig(rtcConfig) {
  if (rtcConfig == null) return { iceServers: [] };
  if (typeof rtcConfig !== 'object' || Array.isArray(rtcConfig)) fail('invalid_rtc_config', 'Nearby WebRTC configuration is invalid.');
  if (rtcConfig.iceServers && rtcConfig.iceServers.length) {
    fail('external_ice_server', 'Nearby Arcade does not use Internet STUN or TURN servers.');
  }
  return { ...rtcConfig, iceServers: [] };
}

export function createNearbyPeerConnection({
  RTCPeerConnection: PeerConnection = globalThis.RTCPeerConnection,
  rtcConfig,
} = {}) {
  if (typeof PeerConnection !== 'function') fail('webrtc_unavailable', 'This browser does not support Nearby Arcade connections.');
  return new PeerConnection(assertRtcConfig(rtcConfig));
}

function addListener(target, name, listener) {
  if (typeof target.addEventListener === 'function') {
    target.addEventListener(name, listener);
    return () => target.removeEventListener(name, listener);
  }
  const property = `on${name}`;
  const previous = target[property];
  target[property] = event => {
    if (typeof previous === 'function') previous.call(target, event);
    listener.call(target, event);
  };
  return () => {
    if (target[property] === listener || target[property]) target[property] = previous || null;
  };
}

export async function waitForIceGatheringComplete(peerConnection, {
  timeoutMs = DEFAULT_ICE_GATHERING_TIMEOUT_MS,
  signal,
} = {}) {
  if (!peerConnection || typeof peerConnection !== 'object') fail('invalid_peer_connection', 'WebRTC connection is missing.');
  if (peerConnection.iceGatheringState === 'complete') return peerConnection.localDescription;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) fail('invalid_timeout', 'ICE gathering timeout is invalid.');
  return new Promise((resolve, reject) => {
    let settled = false;
    let removeState = () => {};
    let removeCandidate = () => {};
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeState();
      removeCandidate();
      if (signal) signal.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve(peerConnection.localDescription);
    };
    const check = event => {
      if (peerConnection.iceGatheringState === 'complete' || (event && 'candidate' in event && event.candidate === null)) finish();
    };
    const aborted = () => finish(new DOMException('Pairing was cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(new NearbyProtocolError(
      'ice_gathering_timeout',
      "Couldn't finish the connection code. Make sure the device's Wi-Fi is on and try again.",
    )), timeoutMs);
    removeState = addListener(peerConnection, 'icegatheringstatechange', check);
    removeCandidate = addListener(peerConnection, 'icecandidate', check);
    if (signal) {
      if (signal.aborted) return aborted();
      signal.addEventListener('abort', aborted, { once: true });
    }
    check();
  });
}

function normalizeDescription(description, expectedType) {
  if (!description || description.type !== expectedType || typeof description.sdp !== 'string' || !description.sdp) {
    fail('invalid_local_description', `WebRTC did not create a valid ${expectedType}.`);
  }
  return assertHostOnlyDescription({ type: expectedType, sdp: description.sdp });
}

/**
 * Nearby pairing is deliberately LAN-only. A QR code is untrusted input, so
 * reject descriptions that contain server-reflexive or relay candidates before
 * they ever reach the browser's ICE implementation.
 */
export function assertHostOnlyDescription(description) {
  if (!description || !['offer', 'answer'].includes(description.type) || typeof description.sdp !== 'string' || !description.sdp) {
    fail('invalid_remote_description', 'The Nearby Arcade pairing code does not contain a valid connection description.');
  }
  const lines = description.sdp.split(/\r?\n/);
  const candidates = lines.filter(line => line.startsWith('a=candidate:'));
  if (!candidates.length) {
    fail('host_candidate_missing', "Couldn't find a local connection path. Make sure both devices have Wi-Fi on and try again.");
  }
  const safeCandidates = new Set();
  for (const candidate of candidates) {
    const fields = candidate.trim().split(/\s+/);
    const type = fields[6]?.toLowerCase() === 'typ' ? fields[7]?.toLowerCase() : null;
    const component = Number(fields[1]);
    const priority = Number(fields[3]);
    const address = fields[4] || '';
    const port = Number(fields[5]);
    if (type === 'host' && [1, 2].includes(component) && Number.isSafeInteger(priority) && priority >= 0 && Number.isSafeInteger(port) && port >= 1 && port <= 65535 && isLocalCandidateAddress(address)) safeCandidates.add(candidate);
  }
  if (!safeCandidates.size) {
    fail('non_local_candidate', 'This pairing code does not contain a safe local Wi-Fi address. Create a new Nearby Arcade code and try again.');
  }
  const newline = description.sdp.includes('\r\n') ? '\r\n' : '\n';
  const sdp = lines.filter(line => !line.startsWith('a=candidate:') || safeCandidates.has(line)).join(newline);
  return Object.freeze({ type: description.type, sdp });
}

export function isLocalCandidateAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  if (/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.local$/.test(address)) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some(part => part > 255)) return false;
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168);
  }
  if (address === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(address)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(address)) return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  return mapped ? isLocalCandidateAddress(mapped[1]) : false;
}

export async function createLocalOffer({
  peerConnection,
  RTCPeerConnection,
  rtcConfig,
  dataChannelLabel = DEFAULT_DATA_CHANNEL_LABEL,
  dataChannelOptions = { ordered: true },
  timeoutMs,
  signal,
} = {}) {
  const peer = peerConnection || createNearbyPeerConnection({ RTCPeerConnection, rtcConfig });
  if (typeof peer.createDataChannel !== 'function') fail('webrtc_unavailable', 'WebRTC data channels are unavailable.');
  const dataChannel = peer.createDataChannel(dataChannelLabel, dataChannelOptions);
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGatheringComplete(peer, { timeoutMs, signal });
    return Object.freeze({
      peerConnection: peer,
      dataChannel,
      description: normalizeDescription(peer.localDescription, 'offer'),
    });
  } catch (error) {
    if (!peerConnection && typeof peer.close === 'function') peer.close();
    throw error;
  }
}

export async function createLocalAnswer({
  remoteDescription,
  peerConnection,
  RTCPeerConnection,
  rtcConfig,
  timeoutMs,
  signal,
} = {}) {
  if (!remoteDescription || remoteDescription.type !== 'offer' || typeof remoteDescription.sdp !== 'string' || !remoteDescription.sdp) {
    fail('invalid_remote_description', 'The Nearby Arcade invitation does not contain a valid offer.');
  }
  const checkedRemoteDescription = assertHostOnlyDescription(remoteDescription);
  const peer = peerConnection || createNearbyPeerConnection({ RTCPeerConnection, rtcConfig });
  try {
    await peer.setRemoteDescription(checkedRemoteDescription);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await waitForIceGatheringComplete(peer, { timeoutMs, signal });
    return Object.freeze({
      peerConnection: peer,
      description: normalizeDescription(peer.localDescription, 'answer'),
    });
  } catch (error) {
    if (!peerConnection && typeof peer.close === 'function') peer.close();
    throw error;
  }
}

export async function applyRemoteAnswer(peerConnection, remoteDescription) {
  if (!peerConnection || typeof peerConnection.setRemoteDescription !== 'function') fail('invalid_peer_connection', 'WebRTC connection is missing.');
  if (!remoteDescription || remoteDescription.type !== 'answer' || typeof remoteDescription.sdp !== 'string' || !remoteDescription.sdp) {
    fail('invalid_remote_description', 'The Nearby Arcade response does not contain a valid answer.');
  }
  await peerConnection.setRemoteDescription(assertHostOnlyDescription(remoteDescription));
  return peerConnection;
}

export function descriptionHasHostCandidate(description) {
  return Boolean(description && typeof description.sdp === 'string' && /(?:^|\r?\n)a=candidate:[^\r\n]+\styp\shost(?:\s|$)/m.test(description.sdp));
}
