import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(match => match[1]).find(source => source.includes('__LOGAN_ADVENTURE__'));
const context = vm.createContext({ console, Math, Date });
vm.runInContext(script, context);
const api = context.__LOGAN_ADVENTURE__;
const copy = value => JSON.parse(JSON.stringify(value));
const words = lines => lines.join(' ').trim().split(/\s+/).filter(Boolean).length;

function routeSave(runNumber, decisions = 30) {
  let state = api.freshState(api.testStoryPlan(runNumber));
  let nodeId = api.START_NODE;
  const history = [];
  for (let step = 0; step < decisions && !api.STORY[nodeId].ending; step++) {
    const node = api.STORY[nodeId];
    const choices = api.availableChoices(node, state);
    const index = (runNumber + step) % choices.length;
    const choice = choices[index];
    history.push({ nodeId, state: copy(state), pageAnchor: Math.max(0, Math.min(12, words(api.textLines(node, state)) - 1)) });
    api.applyEffect(state, choice.effect);
    const label = String(typeof choice.label === 'function' ? choice.label(state) : choice.label);
    // The public page uses readerText; ask its transition helper for the current wording.
    const transition = context.__LOGAN_CYOA_DEBUG__.transition(node, choice, history.at(-1).state);
    if (api.PRE_PROJECT_FINALS.includes(nodeId)) state.episodeOneOutcome = transition.state.episodeOneOutcome;
    if (api.POST_BUILD_FINALS.includes(nodeId)) state.episodeTwoOutcome = transition.state.episodeTwoOutcome;
    state.storyPath.push(`${nodeId}:${index}`);
    nodeId = api.connectedDestination(typeof choice.next === 'function' ? choice.next(state) : choice.next, state);
    assert.ok(label);
  }
  return { schema: 1, storyVersion: api.STORY_VERSION, savedAt: Date.now(), nodeId, state, history, pageAnchor: 0 };
}

test('exact run saves roundtrip across multiple recipes and complete routes', () => {
  for (let run = 1; run <= 48; run++) {
    for (const depth of [0, 1, 8, 17, 30]) {
      const save = routeSave(run, depth);
      assert.deepEqual(copy(api.validateProgress(copy(save))), copy(save), `run ${run}, depth ${depth}`);
    }
  }
});

test('corrupt saves, incompatible versions, forged inventory and altered Back histories are rejected', () => {
  const valid = routeSave(3, 17);
  const invalid = [null, {}, [], { ...valid, schema: 2 }, { ...valid, storyVersion: 'unknown-version' }, { ...valid, nodeId: 'missing' }, { ...valid, pageAnchor: -1 }, { ...valid, pageAnchor: 1000000 }, { ...valid, savedAt: Infinity }];
  const forged = copy(valid); forged.state.items.push('free tape'); invalid.push(forged);
  const brokenHistory = copy(valid); brokenHistory.history[4].state.clever += 1; invalid.push(brokenHistory);
  const unsafe = copy(valid); unsafe.state.director.connections.afterMission = '__proto__'; invalid.push(unsafe);
  const polluted = JSON.parse(JSON.stringify(valid).replace('"schema":1', '"schema":1,"__proto__":{"polluted":true}')); invalid.push(polluted);
  for (const save of invalid) assert.equal(api.validateProgress(save), null);
  assert.equal({}.polluted, undefined);
});

test('short pages preserve every word and never exceed seventy words without a DOM', () => {
  for (let run = 1; run <= 10; run++) {
    const save = routeSave(run);
    for (const snapshot of [...save.history, save]) {
      const lines = api.textLines(api.STORY[snapshot.nodeId], snapshot.state);
      const pages = api.paginateLines(lines);
      assert.equal(pages.flat().join(' ').replace(/\s+/g, ' ').trim(), lines.join(' ').replace(/\s+/g, ' ').trim());
      for (const page of pages) assert.ok(words(page) <= 70);
    }
  }
});
