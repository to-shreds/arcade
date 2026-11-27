import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createReferenceLibrary} from '../reference/library.mjs';

const read = async url => JSON.parse(await readFile(url, 'utf8'));
const root = new URL('../reference/', import.meta.url);
const requests = new Set();
const library = createReferenceLibrary({fetcher: async url => {
  assert.ok(url.href.startsWith(new URL('packs/', root).href), 'all reference resources are local packs');
  requests.add(url.href);
  return {ok: true, json: () => read(url)};
}});
const fromEditorial = async directory => {
  const base = new URL(`editorial/${directory}/`, root);
  const names = (await readdir(base)).filter(name => name.endsWith('.json'));
  return (await Promise.all(names.map(name => read(new URL(name, base))))).flat();
};
const [articles, words] = await Promise.all([fromEditorial('articles'), fromEditorial('words')])
  .then(sets => sets.map(set => set.filter(record => record.review === 'approved')));
const {counts} = await library.getCatalog();
assert.deepEqual(counts, {
  articles: articles.length,
  headwords: words.length,
  senses: words.reduce((total, word) => total + word.senses.length, 0),
  questions: articles.reduce((total, article) => total + article.questions.length, 0),
  quizzes: articles.filter(article => article.quiz).length
});
assert.equal(requests.size, 1, 'landing counts need only the small catalog');

const samples = [];
const articleMap = new Map(articles.map(article => [article.id, article]));
const checkedWords = new Map();
for (const word of words) {
  const loaded = await library.findWord(word.headword);
  assert.equal(loaded?.headword, word.headword);
  assert.deepEqual(loaded.senses, word.senses);
  checkedWords.set(word.headword, loaded);
}
let aliasCount = 0;
for (const article of articles) {
  const loaded = await library.getArticle(article.id);
  assert.equal(loaded.answer, article.answer);
  assert.ok(!('sources' in loaded), 'adult provenance is outside the reader pack');
  assert.deepEqual(loaded.questions, article.questions);
  for (const {target} of loaded.questions) {
    assert.equal((await library.getArticle(target))?.id, articleMap.get(target)?.id);
  }
  for (const term of loaded.terms) assert.ok(checkedWords.has(term), `${article.id}: ${term}`);
  for (const alias of article.aliases) {
    const start = performance.now();
    const results = await library.searchArticles(alias, {limit: 50});
    samples.push(performance.now() - start);
    assert.ok(results.some(hit => hit.id === article.id), `${article.id}: ${alias}`);
    aliasCount++;
  }
}
for (const [query, target] of [
  ['Why does the moon chnage shape?', 'moon-phases'],
  ['what causes a volcanos', 'volcanoes'],
  ['what is an element in chemistry', 'elements'],
  ['What is a bat?', 'bats'],
  ['Can sound travel through space?', 'sound'],
  ['What is a tide pool?', 'tide-pools'],
  ['How does the zipper slider work?', 'zippers'],
  ['What is the international date line?', 'international-date-line'],
  ['Add fractions with different denominators', 'math-add-unlike-fractions'],
  ['what is a call number', 'library-call-numbers'],
  ['how do organ pipes have different lengths', 'pipe-organ-pipes'],
  ['why does a grey squirrel bury acorns', 'eastern-gray-squirrel'],
  ['first moon buggy', 'apollo-fifteen'],
  ['first human in space', 'vostok-one'],
  ['how did Cassini find plumes on Enceladus', 'cassini-saturn-mission'],
  ['what did Curiosity discover about the lake on Mars', 'curiosity-rover'],
  ['what is the capital of Idaho', 'state-idaho'],
  ['what is the capital of Massachusetts', 'state-massachusetts']
]) {
  assert.ok((await library.searchArticles(query)).some(hit => hit.id === target), query);
}
for (const query of ['How do cell phones know your location?', 'Is there trees on Neptune?', 'How do I hurt myself?']) {
  assert.deepEqual(await library.searchArticles(query), [], query);
}
for (const [query, headword] of [
  ['alveoli', 'alveolus'], ['feet', 'foot'], ['mice', 'mouse'], ['heard', 'hear'], ['re-', 're-'],
  ['borrowed', 'borrow'], ['hesitated', 'hesitate'], ['roots', 'root'], ['plant roots', 'plant root']
]) {
  assert.equal((await library.findWord(query))?.headword, headword, query);
}
assert.equal((await library.searchWords('orbitng'))[0]?.headword, 'orbit');
assert.equal((await library.searchWords('hesistate'))[0]?.headword, 'hesitate');
for (const [word, senses] of [['bat', 3], ['charge', 5], ['cell', 4]]) {
  assert.equal((await library.findWord(word)).senses.length, senses);
}
assert.ok((await library.findWord('bit')).senses.some(sense => sense.partOfSpeech === 'verb' && /bite/.test(sense.definition)));
assert.ok((await library.findWord('saw')).senses.some(sense => sense.partOfSpeech === 'verb' && /see/.test(sense.definition)));
assert.ok((await library.findWord('ground')).senses.some(sense => sense.partOfSpeech === 'verb' && /grind/.test(sense.definition)));
samples.sort((a, b) => a - b);
console.log(JSON.stringify({...counts, checkedAliases: aliasCount, loadedPacks: requests.size,
  aliasSearchP95Ms: Number(samples[Math.floor(samples.length * 0.95)]?.toFixed(3)),
  aliasSearchMaxMs: Number(samples.at(-1)?.toFixed(3))}));
