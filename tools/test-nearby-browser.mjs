#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, browserLaunchOptions } from './browser-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'http://127.0.0.1:8792';
const server = spawn('python3', ['-m', 'http.server', '8792', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (attempt === 100) throw new Error('Nearby fixture failed to start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch(browserLaunchOptions);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
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
  console.log('Real Chromium WebRTC: pairing, locked identities, offline reaction/chat, canonical broadcasts, shared room create/join, and control transfer passed without Internet.');
  await Promise.all(pages.map(page => page.evaluate(() => testNearby.leave({ preserveCheckpoint: false }))));
} finally {
  await browser?.close();
  server.kill();
}
