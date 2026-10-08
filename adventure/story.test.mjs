import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const storyScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
  .map(match => match[1])
  .find(source => source.includes('__LOGAN_ADVENTURE__'));
assert.ok(storyScript, 'The canonical Adventure page must expose its story engine.');
const context = vm.createContext({ console, Math, Date });
vm.runInContext(storyScript, context, { filename: 'adventure/index.html' });
const api = context.__LOGAN_ADVENTURE__;
const debug = context.__LOGAN_CYOA_DEBUG__;
assert.ok(api && debug, 'The story and transition APIs must be available without a DOM.');

const labelOf = (choice, state) => String(typeof choice.label === 'function' ? choice.label(state) : choice.label);
const hasEarlierAnswer = state => state.callbacks.some(value =>
  value === "Scarlett's chosen color" || value === "Scarlett's tiny jewel idea");
let sampleResult;

function sampledRoutes() {
  if (sampleResult) return sampleResult;
  const result = { visited: new Set(), endings: new Set(), snapshots: {}, completed: 0 };
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let run = 0; run < 5000; run += 1) {
    let state = api.freshState(api.testStoryPlan(run + 1));
    let id = api.START_NODE;
    const path = [];
    let ended = false;
    for (let step = 0; step < 64; step += 1) {
      const node = api.STORY[id];
      const trace = () => `Run ${run + 1}: ${[...path, id].join(' -> ')}`;
      assert.ok(node, `Every transition must name an existing scene. ${trace()}`);
      result.visited.add(id);
      const lines = api.textLines(node, state);
      assert.ok(Array.isArray(lines) && lines.length > 0, `Every scene needs readable text. ${trace()}`);
      for (const line of lines) {
        assert.equal(typeof line, 'string', `Scene text must resolve to a string. ${trace()}`);
        assert.ok(line.trim(), `Scene text must not be empty. ${trace()}`);
        assert.doesNotMatch(line, /\b(?:undefined|NaN)\b/, `A saved choice must not leave missing values in prose. ${trace()}`);
      }
      if (node.ending) {
        assert.equal(api.availableChoices(node, state).length, 0, `An ending must finish the route. ${trace()}`);
        result.endings.add(id);
        result.completed += 1;
        ended = true;
        break;
      }
      const choices = api.availableChoices(node, state);
      assert.ok(choices.length > 0, `A non-ending scene must have an available choice. ${trace()}`);
      for (const choice of choices) {
        assert.ok(labelOf(choice, state).trim(), `Every available choice needs a label. ${trace()}`);
      }
      if (id === 'response_help' && !state.hasTape) result.snapshots.ribbon ??= state;
      if (id === 'response_help' && !state.hasAcorn) result.snapshots.button ??= state;
      if (id === 'late_crisis_portrait' && !hasEarlierAnswer(state)) result.snapshots.portraitWithoutAnswer ??= state;
      if (id === 'late_crisis_treasure' && !hasEarlierAnswer(state)) result.snapshots.treasureWithoutAnswer ??= state;
      if (id === 'side_shoe_radio_3') result.snapshots.radioFinal ??= state;
      const choice = choices[Math.floor(random() * choices.length)];
      path.push(`${id}:${labelOf(choice, state)}`);
      const transition = debug.transition(node, choice, state);
      state = transition.state;
      id = transition.nextId;
    }
    assert.ok(ended, `Run ${run + 1} must reach an ending without a loop.`);
  }
  sampleResult = result;
  return result;
}

test('the story graph has no missing, unreachable, cyclic, or dead-end scenes', () => {
  const validation = api.validateStory();
  assert.equal(validation.ok, true, JSON.stringify(validation));
  assert.equal(validation.errors.length, 0, JSON.stringify(validation));
  assert.equal(validation.reachableCount, validation.nodeCount);
  assert.ok(validation.endingCount > 0);
  assert.ok(validation.minDecisions >= 28, 'An adventure must retain its full story arc.');
  assert.ok(Number.isFinite(validation.maxDecisions));
  assert.ok(validation.maxDecisions >= validation.minDecisions);
});

