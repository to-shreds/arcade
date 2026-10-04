#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'http://127.0.0.1:8792';
const server = spawn('python3', ['-m', 'http.server', '8792', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
let browser;
let pages = [];
const errors = [];
const evidencePath = join(root, 'test-results/nearby-browser/report.json');
async function writeEvidence(result, failure = null) {
  const peers = await Promise.all(pages.map(async page => {
    try {
      return await page.evaluate(async () => {
        const describe = async record => {
          if (!record) return null;
          const stats = await record.pc.getStats().catch(() => null);
          return {
            status: record.status,
            connectionState: record.pc.connectionState,
            iceConnectionState: record.pc.iceConnectionState,
            iceGatheringState: record.pc.iceGatheringState,
            signalingState: record.pc.signalingState,
            channelState: record.channel?.readyState ?? null,
            // Candidate addresses are useful CI diagnostics; SDP credentials
            // and the one-use pairing token must never enter the report.
            candidates: [...(stats?.values() ?? [])].filter(value => ['local-candidate', 'remote-candidate', 'candidate-pair', 'transport', 'data-channel'].includes(value.type)).map(value => ({
              type: value.type, state: value.state, candidateType: value.candidateType,
              address: value.address, protocol: value.protocol, port: value.port,
              nominated: value.nominated, dtlsState: value.dtlsState,
              bytesSent: value.bytesSent, bytesReceived: value.bytesReceived,
              messagesSent: value.messagesSent, messagesReceived: value.messagesReceived
            }))
          };
        };
        return {
          nickname: window.testNickname,
          snapshot: window.testNearby?.snapshot(),
          events: window.nearbyEvents ?? [],
          hostPeer: await describe(window.testNearby?.hostPeer),
          peers: await Promise.all([...(window.testNearby?.peers?.values() ?? [])].map(describe))
        };
      });
    } catch (error) { return { error: error.message }; }
  }));
  await mkdir(join(root, 'test-results/nearby-browser'), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({ result, failure, errors, peers }, null, 2) + '\n');
}
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (attempt === 100) throw new Error('Nearby fixture failed to start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Isolated CI contexts can lack multicast DNS discovery. Use Chromium's
  // literal local ICE addresses while still testing real, host-only
  // RTCPeerConnections without STUN/TURN or a mocked transport.
  browser = await chromium.launch({ ...browserLaunchOptions, args: [...browserLaunchOptions.args, '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  pages = await Promise.all(contexts.map(context => context.newPage()));
  for (const [index, page] of pages.entries()) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.evaluate(async nickname => {
      const [{ NearbyArcadeSession }, { MemoryNearbyStorage }, protocol, signaling, webrtc, { NearbyRoomService }] = await Promise.all([
        import('/multiplayer/nearby-session.mjs'), import('/multiplayer/nearby-storage.mjs'), import('/multiplayer/protocol.mjs'),
        import('/multiplayer/signaling.mjs'), import('/multiplayer/webrtc.mjs'), import('/multiplayer/nearby-room-service.js')
      ]);
      window.testNearby = new NearbyArcadeSession({ storage: new MemoryNearbyStorage() });
      testNearby.configureSignaling({ ...protocol, ...signaling, ...webrtc });
      window.reactions = [];
      window.socketMessages = [];
      window.nearbyEvents = [];
      for (const type of ['error', 'state', 'connected', 'player-joined']) testNearby.on(type, detail => {
        nearbyEvents.push({ type, detail });
        if (nearbyEvents.length > 80) nearbyEvents.shift();
      });
      testNearby.on('reaction', reaction => reactions.push(reaction));
      testNearby.on('socket-message', message => socketMessages.push(JSON.parse(message.data)));
      await testNearby.initialize();
      window.testNickname = nickname;
      window.testService = new NearbyRoomService({ onEvent: event => {
        if (event.type === 'socket-message') testNearby.sendSocketMessage(event.targetMemberId, event.socketId, event.data);
        if (event.type === 'socket-close') testNearby.closeSocket(event.targetMemberId, event.socketId, event);
      } });
      testNearby.setRpcHandler(async ({ member, operation, payload }) => {
        await testService.registerMember({ ...member, connected: true });
        if (operation === 'http') return testService.handleHttp(member.memberId, payload);
        if (operation === 'ws-open') return testService.openSocket(member.memberId, payload);
        if (operation === 'ws-send') return testService.sendSocket(member.memberId, payload);
        return testService.closeSocket(member.memberId, payload);
      });
    }, index ? 'Guest Test' : 'Host Test');
  }
  const [host, guest] = pages;
  await host.evaluate(() => testNearby.startHost({ nickname: testNickname, avatar: '🎮' }));
  const invitation = await host.evaluate(() => testNearby.createHostInvitation());
  const response = await guest.evaluate(wire => testNearby.joinFromInvitation({ nickname: testNickname, avatar: '🚀' }, wire), invitation.wire);
  await host.evaluate(value => testNearby.acceptGuestResponse(value.wire, value.pairingId), response);
  await Promise.all(pages.map(page => page.waitForFunction(() => testNearby.snapshot().connected === 2, null, { timeout: 20000 })));
  for (const page of pages) {
    const state = await page.evaluate(() => {
      const record = testNearby.hostPeer || [...testNearby.peers.values()][0];
      return { connection: record.pc.connectionState, channel: record.channel.readyState };
    });
    assert.deepEqual(state, { connection: 'connected', channel: 'open' });
  }
  await Promise.all(contexts.map(context => context.setOffline(true)));
  assert.equal(await host.evaluate(() => testNearby.sendReaction('🎉')), true);
  await guest.waitForFunction(() => reactions.some(value => value.reaction === '🎉'));
  const created = await host.evaluate(() => testNearby.requestRoomRpc('http', { path: '/api/arcade/rooms', method: 'POST', body: JSON.stringify({ game: 'chat', username: 'spoof host', maxPlayers: 2 }) }));
  assert.equal(created.status, 200);
  assert.equal(created.body.room.members[0].username, 'Host Test');
  const joined = await guest.evaluate(code => testNearby.requestRoomRpc('http', { path: `/api/arcade/rooms/${code}/join`, method: 'POST', body: JSON.stringify({ username: 'spoof guest' }) }), created.body.code);
  assert.equal(joined.status, 200);
  assert.equal(joined.body.room.members.find(member => member.playerId === joined.body.playerId).username, 'Guest Test');
  for (const [index, page] of pages.entries()) {
    const token = index ? joined.body.token : created.body.token;
    const socket = await page.evaluate(value => testNearby.requestRoomRpc('ws-open', { path: `/api/arcade/rooms/${value.code}/ws?token=${value.token}`, socketId: value.socketId }), { code: created.body.code, token, socketId: `browser-test-${index}` });
    assert.equal(socket.ok, true);
  }
  const message = await guest.evaluate(code => testNearby.requestRoomRpc('http', { path: `/api/arcade/rooms/${code}/actions`, method: 'POST', body: JSON.stringify({ type: 'chat', text: 'Offline peer message' }) }), created.body.code);
  assert.equal(message.status, 200);
  await host.waitForFunction(() => socketMessages.some(value => value.room?.chat?.some(message => message.text === 'Offline peer message')));
  await guest.waitForFunction(() => socketMessages.some(value => value.room?.chat?.some(message => message.text === 'Offline peer message')));
  const shared = await host.evaluate(() => {
    const data = JSON.stringify({ snapshot: { text: 'Before' }, view: [], frames: [] });
    return testNearby.requestRoomRpc('http', { path: '/api/arcade/rooms', method: 'POST', body: JSON.stringify({ game: 'shared-activity', maxPlayers: 2, state: { schema: 1, activity: 'typing', codec: 'json', data, decodedBytes: new TextEncoder().encode(data).length, sequence: 1 } }) });
  });
  assert.equal(shared.status, 200);
  const started = await host.evaluate(body => testNearby.requestRoomRpc('http', { path: `/api/arcade/rooms/${body.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'start', expectedVersion: body.room.version, firstSeat: body.seat, state: body.room.state }) }), shared.body);
  assert.equal(started.status, 200);
  const sharedGuest = await guest.evaluate(code => testNearby.requestRoomRpc('http', { path: `/api/arcade/rooms/${code}/join`, method: 'POST', body: '{}' }), shared.body.code);
  assert.equal(sharedGuest.status, 200);
  const passed = await host.evaluate(body => testNearby.requestRoomRpc('http', { path: `/api/arcade/rooms/${body.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'state', expectedVersion: body.room.version, state: body.room.state, nextSeat: body.seat }) }), sharedGuest.body);
  assert.equal(passed.status, 200);
  assert.equal(passed.body.room.turn.playerId, sharedGuest.body.playerId);
  assert.deepEqual(errors, []);
  await writeEvidence('passed');
  console.log('Real Chromium WebRTC: pairing, locked identities, offline reaction/chat, canonical broadcasts, shared room create/join, and control transfer passed without Internet.');
  await Promise.all(pages.map(page => page.evaluate(() => testNearby.leave({ preserveCheckpoint: false }))));
} catch (error) {
  await writeEvidence('failed', error.stack || error.message).catch(evidenceError => console.error('Nearby evidence could not be saved:', evidenceError.message));
  console.error(`Nearby RTC evidence: ${evidencePath}`);
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
