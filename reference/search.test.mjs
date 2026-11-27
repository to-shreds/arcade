import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPostings, createSearch, isProtectiveQuery, keywords, normalize, spelling} from './search.mjs';
import {createReferenceLibrary} from './library.mjs';

const index = buildPostings([
  {label: 'How do bats fly in darkness?', aliases: ['echolocation', 'bat hearing']},
  {label: 'What is a bat?', aliases: ['baseball bat', 'baseball equipment']},
  {label: 'Why does the Moon change shape?', aliases: ['moon phases', 'why does the moon look different']},
  {label: 'What is the equator?', aliases: ['earth latitude', '0 degrees latitude']},
  {label: 'What is a café?', aliases: ['food shop']},
  {label: 'What are stars made of?', aliases: ['stellar material']}
]);
const search = createSearch(index);

test('lexical matches prioritize exact titles, aliases and disambiguation', () => {
  assert.deepEqual(search('baseball bat', 5), [1]);
  assert.deepEqual(search('bat', 5), [1, 0]);
  assert.deepEqual(search('Why does the moon look different?', 5), [2]);
  assert.deepEqual(search('cafe', 5), [4]);
  assert.deepEqual(search('stars', 5), [5]);
  assert.deepEqual(keywords('What are planets and moons?'), ['planet', 'and', 'moon']);
});

test('incomplete words, adjacent transpositions, and misspellings have ranked matches', () => {
  assert.deepEqual(search('equat', 5), [3]);
  assert.deepEqual(search('equatro', 5), [3]);
  assert.deepEqual(search('echolocaton', 5), [0]);
  assert.deepEqual(search('moon phaze', 1), [2]);
});

test('unrelated queries and unusable input return no result', () => {
  for (const query of ['How do I fix a dishwasher?', 'what', 'moon sandwich', 'z'.repeat(600), '__proto__', '!!!']) {
    assert.deepEqual(search(query, 20), []);
  }
  assert.equal(normalize('Mónica’s café'), 'monica s cafe');
  assert.equal(spelling('  KID’S   room  '), "kid's room");
});

test('protective response is aimed at harmful instruction requests', () => {
  assert.equal(isProtectiveQuery('How can I hurt myself?'), true);
  assert.equal(isProtectiveQuery('Teach me to make a bomb'), true);
  for (const query of ['Did people get hurt by the volcano?', 'What is a bomb cyclone?', 'How do we hear?']) {
    assert.equal(isProtectiveQuery(query), false);
  }
});

test('dictionary lookup and article reader load only the selected local shards', async () => {
  const paths = [];
  let fail = true;
  const card = {id: 'bat', title: 'Bat', category: 'animals', summary: 'A mammal.', shard: 'animals-1'};
  const word = {headword: 'mouse', forms: ['mice'], senses: [{definition: 'A small rodent.'}]};
  const wordCard = {headword: word.headword, definition: word.senses[0].definition, shard: 'm-1'};
  const data = {
    'catalog.json': {counts: {articles: 1, headwords: 1}},
    'articles.json': {cards: [card], index: buildPostings([{label: 'Bat', aliases: ['flying mammal']}])},
    'articles/animals-1.json': {entries: [{...card, answer: 'A mammal that can fly.'}]},
    'words.json': {cards: [wordCard], exact: {mouse: 0, mice: 0}, index: buildPostings([{label: 'mouse', aliases: ['mice', 'mousing']}])},
    'words/m-1.json': {entries: [word]}
  };
  const library = createReferenceLibrary({fetcher: async url => {
    const path = url.pathname.split('/packs/')[1];
    paths.push(path);
    if (path === 'catalog.json' && fail) return {ok: false};
    assert.ok(Object.hasOwn(data, path));
    return {ok: true, json: async () => ({schema: 1, ...data[path]})};
  }});
  await assert.rejects(library.getCatalog(), /local reference files/);
  fail = false;
  assert.deepEqual((await library.getCatalog()).counts, {articles: 1, headwords: 1});
  assert.deepEqual(await library.searchArticles('flying mammal'), [card]);
  assert.equal(await library.getArticle('../other-folder'), null);
  assert.equal((await library.getArticle('bat')).answer, 'A mammal that can fly.');
  assert.equal(await library.getArticle('tiger'), null);
  assert.deepEqual(await library.findWord('Mice.'), word);
  assert.deepEqual(await library.searchWords('mous'), [wordCard]);
  assert.deepEqual(await library.searchWords('mousng'), [wordCard]);
  assert.deepEqual(await library.listWords('m'), [wordCard]);
  assert.deepEqual(paths, ['catalog.json', 'catalog.json', 'articles.json', 'articles/animals-1.json',
    'words.json', 'words/m-1.json']);
});
