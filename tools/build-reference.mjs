import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join, relative, sep} from 'node:path';
import {buildPostings, normalize, spelling} from '../reference/search.mjs';

const root = fileURLToPath(new URL('../reference/', import.meta.url));
const editorial = join(root, 'editorial');
const check = process.argv.includes('--check');
const preview = process.argv.includes('--preview');
assert.ok(!(check && preview), 'Use --check or --preview separately.');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const taxonomy = await read(join(editorial, 'taxonomy.json'));
const alpha = (a, b) => a.localeCompare(b, 'en');
const id = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validText = value => typeof value === 'string' && value.trim() === value && value.length > 0;
const wordCount = value => value.match(/\p{L}+(?:[’'-]\p{L}+)*/gu)?.length ?? 0;
const errors = [];
const warnings = [];
function require(ok, message) {
  if (!ok) errors.push(message);
  return ok;
}
function list(value, min = 0) {
  return Array.isArray(value) && value.length >= min && value.every(validText);
}
async function batches(folder) {
  const directory = join(editorial, folder);
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort(alpha);
  const records = [];
  for (const name of files) {
    const path = join(directory, name);
    const content = await read(path);
    assert.ok(Array.isArray(content), `${relative(root, path)} must contain a JSON array`);
    records.push(...content);
  }
  return records;
}
const [articles, words, sources] = await Promise.all(['articles', 'words', 'sources'].map(batches));
function keyed(rows, key, label) {
  const map = new Map();
  for (const row of rows) {
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), `Invalid ${label} record`);
    const value = row[key];
    if (require(validText(value) && !map.has(value), `Invalid or duplicate ${label}: ${value}`)) map.set(value, row);
  }
  return map;
}
const sourceMap = keyed(sources, 'id', 'source ID');
const articleMap = keyed(articles, 'id', 'article ID');
const wordMap = keyed(words, 'headword', 'headword');
const normalizedTitles = new Set();
const normalizedAnswers = new Set();
const forms = new Map();
const safetyFlags = [];
function flags(text, key) {
  if (/\b(?:war|killed|death|slavery|died|religion|disease|injury|puberty|pregnancy|reproduction|genocide|weapon|racism)\b/i.test(text)) safetyFlags.push(key);
}
function revision(record, key, requiredSources) {
  require(Number.isSafeInteger(record.revision) && record.revision >= 1, `${key}: revision must be a positive integer`);
  require(['draft', 'approved', 'needs-revision'].includes(record.review), `${key}: unknown review status`);
  require((!requiredSources && record.sources === undefined) ||
    (list(record.sources, Number(requiredSources)) && record.sources.every(source => sourceMap.has(source))),
  `${key}: missing or unknown source`);
}
for (const [key, source] of sourceMap) {
  require(id.test(key) && /^https:\/\/[^\s]+$/.test(source.url) &&
    /^\d{4}-\d{2}-\d{2}$/.test(source.accessed) &&
    [source.title, source.publisher, source.scope, source.reuse].every(validText), `${key}: invalid provenance`);
}
for (const [headword, word] of wordMap) {
  const key = `word ${headword}`;
  revision(word, key, false);
  require(spelling(headword) === headword && normalize(headword) && list(word.forms), `${key}: headword or forms`);
  require(word.pronunciation === undefined || validText(word.pronunciation), `${key}: invalid pronunciation`);
  require(Array.isArray(word.senses) && word.senses.length && word.senses.every(sense =>
    [sense.partOfSpeech, sense.definition, sense.example].every(validText) &&
    (sense.synonyms === undefined || list(sense.synonyms)) && (sense.antonyms === undefined || list(sense.antonyms))),
  `${key}: incomplete sense`);
  if (Array.isArray(word.forms)) for (const form of word.forms) {
    require(spelling(form) === form, `${key}: noncanonical form ${form}`);
    const owners = forms.get(form) ?? new Set();
    owners.add(headword);
    forms.set(form, owners);
  }
  flags(JSON.stringify(word.senses), key);
}
for (const [key, article] of articleMap) {
  revision(article, key, true);
  const title = normalize(article.title);
  const answer = normalize(article.answer);
  require(id.test(key) && Object.hasOwn(taxonomy, article.category) &&
    Number.isInteger(article.priority) && article.priority >= 1 && article.priority <= 3, `${key}: ID, taxonomy or priority`);
  require(validText(article.title) && title && !normalizedTitles.has(title), `${key}: invalid or duplicate title`);
  require(validText(article.answer) && answer && !normalizedAnswers.has(answer), `${key}: invalid or duplicate answer`);
  normalizedTitles.add(title);
  normalizedAnswers.add(answer);
  if (validText(article.answer) && (wordCount(article.answer) < 60 || wordCount(article.answer) > 150)) {
    warnings.push(`${key}: answer has ${wordCount(article.answer)} words (target 60–150)`);
  }
  require(list(article.aliases, 1) && list(article.facts, 1) && list(article.terms), `${key}: aliases, facts or terms missing`);
  require(Array.isArray(article.sections) && article.sections.every(section =>
    validText(section.heading) && validText(section.text)), `${key}: invalid sections`);
  const questions = article.questions;
  if (require(Array.isArray(questions) && questions.length >= 3 && questions.length <= 8, `${key}: requires 3–8 curated questions`)) {
    const texts = new Set();
    for (const question of questions) {
      const text = normalize(question.text);
      require(validText(question.text) && !texts.has(text) && question.target !== key && articleMap.has(question.target),
        `${key}: missing, duplicate, unknown or self-linked follow-up: ${question.text} (${question.target})`);
      texts.add(text);
    }
  }
  if (article.quiz !== undefined) {
    const {question, options, answer: correct, explanation} = article.quiz;
    require(validText(question) && list(options, 2) && new Set(options).size === options.length &&
      Number.isInteger(correct) && correct >= 0 && correct < options.length && validText(explanation), `${key}: invalid quiz`);
  }
  flags([article.title, article.answer, ...article.facts, ...article.sections.map(section => section.text)].join(' '), key);
}
const approved = rows => rows.filter(row => row.review === 'approved');
const approvedArticles = approved(articles);
const approvedWords = approved(words);
const publishedArticles = preview ? articles : approvedArticles;
const publishedWords = preview ? words : approvedWords;
const publishedIds = new Set(publishedArticles.map(article => article.id));
const publishedTerms = new Set(publishedWords.map(word => word.headword));
for (const article of publishedArticles) {
  for (const {target} of article.questions) require(publishedIds.has(target), `${article.id}: unpublished follow-up target ${target}`);
  for (const term of article.terms) {
    if (preview && !publishedTerms.has(term)) warnings.push(`${article.id}: term pending: ${term}`);
    else require(publishedTerms.has(term), `${article.id}: unpublished or missing definition ${term}`);
  }
}
if (errors.length) {
  for (const message of errors) console.error(message);
  process.exit(1);
}

const outputs = new Map();
const pack = (path, data) => outputs.set(`packs/${path}.json`, `${JSON.stringify({schema: 1, ...data})}\n`);
function shards(records, groupKey, directory) {
  const groups = Map.groupBy(records, groupKey);
  const keys = new Map();
  for (const [key, items] of groups) {
    for (let start = 0; start < items.length; start += 128) {
      const shard = `${key}-${1 + start / 128}`;
      const entries = items.slice(start, start + 128);
      entries.forEach(entry => keys.set(entry, shard));
      pack(`${directory}/${shard}`, {entries});
    }
  }
  return keys;
}
const articleRecords = publishedArticles.map(({id, title, category, answer, sections, facts, terms, questions, quiz}) =>
  ({id, title, category, answer, sections, facts, terms, questions, ...(quiz ? {quiz} : {})}))
  .sort((a, b) => alpha(a.title, b.title));
const articleShards = shards(articleRecords, article => article.category, 'articles');
const cards = articleRecords.map(article => ({id: article.id, title: article.title, category: article.category,
  summary: article.answer.split(/(?<=[.!?])\s+/).slice(0, 2).join(' '), shard: articleShards.get(article)}));
const linkedQuestions = new Map();
for (const article of publishedArticles) for (const {target, text} of article.questions) {
  if (!linkedQuestions.has(target)) linkedQuestions.set(target, []);
  linkedQuestions.get(target).push(text);
}
pack('articles', {cards, index: buildPostings(cards.map(card => ({label: card.title,
  aliases: [...articleMap.get(card.id).aliases, ...(linkedQuestions.get(card.id) ?? [])]})))});

const wordRecords = publishedWords.map(({headword, pronunciation, forms, senses}) =>
  ({headword, ...(pronunciation ? {pronunciation} : {}), forms, senses})).sort((a, b) => alpha(a.headword, b.headword));
const wordShards = shards(wordRecords, word => /^[a-z]/.test(word.headword) ? word.headword[0] : 'other', 'words');
const exact = new Map();
wordRecords.forEach((word, index) => {
  exact.set(word.headword, index);
  if (!exact.has(normalize(word.headword))) exact.set(normalize(word.headword), index);
});
wordRecords.forEach((word, index) => {
  // A spelling claimed by a draft must not hide an approved lookup.
  for (const form of word.forms) if (forms.get(form)?.intersection(publishedTerms).size === 1) {
    if (!exact.has(form)) exact.set(form, index);
    if (!exact.has(normalize(form))) exact.set(normalize(form), index);
  }
});
const wordCards = wordRecords.map(word => ({headword: word.headword, definition: word.senses[0].definition, shard: wordShards.get(word)}));
pack('words', {cards: wordCards, exact: Object.fromEntries(exact),
  index: buildPostings(wordRecords.map(word => ({label: word.headword, aliases: word.forms})))});
const categories = Object.entries(taxonomy).filter(([key]) => articleRecords.some(article => article.category === key))
  .map(([id, label]) => ({id, label}));
const countsFor = (a, w) => ({articles: a.length, headwords: w.length,
  senses: w.reduce((sum, word) => sum + word.senses.length, 0),
  questions: a.reduce((sum, article) => sum + article.questions.length, 0), quizzes: a.filter(article => article.quiz).length});
pack('catalog', {categories, counts: countsFor(publishedArticles, publishedWords)});

const termGaps = [...new Set(articles.flatMap(article => article.terms).filter(term => !wordMap.has(term)))].sort(alpha);
const report = {inventory: countsFor(articles, words), approved: countsFor(approvedArticles, approvedWords),
  taxonomy: Object.fromEntries(Object.entries(taxonomy).map(([key, label]) => [key, {label,
    articles: articles.filter(article => article.category === key).length,
    approved: approvedArticles.filter(article => article.category === key).length}])),
  sourceCount: sources.length, termGaps, safetyFlags: safetyFlags.sort(alpha), readingLengthWarnings: warnings.filter(warning =>
    warning.includes('target 60–150')), ambiguousForms: [...forms].filter(([, owners]) => owners.size > 1).map(([form]) => form).sort(alpha)};
if (!preview) outputs.set('editorial/coverage.json', `${JSON.stringify(report, null, 2)}\n`);
if (check) {
  for (const [name, bytes] of outputs) assert.equal(await readFile(join(root, name), 'utf8'), bytes, `Rebuild stale ${name}`);
  const existing = (await readdir(join(root, 'packs'), {recursive: true, withFileTypes: true}))
    .filter(item => item.isFile() && item.name.endsWith('.json'))
    .map(item => relative(root, join(item.parentPath, item.name)).split(sep).join('/')).sort(alpha);
  assert.deepEqual(existing, [...outputs.keys()].filter(name => name.startsWith('packs/')).sort(alpha), 'Stale reference shards');
} else {
  for (const sub of ['articles', 'words']) await rm(join(root, 'packs', sub), {recursive: true, force: true});
  for (const [name, bytes] of outputs) {
    const filename = join(root, name);
    await mkdir(join(filename, '..'), {recursive: true});
    await writeFile(filename, bytes);
  }
}
for (const warning of warnings) console.warn(warning);
console.log(JSON.stringify({inventory: report.inventory, approved: report.approved,
  sources: report.sourceCount, termGaps, safetyFlags: safetyFlags.length, preview}, null, 2));
