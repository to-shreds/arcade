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
const activityChecks = [];
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
  await writeFile(evidencePath, JSON.stringify({ result, failure, errors, activityChecks, peers }, null, 2) + '\n');
}
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (attempt === 100) throw new Error('Nearby fixture failed to start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch(browserLaunchOptions);
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
      // Automated same-machine RPCs can arrive faster than the unchanged
      // production 12 ms limiter. Pace every synthetic request realistically.
      window.requestTestRoomRpc = async (operation, payload) => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return testNearby.requestRoomRpc(operation, payload);
      };
      window.nearbyEvents = [];
      const markPeerLost = testNearby._markPeerLost;
      testNearby._markPeerLost = function(record, side, reason) {
        nearbyEvents.push({ type: 'peer-lost', detail: {
          side, reason, status: record.status,
          connectionState: record.pc.connectionState,
          iceConnectionState: record.pc.iceConnectionState,
          channelState: record.channel?.readyState ?? null
        } });
        return markPeerLost.call(this, record, side, reason);
      };
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
  // Load the real activities before disabling Internet access. Their accepted
  // UI checkpoints then travel through the paired DataChannel and are restored
  // by the same adapters used by shared play and local saves.
  const activityPages = [];
  const selectedActivities = (process.env.NEARBY_SHARED_GAMES || 'train-trouble,robot-workshop').split(',');
  assert.ok(selectedActivities.length && selectedActivities.every(id => ['train-trouble', 'robot-workshop'].includes(id)));
  for (const activity of selectedActivities) {
    const [sender, receiver] = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of [sender, receiver]) {
      page.on('pageerror', error => errors.push(`${activity}: ${error.message}`));
      await page.goto(`${base}/${activity}/`);
      await page.waitForFunction(() => !!window.ArcadeSave?.getAdapter?.());
    }
    if (activity === 'train-trouble') {
      await sender.locator('#campaignBtn').click(); await sender.locator('#job-0').click();
      await sender.locator('#hintBtn').click(); await sender.locator('#send-t1').click();
      await sender.evaluate(() => TrainTrouble.setPaused(true));
    } else {
      await sender.locator('#startCampaign').click();
      await sender.locator('.port[data-node="A"][data-kind="out"]').click();
      await sender.locator('.port[data-node="O0"][data-port="0"][data-kind="in"]').click();
    }
    const snapshot = await sender.evaluate(() => ArcadeSave.getAdapter().capture());
    activityPages.push({ activity, sender, receiver, snapshot });
  }
  await Promise.all(contexts.map(context => context.setOffline(true)));
  assert.equal(await host.evaluate(() => testNearby.sendReaction('🎉')), true);
  await guest.waitForFunction(() => reactions.some(value => value.reaction === '🎉'));
  const created = await host.evaluate(() => requestTestRoomRpc('http', { path: '/api/arcade/rooms', method: 'POST', body: JSON.stringify({ game: 'chat', username: 'spoof host', maxPlayers: 2 }) }));
  assert.equal(created.status, 200);
  assert.equal(created.body.room.members[0].username, 'Host Test');
  const joined = await guest.evaluate(code => requestTestRoomRpc('http', { path: `/api/arcade/rooms/${code}/join`, method: 'POST', body: JSON.stringify({ username: 'spoof guest' }) }), created.body.code);
  assert.equal(joined.status, 200);
  assert.equal(joined.body.room.members.find(member => member.playerId === joined.body.playerId).username, 'Guest Test');
  for (const [index, page] of pages.entries()) {
    const token = index ? joined.body.token : created.body.token;
    const socket = await page.evaluate(value => requestTestRoomRpc('ws-open', { path: `/api/arcade/rooms/${value.code}/ws?token=${value.token}`, socketId: value.socketId }), { code: created.body.code, token, socketId: `browser-test-${index}` });
    assert.equal(socket.ok, true);
  }
  const message = await guest.evaluate(code => requestTestRoomRpc('http', { path: `/api/arcade/rooms/${code}/actions`, method: 'POST', body: JSON.stringify({ type: 'chat', text: 'Offline peer message' }) }), created.body.code);
  assert.equal(message.status, 200);
  await host.waitForFunction(() => socketMessages.some(value => value.room?.chat?.some(message => message.text === 'Offline peer message')));
  await guest.waitForFunction(() => socketMessages.some(value => value.room?.chat?.some(message => message.text === 'Offline peer message')));
  const shared = await host.evaluate(() => {
    const data = JSON.stringify({ snapshot: { text: 'Before' }, view: [], frames: [] });
    return requestTestRoomRpc('http', { path: '/api/arcade/rooms', method: 'POST', body: JSON.stringify({ game: 'shared-activity', maxPlayers: 2, state: { schema: 1, activity: 'typing', codec: 'json', data, decodedBytes: new TextEncoder().encode(data).length, sequence: 1 } }) });
  });
  assert.equal(shared.status, 200);
  const started = await host.evaluate(body => requestTestRoomRpc('http', { path: `/api/arcade/rooms/${body.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'start', expectedVersion: body.room.version, firstSeat: body.seat, state: body.room.state }) }), shared.body);
  assert.equal(started.status, 200);
  const sharedGuest = await guest.evaluate(code => requestTestRoomRpc('http', { path: `/api/arcade/rooms/${code}/join`, method: 'POST', body: '{}' }), shared.body.code);
  assert.equal(sharedGuest.status, 200);
  for (const [index, page] of pages.entries()) {
    const token = index ? sharedGuest.body.token : shared.body.token;
    const socket = await page.evaluate(value => requestTestRoomRpc('ws-open', { path: `/api/arcade/rooms/${value.code}/ws?token=${value.token}`, socketId: value.socketId }), { code: shared.body.code, token, socketId: `shared-browser-test-${index}` });
    assert.equal(socket.ok, true);
  }
  const passed = await host.evaluate(body => requestTestRoomRpc('http', { path: `/api/arcade/rooms/${body.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'state', expectedVersion: body.room.version, state: body.room.state, nextSeat: body.seat }) }), sharedGuest.body);
  assert.equal(passed.status, 200);
  assert.equal(passed.body.room.turn.playerId, sharedGuest.body.playerId);
  await Promise.all(pages.map(page => page.waitForFunction(value => socketMessages.some(message => message.room?.code === value.code && message.room?.turn?.playerId === value.playerId), { code: shared.body.code, playerId: sharedGuest.body.playerId })));
  const updated = await guest.evaluate(body => {
    const data = JSON.stringify({ snapshot: { text: 'After guest move' }, view: [], frames: [] });
    const state = { ...body.room.state, data, decodedBytes: new TextEncoder().encode(data).length, sequence: body.room.state.sequence + 1 };
    return requestTestRoomRpc('http', { path: `/api/arcade/rooms/${body.room.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'state', expectedVersion: body.room.version, state }) });
  }, passed.body);
  assert.equal(updated.status, 200);
  await Promise.all(pages.map(page => page.waitForFunction(value => socketMessages.some(message => message.room?.code === value.code && message.room?.version === value.version && JSON.parse(message.room.state.data).snapshot.text === 'After guest move'), { code: shared.body.code, version: updated.body.room.version })));
  for (const { activity, sender, receiver, snapshot } of activityPages) {
    const state = (() => {
      const data = JSON.stringify({ snapshot, view: [], frames: [] });
      return { schema: 1, activity, codec: 'json', data, decodedBytes: Buffer.byteLength(data), sequence: 1 };
    })();
    const created = await host.evaluate(state => requestTestRoomRpc('http', { path: '/api/arcade/rooms', method: 'POST', body: JSON.stringify({ game: 'shared-activity', maxPlayers: 2, state }) }), state);
    assert.equal(created.status, 200, activity + ' creates an offline room');
    const started = await host.evaluate(body => requestTestRoomRpc('http', { path: `/api/arcade/rooms/${body.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'start', expectedVersion: body.room.version, state: body.room.state }) }), created.body);
    assert.equal(started.status, 200);
    const joined = await guest.evaluate(({ code, activity }) => requestTestRoomRpc('http', { path: `/api/arcade/rooms/${code}/join`, method: 'POST', body: JSON.stringify({ activity }) }), { code: created.body.code, activity });
    assert.equal(joined.status, 200);
    for (const [index, page] of pages.entries()) {
      const token = index ? joined.body.token : created.body.token;
      const opened = await page.evaluate(value => requestTestRoomRpc('ws-open', { path: `/api/arcade/rooms/${value.code}/ws?token=${value.token}`, socketId: value.socketId }), { code: created.body.code, token, socketId: `${activity}-rtc-${index}` });
      assert.equal(opened.ok, true);
    }
    const passed = await host.evaluate(body => requestTestRoomRpc('http', { path: `/api/arcade/rooms/${body.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'state', expectedVersion: body.room.version, state: body.room.state, nextSeat: body.seat }) }), joined.body);
    assert.equal(passed.status, 200);
    assert.equal(passed.body.room.turn.playerId, joined.body.playerId);
    const initial = JSON.parse(passed.body.room.state.data).snapshot;
    assert.deepEqual(initial, snapshot, activity + ' passes its exact started checkpoint');
    assert.notEqual(await receiver.evaluate(saved => ArcadeSave.getAdapter().restore(saved, { spectator: false, controller: true, online: true }), initial), false);
    assert.deepEqual(await receiver.evaluate(() => ArcadeSave.getAdapter().capture()), initial, activity + ' restores the new controller without resetting');
    if (activity === 'train-trouble') await receiver.locator('#signalBtn').click();
    else await receiver.locator('#runBtn').click();
    const changed = await receiver.evaluate(() => ArcadeSave.getAdapter().capture());
    assert.notDeepEqual(changed, initial, activity + ' accepts a real new-controller action');
    const advanced = await guest.evaluate(({ room, snapshot }) => {
      const data = JSON.stringify({ snapshot, view: [], frames: [] });
      const state = { ...room.state, data, decodedBytes: new TextEncoder().encode(data).length, sequence: room.state.sequence + 1 };
      return requestTestRoomRpc('http', { path: `/api/arcade/rooms/${room.code}/actions`, method: 'POST', body: JSON.stringify({ type: 'state', expectedVersion: room.version, state }) });
    }, { room: passed.body.room, snapshot: changed });
    assert.equal(advanced.status, 200);
    await Promise.all(pages.map(page => page.waitForFunction(({ code, version }) => socketMessages.some(message => message.room?.code === code && message.room?.version === version), { code: created.body.code, version: advanced.body.room.version })));
    assert.deepEqual(JSON.parse(advanced.body.room.state.data).snapshot, changed);
    assert.notEqual(await sender.evaluate(saved => ArcadeSave.getAdapter().restore(saved, { spectator: true, controller: false, online: true }), changed), false);
    assert.deepEqual(await sender.evaluate(() => ArcadeSave.getAdapter().capture()), changed, activity + ' restores the observer from the accepted checkpoint');
    activityChecks.push({ activity, passed: true, checkpointBytes: state.decodedBytes, sequence: advanced.body.room.state.sequence });
    await sender.close(); await receiver.close();
  }
  for (const page of pages) assert.equal(await page.evaluate(() => testNearby.snapshot().connected), 2, 'the paired players stay connected throughout offline moves and control transfer');
  assert.deepEqual(errors, []);
  await writeEvidence('passed');
  console.log('Real Chromium WebRTC: pairing, locked identities, offline reaction/chat, canonical broadcasts, shared room create/join, control transfer, synchronized guest moves, and ' + activityChecks.length + ' real activity adapter round-trips passed without Internet.');
  await Promise.all(pages.map(page => page.evaluate(() => testNearby.leave({ preserveCheckpoint: false }))));
} catch (error) {
  await writeEvidence('failed', error.stack || error.message).catch(evidenceError => console.error('Nearby evidence could not be saved:', evidenceError.message));
  console.error(`Nearby RTC evidence: ${evidencePath}`);
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
