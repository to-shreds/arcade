import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pages = [
  ["chess", "../../../chess/index.html"],
  ["sorry", "../../../sorry/index.html"],
  ["monopoly", "../../../monopoly/index.html"],
  ["memory", "../../../memory/index.html"],
  ["tic-tac-toe", "../../../tic-tac-toe/index.html"],
  ["dots", "../../../dots/index.html"],
  ["checkers", "../../../checkers/index.html"],
  ["chat-room", "../../../chat-room/index.html"]
];

test("every supported game consumes the Arcade transport without inventing a Nearby mode", async () => {
  for (const [game, relative] of pages) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    const bridgeIndex = source.indexOf('<script src="../multiplayer/arcade-multiplayer.js"></script>');
    assert.ok(bridgeIndex >= 0, `${game} loads the shared bridge`);
    const firstWorkerUse = Math.min(...[source.indexOf("arcade-chess.jonathanjablon.workers.dev"), source.indexOf('src="room-client.js"')].filter((index) => index >= 0));
    assert.ok(!Number.isFinite(firstWorkerUse) || bridgeIndex < firstWorkerUse, `${game} loads the bridge before its networking client`);
    assert.match(source, /ArcadeMultiplayer\.goHome/, `${game} returns through the persistent shell`);
    assert.match(source, /ArcadeMultiplayer\.invite/, `${game} publishes a room invitation after creation`);
    assert.match(source, /Nearby Arcade · /, `${game} exposes read-only transport status`);
    assert.match(source, /params\.get\(["']room["']\).*params\.get\(["']join["']\).*params\.get\(["']code["']\)/s, `${game} accepts a conservative invitation code`);
    assert.doesNotMatch(source, /data-(?:play-)?mode=["']nearby["']|(?:Nearby|LAN|Wi-?Fi|WebRTC) (?:Match|Game|Mode)/i, `${game} has no separate Nearby game mode`);
  }
});

test("named multiplayer clients inherit the locked Arcade identity", async () => {
  for (const [game, relative] of pages.filter(([name]) => name !== "chess")) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /ArcadeMultiplayer\.preferredUsername/, `${game} uses the shell identity`);
    assert.match(source, /identity\.nickname/, `${game} shows the locked nickname`);
    assert.match(source, /\.hidden\s*=\s*!!identity|hidden=!!identity/, `${game} hides its nickname editor while Nearby is active`);
  }
});

test("visible setup labels stay transport-neutral and Chat alone keeps conditional Internet rename", async () => {
  const loaded = Object.fromEntries(await Promise.all(pages.map(async ([game, relative]) => [game, await readFile(new URL(relative, import.meta.url), "utf8")])));
  for (const game of ["chess", "sorry", "monopoly", "memory", "tic-tac-toe", "dots", "checkers"]){
    assert.match(loaded[game], /Multiplayer/i, `${game} calls the existing choice Multiplayer`);
  }
  assert.match(loaded["chat-room"], /renameBtn.*hidden=.*nearby|renameBtn[^\n]+nearby/s);
  assert.match(loaded["chat-room"], /if\(nearbyActive\(\)\).*return/);
});

test("saved rooms persist and restore their original authority before reconnecting", async () => {
  const direct = pages.filter(([game]) => !["memory", "tic-tac-toe"].includes(game));
  for (const [game, relative] of direct){
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /transport/, `${game} stores an authority marker with its room session`);
    assert.match(source, /pinSavedRoomTransport\([^)]*transport/, `${game} restores the saved authority before reconnecting`);
    assert.match(source, /ArcadeMultiplayer\.pinRoomTransport/, `${game} uses the validated bridge pin API`);
    assert.match(source, /ArcadeMultiplayer\.resetRoomTransport/, `${game} releases its pin after terminal room cleanup`);
    assert.match(source, /effectiveTransport/, `${game} labels the authority actually serving the active room`);
  }
  for (const [game, relative] of pages.filter(([name]) => ["memory", "tic-tac-toe"].includes(name))){
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /src="room-client\.js"/, `${game} loads the authority-aware shared client`);
    assert.match(source, /effectiveTransport/, `${game} labels the authority actually serving the active room`);
    const client = await readFile(new URL(`../../../${game}/room-client.js`, import.meta.url), "utf8");
    assert.match(client, /const\s+nextSession\s*=\s*\{[\s\S]*?\btransport\b[\s\S]*?\};/, `${game} builds an authority-bearing candidate session`);
    assert.match(client, /if\(!nextSession\.code[\s\S]*?throw new Error\([^;]+;[\s\S]*?session\s*=\s*nextSession;/, `${game} validates the candidate before accepting its room authority`);
    assert.match(client, /pinSavedRoomTransport\(prior\.transport\)/, `${game} pins before resume`);
    assert.match(client, /resetRoomTransport\(\)/, `${game} releases terminal room pins`);
  }
});