test('the opening introduces Jenkins before his recipe-specific clue', () => {
  for (let run = 1; run <= 16; run++) {
    const state = api.freshState(api.testStoryPlan(run));
    const lines = api.textLines(api.STORY.opening, state);
    const introduction = lines.findIndex(line => line.includes('Jenkins was in the house'));
    const clue = lines.findIndex(line => line.includes(state.director.stamp));
    assert.ok(introduction >= 0 && clue > introduction, 'A clue referring to Jenkins follows his introduction');
  }
});

test('5,000 deterministic adventures render and complete across every scene and ending', () => {
  const result = sampledRoutes();
  assert.equal(result.completed, 5000);
  assert.equal(result.visited.size, Object.keys(api.STORY).length,
    `Unvisited scenes: ${Object.keys(api.STORY).filter(id => !result.visited.has(id)).join(', ')}`);
  const endingIds = Object.keys(api.STORY).filter(id => api.STORY[id].ending);
  assert.equal(result.endings.size, endingIds.length,
    `Unvisited endings: ${endingIds.filter(id => !result.endings.has(id)).join(', ')}`);
});

test('asking Scarlett to find ribbon does not create saved tape', () => {
  const state = sampledRoutes().snapshots.ribbon;
  assert.ok(state, 'The sampled story must include a helper scene without saved tape.');
  const node = api.STORY.response_help;
  const choice = api.availableChoices(node, state).find(item => /find.*ribbon/i.test(labelOf(item, state)));
  assert.ok(choice, 'Scarlett can find ribbon when tape is unavailable.');
  const transition = debug.transition(node, choice, state);
  assert.equal(transition.state.hasTape, false, 'Finding ribbon must preserve the absence of tape.');
  const acquired = transition.state.items.filter(item => !state.items.includes(item));
  assert.ok(transition.state.items.some(item => /ribbon|fastener/i.test(item)),
    'The selected supply must remain available for later scenes.');
  assert.ok(!acquired.some(item => /tape/i.test(item)), 'A ribbon choice must not add tape to inventory.');
});

test('asking about a button does not introduce the caped acorn', () => {
  const state = sampledRoutes().snapshots.button;
  assert.ok(state, 'The sampled story must include a helper scene without an acorn.');
  const node = api.STORY.response_help;
  const choice = api.availableChoices(node, state).find(item => /button/i.test(labelOf(item, state)));
  assert.ok(choice, 'Scarlett can give an opinion about a button when an acorn is unavailable.');
  const transition = debug.transition(node, choice, state);
  assert.equal(transition.state.hasAcorn, false, 'Discussing a button must preserve the absence of an acorn.');
  const acquired = transition.state.items.filter(item => !state.items.includes(item));
  assert.ok(transition.state.items.some(item => /button|jewel/i.test(item)),
    'The chosen decoration must remain available for later scenes.');
  assert.ok(!acquired.some(item => /acorn/i.test(item)), 'A button choice must not add an acorn to inventory.');
});

test('portrait and treasure fixes do not invent an earlier answer from Scarlett', () => {
  const snapshots = sampledRoutes().snapshots;
  for (const [id, state] of [
    ['late_crisis_portrait', snapshots.portraitWithoutAnswer],
    ['late_crisis_treasure', snapshots.treasureWithoutAnswer]
  ]) {
    assert.ok(state, `${id} must be reached without the optional Scarlett answer.`);
    assert.equal(hasEarlierAnswer(state), false);
    const node = api.STORY[id];
    const text = api.textLines(node, state).join(' ');
    assert.doesNotMatch(text, /Scarlett (?:had )?helped choose|Scarlett's (?:earlier|chosen|previous) (?:color|answer|jewel)/i,
      `${id} must describe the route the reader actually selected.`);
    for (const choice of api.availableChoices(node, state)) {
      assert.doesNotMatch(labelOf(choice, state), /Scarlett's (?:earlier|chosen|previous)|\bchosen button\b/i,
        `${id} must offer a fresh contribution or hide an unavailable earlier-answer option.`);
    }
  }
});

test('every shoe-radio conclusion records that Dad recovered both shoes', () => {
  const state = sampledRoutes().snapshots.radioFinal;
  assert.ok(state, 'The sampled story must include the final shoe-radio scene.');
  const node = api.STORY.side_shoe_radio_3;
  for (const choice of api.availableChoices(node, state)) {
    const transition = debug.transition(node, choice, state);
    assert.equal(transition.state.foundShoes, true,
      `Putting on both shoes must survive the choice: ${labelOf(choice, state)}`);
  }
});
